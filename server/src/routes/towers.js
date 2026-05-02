const express = require('express')
const router = express.Router()
const db = require('../db')

// 타워 클래스 정의 (티어=1 기준 스탯; 티어×scalar 적용)
const TOWER_CLASSES = {
  arrow:      { range: 80,  fireRateMs: 3000, baseDmg: 10, baseHp: 50,  aoe: 0,  effect: null,                      label: '화살탑',   icon: '🏹', cost: 30 },
  cannon:     { range: 120, fireRateMs: 8000, baseDmg: 30, baseHp: 80,  aoe: 30, effect: null,                      label: '대포',     icon: '💣', cost: 60 },
  magic:      { range: 60,  fireRateMs: 5000, baseDmg: 5,  baseHp: 40,  aoe: 0,  effect: 'vulnerable_5m',           label: '마법탑',   icon: '✨', cost: 50 },
  support:    { range: 30,  fireRateMs: 0,    baseDmg: 0,  baseHp: 60,  aoe: 0,  effect: 'buff_adjacent',           label: '지원탑',   icon: '🛡', cost: 40 },
  production: { range: 0,   fireRateMs: 0,    baseDmg: 0,  baseHp: 60,  aoe: 0,  effect: 'parts_storage',           label: '생산탑',   icon: '⚙',  cost: 50 },
  revenue:    { range: 0,   fireRateMs: 0,    baseDmg: 0,  baseHp: 80,  aoe: 0,  effect: 'ad_revenue',              label: '수익탑',   icon: '💰', cost: 100 }
}

function towerStats(cls, tier = 1) {
  const c = TOWER_CLASSES[cls] || TOWER_CLASSES.arrow
  return {
    range: c.range,
    fireRateMs: c.fireRateMs,
    damage: c.baseDmg * tier,
    hp: c.baseHp * tier,
    aoe: c.aoe,
    effect: c.effect,
    label: c.label,
    icon: c.icon,
    cost: Math.round(c.cost * Math.pow(1.5, tier - 1))  // 티어 비례 비용
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
    const cls = tw.tower_class || 'arrow'
    const stats = towerStats(cls, tw.tier || 1)
    if (stats.damage <= 0 || stats.range <= 0) continue  // 비전투 타워

    const d = distMeters(tw.terr_lat, tw.terr_lng, lat, lng)
    if (d > stats.range) continue

    // 발사 쿨다운 체크
    const lastFired = tw.last_fired_at ? new Date(tw.last_fired_at).getTime() : 0
    if (Date.now() - lastFired < stats.fireRateMs) continue

    // 발사
    await db.query(`UPDATE fixed_guardians SET last_fired_at = NOW() WHERE id = $1`, [tw.id])
    await db.query(
      `INSERT INTO tower_strikes (tower_id, target_user_id, damage) VALUES ($1, $2, $3)`,
      [tw.id, userId, stats.damage]
    )
    // 데미지 적용
    await db.query(
      `UPDATE guardians SET hp = GREATEST(0, hp - $1) WHERE user_id = $2`,
      [stats.damage, userId]
    )
    // 마법탑: vulnerable 효과
    if (stats.effect === 'vulnerable_5m') {
      await db.query(
        `UPDATE territories SET vulnerable_until = GREATEST(COALESCE(vulnerable_until, NOW()), NOW() + INTERVAL '5 minutes') WHERE user_id = $1`,
        [userId]
      ).catch(() => {})
    }

    strikes.push({
      towerId: tw.id, towerClass: cls, tier: tw.tier || 1,
      ownerId: tw.user_id, damage: stats.damage,
      distance: Math.round(d), label: stats.label, icon: stats.icon
    })
    totalDmg += stats.damage
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

module.exports = router
module.exports.processTowerDamage = processTowerDamage
module.exports.TOWER_CLASSES = TOWER_CLASSES
module.exports.towerStats = towerStats
