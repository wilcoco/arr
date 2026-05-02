const express = require('express')
const router = express.Router()
const db = require('../db')

// 13종 타워 (Piloto Studio TowerDefenseStarterPack 매핑)
// effect 종류:
//   aoe         : 폭발 반경(m) 내 모두 데미지
//   burn        : N초 동안 매초 도트
//   slow        : 적 이동/시너지 감소 N% × M초
//   vulnerable  : 적 영역 vulnerable_until 연장
//   chain       : 가까운 적 추가 타격
//   heal_adj    : 인접 우호 타워 HP 회복
//   poison_dot  : 누적 가능한 독 도트
//   debuff_combine : 영역 내 적 합성 성공률 감소
//   synergy_boost  : 동맹 시너지 보너스
const TOWER_CLASSES = {
  generic:  { range: 80,  fireRateMs: 3000, baseDmg: 10, baseHp: 50,  effect: null,            label: '제네릭',   cost: 30,  desc: '시작용 균형' },
  balista:  { range: 150, fireRateMs: 4000, baseDmg: 18, baseHp: 50,  effect: 'first_shot_50', label: '발리스타', cost: 50,  desc: '장거리 정찰형, 첫 발 +50%' },
  cannon:   { range: 100, fireRateMs: 7000, baseDmg: 35, baseHp: 80,  effect: 'aoe_30',        label: '대포',    cost: 70,  desc: '광역 폭격 30m' },
  assault:  { range: 70,  fireRateMs: 1000, baseDmg: 6,  baseHp: 60,  effect: null,            label: '돌격',    cost: 50,  desc: '연사 속도 우위' },
  scifi:    { range: 130, fireRateMs: 5000, baseDmg: 35, baseHp: 50,  effect: 'pierce',        label: 'SF',      cost: 75,  desc: '정밀 관통 사격' },
  fire:     { range: 60,  fireRateMs: 2000, baseDmg: 8,  baseHp: 50,  effect: 'burn_5s',       label: '화염',    cost: 55,  desc: '5초간 화상 도트' },
  ice:      { range: 80,  fireRateMs: 3000, baseDmg: 6,  baseHp: 50,  effect: 'slow_30_10',    label: '얼음',    cost: 60,  desc: '적 -30% 10초' },
  aqua:     { range: 90,  fireRateMs: 3000, baseDmg: 12, baseHp: 60,  effect: 'vulnerable_5m', label: '아쿠아',   cost: 60,  desc: '적 영역 5분 취약화' },
  electric: { range: 75,  fireRateMs: 4000, baseDmg: 14, baseHp: 50,  effect: 'chain_2',       label: '전기',    cost: 65,  desc: '가까운 적 2명 추가' },
  nature:   { range: 50,  fireRateMs: 0,    baseDmg: 0,  baseHp: 60,  effect: 'heal_adj',      label: '자연',    cost: 50,  desc: '인접 타워 회복' },
  venom:    { range: 65,  fireRateMs: 3000, baseDmg: 5,  baseHp: 50,  effect: 'poison_30s',    label: '독',     cost: 55,  desc: '30초 누적 독 도트' },
  arcane:   { range: 100, fireRateMs: 6000, baseDmg: 22, baseHp: 50,  effect: 'debuff_combine',label: '비전',    cost: 70,  desc: '영역 내 적 합성률 -10%' },
  crystal:  { range: 40,  fireRateMs: 0,    baseDmg: 0,  baseHp: 80,  effect: 'synergy_boost', label: '크리스탈', cost: 80,  desc: '동맹 시너지 +10%' }
}

// 레벨업 공식 (Lv1 → Lv5)
//   스탯 ×(1 + (lv-1)×0.45),  HP ×(1 + (lv-1)×0.55),  사거리 ×(1 + (lv-1)×0.10),  비용 ×1.7^(lv-1)
function towerStats(cls, level = 1) {
  const c = TOWER_CLASSES[cls] || TOWER_CLASSES.generic
  const lvl = Math.max(1, Math.min(5, level))
  const dmgMult   = 1 + (lvl - 1) * 0.45
  const hpMult    = 1 + (lvl - 1) * 0.55
  const rangeMult = 1 + (lvl - 1) * 0.10
  const rateMult  = Math.max(0.6, 1 - (lvl - 1) * 0.08)  // 발사속도도 약간 빨라짐
  return {
    range: Math.round(c.range * rangeMult),
    fireRateMs: c.fireRateMs > 0 ? Math.round(c.fireRateMs * rateMult) : 0,
    damage: Math.round(c.baseDmg * dmgMult),
    hp: Math.round(c.baseHp * hpMult),
    effect: c.effect,
    label: c.label,
    desc: c.desc,
    cost: Math.round(c.cost * Math.pow(1.4, lvl - 1)),  // 1.7→1.4 완화 (Lv5 = ~3.84배)
    level: lvl
  }
}

function distMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const sa = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2
  return 2 * R * Math.asin(Math.sqrt(sa))
}

// 사용자 위치 변경 시 호출 → 사거리 안의 적 타워가 자동 발사
async function processTowerDamage(userId, lat, lng) {
  if (!userId) return { strikes: [], totalDmg: 0 }
  // 동맹 ID 모으기 (동맹 타워는 공격 안 함)
  const al = await db.query(
    `SELECT user_id_2 AS u FROM alliances WHERE user_id_1=$1 AND active=true
     UNION SELECT user_id_1 FROM alliances WHERE user_id_2=$1 AND active=true`,
    [userId]
  )
  const friendlyIds = new Set([userId, ...al.rows.map(r => r.u)])

  // 1km 이내의 타워만 가져오기 (효율)
  const fg = await db.query(
    `SELECT fg.*, t.center_lat AS terr_lat, t.center_lng AS terr_lng
     FROM fixed_guardians fg
     JOIN territories t ON fg.territory_id = t.id
     WHERE fg.user_id != $1
       AND SQRT(POW((t.center_lat - $2) * 111000, 2) + POW((t.center_lng - $3) * 88700, 2)) < 1000`,
    [userId, lat, lng]
  )

  const strikes = []
  let totalDmg = 0

  for (const tw of fg.rows) {
    if (friendlyIds.has(tw.user_id)) continue
    const cls = tw.tower_class || 'generic'
    const stats = towerStats(cls, tw.tier || 1)
    if (stats.damage <= 0 || stats.range <= 0) continue  // 비전투 타워(nature/crystal)

    const d = distMeters(tw.terr_lat, tw.terr_lng, lat, lng)
    if (d > stats.range) continue

    // 발사 쿨다운
    const lastFired = tw.last_fired_at ? new Date(tw.last_fired_at).getTime() : 0
    if (Date.now() - lastFired < stats.fireRateMs) continue

    // 효과별 데미지 보정
    let appliedDmg = stats.damage
    if (stats.effect === 'first_shot_50' && !lastFired) appliedDmg = Math.round(appliedDmg * 1.5)

    // 발사 기록
    await db.query(`UPDATE fixed_guardians SET last_fired_at = NOW() WHERE id = $1`, [tw.id])
    await db.query(
      `INSERT INTO tower_strikes (tower_id, target_user_id, damage) VALUES ($1, $2, $3)`,
      [tw.id, userId, appliedDmg]
    )
    // 데미지 적용
    await db.query(`UPDATE guardians SET hp = GREATEST(0, hp - $1) WHERE user_id = $2`, [appliedDmg, userId])

    // 효과 적용
    switch (stats.effect) {
      case 'aoe_30':
        // 동일 위치 다른 적 플레이어들(30m 내) 추가 피해 — 간단화: 같은 영역 내 다른 사용자 검색 생략
        break
      case 'burn_5s':
        // 5초간 추가 도트 — 간이 구현: 즉시 추가 5턴 데미지 누적
        await db.query(`UPDATE guardians SET hp = GREATEST(0, hp - $1) WHERE user_id = $2`, [Math.round(appliedDmg * 0.5), userId])
        break
      case 'poison_30s':
        // 누적 독: hp 추가 차감 (작지만 누적 가능)
        await db.query(`UPDATE guardians SET hp = GREATEST(0, hp - $1) WHERE user_id = $2`, [Math.round(appliedDmg * 0.7), userId])
        break
      case 'slow_30_10':
        // 적의 모든 영역 vulnerable + 시너지 페널티는 별도 컬럼 필요. 간이: vulnerable 적용
        await db.query(`UPDATE territories SET vulnerable_until = GREATEST(COALESCE(vulnerable_until, NOW()), NOW() + INTERVAL '10 seconds') WHERE user_id = $1`, [userId]).catch(() => {})
        break
      case 'vulnerable_5m':
        await db.query(`UPDATE territories SET vulnerable_until = GREATEST(COALESCE(vulnerable_until, NOW()), NOW() + INTERVAL '5 minutes') WHERE user_id = $1`, [userId]).catch(() => {})
        break
      case 'chain_2':
        // 체인은 단순화: 50% 추가 데미지로 표현
        await db.query(`UPDATE guardians SET hp = GREATEST(0, hp - $1) WHERE user_id = $2`, [Math.round(appliedDmg * 0.5), userId])
        break
      case 'pierce':
        // 관통 = 방어력 무시 (이미 방어 미반영이라 30% 추가 데미지로 대체)
        await db.query(`UPDATE guardians SET hp = GREATEST(0, hp - $1) WHERE user_id = $2`, [Math.round(appliedDmg * 0.3), userId])
        break
      case 'debuff_combine':
        // 적 영역에 vulnerable 짧게 + 합성 페널티 (combine 단계에서 따로 체크 가능, 여기선 vulnerable로 대체)
        await db.query(`UPDATE territories SET vulnerable_until = GREATEST(COALESCE(vulnerable_until, NOW()), NOW() + INTERVAL '1 minute') WHERE user_id = $1`, [userId]).catch(() => {})
        break
    }

    strikes.push({
      towerId: tw.id, towerClass: cls, tier: tw.tier || 1,
      ownerId: tw.user_id, damage: appliedDmg, effect: stats.effect,
      distance: Math.round(d), label: stats.label
    })
    totalDmg += appliedDmg
  }

  return { strikes, totalDmg }
}

// GET /api/towers/classes  — 클라이언트 메타데이터
router.get('/classes', (req, res) => {
  const out = {}
  for (const k of Object.keys(TOWER_CLASSES)) {
    out[k] = { ...TOWER_CLASSES[k], stats: [1,2,3,4,5].map(t => towerStats(k, t)) }
  }
  res.json({ classes: out })
})

// POST /api/towers/place — 새 타워 배치 (territory 소유자만, 영역당 최대 3개)
router.post('/place', async (req, res) => {
  try {
    const { userId, territoryId, towerClass, tier } = req.body
    if (!userId || !territoryId || !towerClass) {
      return res.json({ success: false, error: '필수 파라미터 누락' })
    }
    const cfg = TOWER_CLASSES[towerClass]
    if (!cfg) return res.json({ success: false, error: '유효하지 않은 타워 클래스' })

    const t = await db.query('SELECT * FROM territories WHERE id=$1', [territoryId])
    if (t.rows.length === 0) return res.json({ success: false, error: '영역 없음' })
    if (t.rows[0].user_id !== userId) return res.json({ success: false, error: '소유자 아님' })

    // 영역당 타워 최대 3개
    const cnt = await db.query('SELECT COUNT(*) FROM fixed_guardians WHERE territory_id=$1', [territoryId])
    if (parseInt(cnt.rows[0].count) >= 3) {
      return res.json({ success: false, error: '영역당 최대 3개 타워' })
    }

    const tierNum = parseInt(tier) || 1
    const stats = towerStats(towerClass, tierNum)

    // 에너지 차감
    const u = await db.query('SELECT energy_currency FROM users WHERE id=$1', [userId])
    const energy = parseInt(u.rows[0]?.energy_currency) || 0
    if (energy < stats.cost) {
      return res.json({ success: false, error: `에너지 부족 (필요: ${stats.cost}, 보유: ${energy})` })
    }
    await db.query('UPDATE users SET energy_currency = energy_currency - $1 WHERE id=$2', [stats.cost, userId])

    // 타워 삽입
    const result = await db.query(
      `INSERT INTO fixed_guardians (user_id, territory_id, guardian_type, tower_class, tier,
                                     tower_range, fire_rate_ms, atk, def, hp, max_hp,
                                     position_lat, position_lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12) RETURNING *`,
      [userId, territoryId, towerClass === 'production' ? 'production' : 'defense',
       towerClass, tierNum, stats.range, stats.fireRateMs,
       stats.damage, Math.round(stats.damage * 0.5), stats.hp,
       parseFloat(t.rows[0].center_lat), parseFloat(t.rows[0].center_lng)]
    )

    require('./missions').progressMission(userId, 'place_fixed', 1).catch(() => {})

    res.json({ success: true, tower: result.rows[0], cost: stats.cost })
  } catch (e) {
    console.error('tower place error', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// POST /api/towers/upgrade — 기존 타워 업그레이드
router.post('/upgrade', async (req, res) => {
  try {
    const { userId, towerId } = req.body
    const r = await db.query('SELECT * FROM fixed_guardians WHERE id=$1 AND user_id=$2', [towerId, userId])
    if (r.rows.length === 0) return res.json({ success: false, error: '타워 없음' })
    const t = r.rows[0]
    const newTier = (parseInt(t.tier) || 1) + 1
    if (newTier > 5) return res.json({ success: false, error: '최대 티어' })

    const cls = t.tower_class || 'arrow'
    const stats = towerStats(cls, newTier)

    const u = await db.query('SELECT energy_currency FROM users WHERE id=$1', [userId])
    const energy = parseInt(u.rows[0]?.energy_currency) || 0
    if (energy < stats.cost) return res.json({ success: false, error: `에너지 부족 (필요 ${stats.cost})` })

    await db.query('UPDATE users SET energy_currency = energy_currency - $1 WHERE id=$2', [stats.cost, userId])
    await db.query(
      `UPDATE fixed_guardians SET tier=$2, tower_range=$3, fire_rate_ms=$4, atk=$5, def=$6, hp=$7, max_hp=$7 WHERE id=$1`,
      [towerId, newTier, stats.range, stats.fireRateMs, stats.damage, Math.round(stats.damage * 0.5), stats.hp]
    )
    res.json({ success: true, newTier, cost: stats.cost })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

// 최근 받은 타워 공격 조회 (오프라인 요약/알림용)
router.get('/strikes/:userId', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT ts.*, fg.user_id AS attacker_id, u.username AS attacker_name
       FROM tower_strikes ts
       JOIN fixed_guardians fg ON ts.tower_id = fg.id
       JOIN users u ON fg.user_id = u.id
       WHERE ts.target_user_id = $1 AND ts.fired_at > NOW() - INTERVAL '1 hour'
       ORDER BY ts.fired_at DESC LIMIT 50`,
      [req.params.userId]
    )
    res.json({ strikes: r.rows })
  } catch (e) { res.status(500).json({ strikes: [], error: e.message }) }
})

// ─── 타워 vs 타워 공성 (5분마다 호출) ─────────────────────────────
// 적 타워가 내 타워 사거리에 있으면 자동 발사. 양방향.
async function processTowerSiege() {
  const allTowers = await db.query(
    `SELECT fg.*, t.center_lat, t.center_lng FROM fixed_guardians fg
     JOIN territories t ON fg.territory_id = t.id
     WHERE fg.hp > 0`
  )
  const towers = allTowers.rows
  const allies = await db.query(`SELECT user_id_1, user_id_2 FROM alliances WHERE active = true`)
  const isAlly = (a, b) => a === b ||
    allies.rows.some(r => (r.user_id_1 === a && r.user_id_2 === b) || (r.user_id_1 === b && r.user_id_2 === a))

  // 길드 동맹도 우호 처리
  const guildPairs = await db.query(
    `SELECT u1.id AS a, u2.id AS b FROM users u1, users u2
     WHERE u1.guild_id IS NOT NULL AND u1.guild_id = u2.guild_id AND u1.id != u2.id`
  )
  const sameGuild = (a, b) => guildPairs.rows.some(r => r.a === a && r.b === b)
  const friendly = (a, b) => isAlly(a, b) || sameGuild(a, b)

  let exchanges = 0, destroyed = 0
  const destroyedIds = new Set()

  for (let i = 0; i < towers.length; i++) {
    for (let j = 0; j < towers.length; j++) {
      if (i === j) continue
      const a = towers[i]   // shooter
      const b = towers[j]   // target
      if (destroyedIds.has(a.id) || destroyedIds.has(b.id)) continue
      if (friendly(a.user_id, b.user_id)) continue

      const aStats = towerStats(a.tower_class || 'generic', a.tier || 1)
      if (aStats.damage <= 0 || aStats.range <= 0) continue

      const d = distMeters(a.center_lat, a.center_lng, b.center_lat, b.center_lng)
      if (d > aStats.range) continue

      // 시간 기반 데미지 (5분 간격으로 fireRate 만큼 발사 가능)
      const lastFired = a.last_fired_at ? new Date(a.last_fired_at).getTime() : 0
      if (Date.now() - lastFired < aStats.fireRateMs) continue

      // 발사
      const dmg = aStats.damage
      await db.query(`UPDATE fixed_guardians SET last_fired_at = NOW() WHERE id = $1`, [a.id])
      const newHp = await db.query(
        `UPDATE fixed_guardians SET hp = GREATEST(0, hp - $1) WHERE id = $2 RETURNING hp, max_hp`,
        [dmg, b.id]
      )
      exchanges++
      a.last_fired_at = new Date().toISOString()
      b.hp = newHp.rows[0].hp

      if (b.hp === 0) {
        destroyedIds.add(b.id)
        destroyed++
        await db.query(
          `UPDATE fixed_guardians SET destroyed_at = NOW() WHERE id = $1`,
          [b.id]
        )
        // 격파 활동 로그 + 푸시
        try {
          await db.query(
            `INSERT INTO activity_events (user_id, event_type, data) VALUES ($1, 'tower_destroyed', $2)`,
            [b.user_id, JSON.stringify({ towerId: b.id, byUserId: a.user_id, towerClass: b.tower_class, tier: b.tier })]
          )
          const def = await db.query('SELECT fcm_token FROM users WHERE id=$1', [b.user_id])
          if (def.rows[0]?.fcm_token) {
            const { sendPush } = require('../fcm')
            await sendPush(def.rows[0].fcm_token, '🔥 타워 격파!',
              `${b.tower_class} Lv${b.tier} 타워가 공성으로 파괴되었습니다`,
              { type: 'TOWER_DESTROYED', towerId: b.id })
          }
        } catch {}

        // 영역 모든 타워 격파됐는지 체크 → siege_breached_at 설정
        const remaining = await db.query(
          `SELECT COUNT(*) FROM fixed_guardians WHERE territory_id = $1 AND hp > 0`,
          [b.territory_id]
        )
        if (parseInt(remaining.rows[0].count) === 0) {
          await db.query(
            `UPDATE territories SET siege_breached_at = NOW(), siege_last_attacker = $1
             WHERE id = $2 AND siege_breached_at IS NULL`,
            [a.user_id, b.territory_id]
          )
          // 영역 소유자에게 침공 경고
          try {
            const owner = await db.query(
              `SELECT u.fcm_token FROM territories t JOIN users u ON t.user_id = u.id WHERE t.id = $1`,
              [b.territory_id]
            )
            if (owner.rows[0]?.fcm_token) {
              const { sendPush } = require('../fcm')
              await sendPush(owner.rows[0].fcm_token, '⚠ 영역 방어선 붕괴!',
                `모든 타워가 격파되었습니다. 6시간 내 재건하지 않으면 영역을 잃습니다`,
                { type: 'SIEGE_BREACHED', territoryId: b.territory_id })
            }
          } catch {}
        }
      }
    }
  }
  return { exchanges, destroyed }
}

// 만료된 siege 처리 (6시간 grace 후 자동 점령)
async function processSiegeExpiry() {
  const SIEGE_GRACE_MS = 6 * 60 * 60 * 1000
  const expired = await db.query(
    `SELECT * FROM territories
     WHERE siege_breached_at IS NOT NULL
       AND siege_breached_at < NOW() - INTERVAL '6 hours'`
  )
  let captures = 0
  for (const t of expired.rows) {
    const newOwner = t.siege_last_attacker
    if (!newOwner) continue
    // 그동안 타워가 다시 세워졌으면 grace 해제
    const towers = await db.query(
      `SELECT COUNT(*) FROM fixed_guardians WHERE territory_id = $1 AND hp > 0`,
      [t.id]
    )
    if (parseInt(towers.rows[0].count) > 0) {
      await db.query(`UPDATE territories SET siege_breached_at = NULL, siege_last_attacker = NULL WHERE id = $1`, [t.id])
      continue
    }
    // 점령 실행
    const oldOwner = t.user_id
    await db.query(
      `UPDATE territories SET user_id = $1, siege_breached_at = NULL, siege_last_attacker = NULL,
                              vulnerable_until = NULL, atari_started_at = NULL
       WHERE id = $2`,
      [newOwner, t.id]
    )
    await db.query(`DELETE FROM fixed_guardians WHERE territory_id = $1`, [t.id])
    // 영역 손실 기록
    try {
      await db.query(
        `INSERT INTO territory_losses (former_owner_id, new_owner_id, center_lat, center_lng, radius, loss_type)
         VALUES ($1, $2, $3, $4, $5, 'siege_capture')`,
        [oldOwner, newOwner, t.center_lat, t.center_lng, t.radius]
      )
      // 공격자 XP +150 (호구 100보다 약간 더, 더 어려운 작업)
      await require('../levels').gainXp(null, newOwner, 150, 'siege_capture').catch(() => {})
      const owner = await db.query('SELECT fcm_token FROM users WHERE id = $1', [oldOwner])
      if (owner.rows[0]?.fcm_token) {
        const { sendPush } = require('../fcm')
        await sendPush(owner.rows[0].fcm_token, '💀 영역 함락',
          `공성으로 영역을 잃었습니다`, { type: 'TERRITORY_LOST_SIEGE', territoryId: t.id })
      }
    } catch {}
    captures++
  }
  return { captures }
}

// 사용자에게 자기 영역의 공성 상태 조회
router.get('/siege-status/:userId', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT t.id, t.center_lat, t.center_lng, t.radius, t.siege_breached_at,
              EXTRACT(EPOCH FROM (t.siege_breached_at + INTERVAL '6 hours' - NOW())) AS seconds_remaining,
              (SELECT COUNT(*) FROM fixed_guardians WHERE territory_id = t.id AND hp > 0) AS towers_alive,
              u.username AS attacker_name
       FROM territories t
       LEFT JOIN users u ON t.siege_last_attacker = u.id
       WHERE t.user_id = $1 AND t.siege_breached_at IS NOT NULL`,
      [req.params.userId]
    )
    const fnum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
    res.json({
      success: true,
      sieges: r.rows.map(s => ({
        territoryId: s.id,
        center: { lat: fnum(s.center_lat), lng: fnum(s.center_lng) },
        radius: fnum(s.radius),
        secondsRemaining: Math.max(0, parseInt(s.seconds_remaining) || 0),
        towersAlive: parseInt(s.towers_alive),
        attackerName: s.attacker_name || '?'
      }))
    })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

module.exports = router
module.exports.processTowerDamage = processTowerDamage
module.exports.processTowerSiege = processTowerSiege
module.exports.processSiegeExpiry = processSiegeExpiry
module.exports.TOWER_CLASSES = TOWER_CLASSES
module.exports.towerStats = towerStats
