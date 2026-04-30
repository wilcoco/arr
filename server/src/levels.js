// 레벨 / XP 시스템 (서버 단일 소스)
const db = require('./db')

const MAX_LEVEL = 20

// 레벨 N 도달에 누적 필요한 XP (geometric)
// L1=0, L2=100, L3=400, L5=~3700, L10=~50k, L15=~600k, L20=~7M
function xpRequiredForLevel(level) {
  if (level <= 1) return 0
  let total = 0
  for (let l = 2; l <= level; l++) {
    total += Math.round(100 * (l - 1) * Math.pow(1.5, l - 2))
  }
  return total
}

// 현재 레벨 (누적 XP로부터)
function levelFromXp(xp) {
  for (let l = MAX_LEVEL; l >= 1; l--) {
    if (xp >= xpRequiredForLevel(l)) return l
  }
  return 1
}

// 무패널티 고정 수호신 슬롯 (분산 패널티 면제)
//   L1: 1, L3: 2, L5: 3, L7: 4, L10: 6, L15: 8, L20: 11
function freeSlots(level) {
  if (level >= 20) return 11
  if (level >= 15) return 8
  if (level >= 10) return 6
  if (level >=  7) return 4
  if (level >=  5) return 3
  if (level >=  3) return 2
  return 1
}

// 기본 스탯 보너스 (레벨당 2%)
function levelStatBonus(level) {
  return 1.0 + (level - 1) * 0.02
}

// 파츠 합성 성공률 보정 (L7+: +5%, L10+: +10%, L15+: +15%)
function combineRateBonus(level) {
  if (level >= 15) return 0.15
  if (level >= 10) return 0.10
  if (level >=  7) return 0.05
  return 0
}

// 고정 수호신 storage 추가 슬롯 (L5+: +1, L10+: +2, L15+: +3)
function storageBonus(level) {
  if (level >= 15) return 3
  if (level >= 10) return 2
  if (level >=  5) return 1
  return 0
}

// XP 획득 — 트랜잭션 권장 시 client 인자, 아니면 db로 fallback
async function gainXp(client, userId, amount, reason) {
  if (!userId || amount <= 0) return null
  const q = client || db
  const r = await q.query(
    `UPDATE users SET xp = COALESCE(xp,0) + $2, last_xp_event_at = NOW()
     WHERE id = $1 RETURNING xp, level`,
    [userId, amount]
  )
  if (r.rows.length === 0) return null
  const xp = parseInt(r.rows[0].xp) || 0
  const oldLevel = parseInt(r.rows[0].level) || 1
  const newLevel = levelFromXp(xp)

  let leveledUp = false
  if (newLevel > oldLevel) {
    await q.query(`UPDATE users SET level = $2 WHERE id = $1`, [userId, newLevel])
    leveledUp = true
    // 레벨업 활동 이벤트 로그
    await q.query(
      `INSERT INTO activity_events (user_id, event_type, data) VALUES ($1, 'level_up', $2)`,
      [userId, JSON.stringify({ from: oldLevel, to: newLevel, reason })]
    ).catch(() => {})
  }
  return { xp, level: newLevel, oldLevel, leveledUp, gained: amount, reason }
}

// 사용자 레벨 정보 한 번에
async function getLevelInfo(userId) {
  const r = await db.query(
    `SELECT COALESCE(level,1) AS level, COALESCE(xp,0) AS xp FROM users WHERE id=$1`,
    [userId]
  )
  if (r.rows.length === 0) return null
  const xp = parseInt(r.rows[0].xp) || 0
  const level = parseInt(r.rows[0].level) || levelFromXp(xp)
  const currentLevelXp = xpRequiredForLevel(level)
  const nextLevelXp = level >= MAX_LEVEL ? currentLevelXp : xpRequiredForLevel(level + 1)
  return {
    level,
    xp,
    currentLevelXp,
    nextLevelXp,
    progressPct: level >= MAX_LEVEL ? 100 :
      Math.round(((xp - currentLevelXp) / Math.max(1, nextLevelXp - currentLevelXp)) * 100),
    freeSlots: freeSlots(level),
    statBonus: levelStatBonus(level),
    combineRateBonus: combineRateBonus(level),
    storageBonus: storageBonus(level),
    isMaxLevel: level >= MAX_LEVEL
  }
}

module.exports = {
  MAX_LEVEL,
  xpRequiredForLevel,
  levelFromXp,
  freeSlots,
  levelStatBonus,
  combineRateBonus,
  storageBonus,
  gainXp,
  getLevelInfo
}
