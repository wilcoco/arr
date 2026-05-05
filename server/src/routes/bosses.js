const express = require('express')
const router = express.Router()
const db = require('../db')
const { boxParams } = require('../spatialGrid')

const BOSS_TYPES = [
  { key: 'guardian_titan',  hp: 5000,  atk: 80,  def: 50, ttlHours: 12 },
  { key: 'rogue_swarm',     hp: 3000,  atk: 100, def: 30, ttlHours: 6  },
  { key: 'ancient_sentinel',hp: 8000,  atk: 60,  def: 80, ttlHours: 24 }
]

// 6시간마다 자동 스폰 — 활성 사용자 위치 근처에 1개
async function spawnBosses() {
  // 이미 활성 보스가 충분하면 skip
  const active = await db.query(`SELECT COUNT(*) FROM world_bosses WHERE dead_at IS NULL AND expires_at > NOW()`)
  if (parseInt(active.rows[0].count) >= 3) return

  // 최근 24h 활성 사용자 위치 가져오기
  const users = await db.query(
    `SELECT last_location_lat AS lat, last_location_lng AS lng FROM users
     WHERE last_seen_at > NOW() - INTERVAL '24 hours'
       AND last_location_lat IS NOT NULL`
  )
  if (users.rows.length === 0) return

  // 랜덤 활성 사용자 위치를 중심으로 ±300m 내에 보스 스폰
  const u = users.rows[Math.floor(Math.random() * users.rows.length)]
  const offsetLat = (Math.random() - 0.5) * 0.005  // ~500m
  const offsetLng = (Math.random() - 0.5) * 0.005
  const type = BOSS_TYPES[Math.floor(Math.random() * BOSS_TYPES.length)]

  const lat = u.lat + offsetLat, lng = u.lng + offsetLng
  await db.query(
    `INSERT INTO world_bosses (boss_type, center_lat, center_lng, max_hp, hp, atk, def, expires_at)
     VALUES ($1, $2, $3, $4, $4, $5, $6, NOW() + INTERVAL '${type.ttlHours} hours')`,
    [type.key, lat, lng, type.hp, type.atk, type.def]
  )
  // 1km 이내 사용자 푸시
  try {
    const { sendPush } = require('../fcm')
    const ub = boxParams(lat, lng, 1000)
    const nearby = await db.query(
      `SELECT fcm_token FROM users WHERE fcm_token IS NOT NULL AND last_seen_at > NOW() - INTERVAL '24 hours'
        AND last_location_lat BETWEEN $3 AND $4
        AND last_location_lng BETWEEN $5 AND $6
        AND SQRT(POW((last_location_lat - $1) * 111000, 2) + POW((last_location_lng - $2) * 88700, 2)) < 1000`,
      [lat, lng, ub.latMin, ub.latMax, ub.lngMin, ub.lngMax]
    )
    for (const u of nearby.rows) {
      await sendPush(u.fcm_token, '👹 월드 보스 출현!',
        `${type.key} (HP ${type.hp})이 근처에 나타났습니다 (${type.ttlHours}h)`,
        { type: 'BOSS_SPAWNED', bossType: type.key })
    }
  } catch {}
  console.log(`[Bosses] spawned ${type.key} at ${lat}, ${lng}`)
}

// 만료된 보스 정리 — 데미지 누적자에게 보상 분배
async function expireOldBosses() {
  const dead = await db.query(`SELECT * FROM world_bosses WHERE rewards_distributed=false
                               AND (dead_at IS NOT NULL OR expires_at < NOW())`)
  for (const b of dead.rows) {
    if (b.dead_at) {  // 처치된 보스만 보상
      const dmg = await db.query(
        `SELECT user_id, total_damage FROM boss_damage WHERE boss_id=$1 ORDER BY total_damage DESC`,
        [b.id]
      )
      const totalDmg = dmg.rows.reduce((s, r) => s + parseInt(r.total_damage), 0)
      if (totalDmg > 0) {
        for (const c of dmg.rows) {
          const share = parseInt(c.total_damage) / totalDmg
          const xp = Math.round(500 * share)
          if (xp > 0) await require('../levels').gainXp(null, c.user_id, xp, 'boss_kill').catch(() => {})
        }
      }
    }
    await db.query(`UPDATE world_bosses SET rewards_distributed=true WHERE id=$1`, [b.id])
  }
}

// 주변 활성 보스 조회 (1km 이내)
router.get('/nearby', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.json({ bosses: [] })
    }
    const bb = boxParams(lat, lng, 1000)
    const r = await db.query(
      `SELECT * FROM world_bosses WHERE dead_at IS NULL AND expires_at > NOW()
        AND center_lat BETWEEN $3 AND $4
        AND center_lng BETWEEN $5 AND $6
        AND SQRT(POW((center_lat - $1) * 111000, 2) + POW((center_lng - $2) * 88700, 2)) < 1000`,
      [lat, lng, bb.latMin, bb.latMax, bb.lngMin, bb.lngMax]
    )
    res.json({ bosses: r.rows.map(b => ({
      id: b.id, type: b.boss_type,
      center: { lat: parseFloat(b.center_lat), lng: parseFloat(b.center_lng) },
      hp: parseInt(b.hp), maxHp: parseInt(b.max_hp),
      atk: parseInt(b.atk), def: parseInt(b.def),
      hpPct: Math.round((parseInt(b.hp) / parseInt(b.max_hp)) * 100),
      expiresAt: b.expires_at ? new Date(b.expires_at).toISOString() : ''
    })) })
  } catch (e) { res.status(500).json({ bosses: [], error: e.message }) }
})

// 보스 공격 — 50m 이내 + 쿨다운 30초
router.post('/:id/attack', async (req, res) => {
  try {
    const { userId, lat, lng } = req.body
    const bossId = req.params.id
    const r = await db.query(`SELECT * FROM world_bosses WHERE id=$1 AND dead_at IS NULL`, [bossId])
    if (r.rows.length === 0) return res.json({ success: false, error: '보스가 없습니다' })
    const boss = r.rows[0]

    // 거리 검증
    const d = Math.sqrt(
      Math.pow((parseFloat(boss.center_lat) - parseFloat(lat)) * 111000, 2) +
      Math.pow((parseFloat(boss.center_lng) - parseFloat(lng)) * 88700, 2)
    )
    if (d > 100) return res.json({ success: false, error: `너무 멉니다 (${Math.round(d)}m)` })

    // 사용자 ATK 가져와서 데미지 계산
    const u = await db.query(`SELECT g.atk FROM guardians g WHERE g.user_id=$1`, [userId])
    const atk = parseInt(u.rows[0]?.atk) || 10
    const dmg = Math.max(1, atk - parseInt(boss.def) + Math.floor(Math.random() * 20 - 5))

    const newHp = Math.max(0, parseInt(boss.hp) - dmg)
    await db.query(`UPDATE world_bosses SET hp=$2 WHERE id=$1`, [bossId, newHp])

    await db.query(
      `INSERT INTO boss_damage (boss_id, user_id, total_damage)
       VALUES ($1, $2, $3)
       ON CONFLICT (boss_id, user_id) DO UPDATE SET total_damage = boss_damage.total_damage + $3, last_hit_at = NOW()`,
      [bossId, userId, dmg]
    )

    // 미션 hook
    require('./missions').progressMission(userId, 'boss_hit', 1).catch(() => {})

    let killed = false
    if (newHp === 0) {
      await db.query(`UPDATE world_bosses SET dead_at=NOW() WHERE id=$1 AND dead_at IS NULL`, [bossId])
      killed = true
    }

    res.json({
      success: true,
      damage: dmg,
      hpRemaining: newHp,
      hpPct: Math.round((newHp / parseInt(boss.max_hp)) * 100),
      killed
    })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

module.exports = router
module.exports.spawnBosses = spawnBosses
module.exports.expireOldBosses = expireOldBosses
