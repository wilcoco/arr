const express = require('express')
const router = express.Router()
const db = require('../db')

const COLLECT_RADIUS_METERS = 50

// 두 좌표 간 거리(m) — Haversine 간단 버전
function distMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const toRad = (d) => d * Math.PI / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const sa = Math.sin(dLat / 2) ** 2 +
             Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) *
             Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(sa))
}

// GET /api/fixed-guardian/:id/storage  — 저장소 조회 (소유자만)
router.get('/:id/storage', async (req, res) => {
  try {
    const { id } = req.params
    const fg = await db.query('SELECT * FROM fixed_guardians WHERE id=$1', [id])
    if (fg.rows.length === 0) return res.status(404).json({ success: false, error: 'not_found' })

    const items = await db.query(
      `SELECT * FROM fixed_guardian_storage WHERE fixed_guardian_id=$1 ORDER BY created_at ASC`,
      [id]
    )
    const num = (v, d = 0) => { const n = parseInt(v); return Number.isFinite(n) ? n : d }
    res.json({
      success: true,
      ownerId: fg.rows[0].user_id || '',
      capacity: num(fg.rows[0].storage_capacity, 5),
      count: items.rows.length,
      isFull: items.rows.length >= num(fg.rows[0].storage_capacity, 5),
      items: items.rows.map(it => ({
        id: it.id,
        itemType: it.item_type,
        data: it.data || {}
      }))
    })
  } catch (e) {
    console.error('storage error', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// POST /api/fixed-guardian/:id/collect  — 50m 이내 + 소유자 검증 후 수령
// body: { userId, lat, lng }
router.post('/:id/collect', async (req, res) => {
  try {
    const { id } = req.params
    const { userId, lat, lng } = req.body
    if (!userId) return res.status(400).json({ success: false, error: 'userId 필요' })

    const fg = await db.query(
      `SELECT fg.*, t.center_lat, t.center_lng FROM fixed_guardians fg
       JOIN territories t ON fg.territory_id = t.id WHERE fg.id=$1`,
      [id]
    )
    if (fg.rows.length === 0) return res.status(404).json({ success: false, error: '고정 수호신 없음' })
    const f = fg.rows[0]

    if (f.user_id !== userId) {
      return res.json({ success: false, error: '소유자만 수령 가능합니다' })
    }

    // 위치 검증 (영역 중심에서 50m 이내)
    const lat0 = parseFloat(lat), lng0 = parseFloat(lng)
    if (!Number.isFinite(lat0) || !Number.isFinite(lng0)) {
      return res.json({ success: false, error: '위치 정보 필요' })
    }
    const d = distMeters(lat0, lng0, parseFloat(f.center_lat), parseFloat(f.center_lng))
    if (d > COLLECT_RADIUS_METERS) {
      return res.json({
        success: false,
        error: `너무 멀리 있습니다 (${Math.round(d)}m). ${COLLECT_RADIUS_METERS}m 이내 접근 필요.`,
        distance: Math.round(d)
      })
    }

    // 저장소의 모든 아이템 사용자에게 이전
    const items = await db.query(
      `SELECT * FROM fixed_guardian_storage WHERE fixed_guardian_id=$1`,
      [id]
    )
    if (items.rows.length === 0) {
      return res.json({ success: true, collected: { parts: 0, energy: 0, revenue: 0 } })
    }

    let collectedParts = 0, collectedEnergy = 0, collectedRevenue = 0

    await db.transaction(async (client) => {
      for (const it of items.rows) {
        if (it.item_type === 'part') {
          const d = it.data || {}
          await client.query(
            `INSERT INTO parts (user_id, slot, tier, guardian_type, stat_bonuses, passives)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, d.slot || 'head', parseInt(d.tier) || 1, d.guardian_type || 'animal',
             JSON.stringify(d.stat_bonuses || {}), JSON.stringify(d.passives || [])]
          )
          collectedParts++
        } else if (it.item_type === 'energy') {
          const amt = parseInt(it.data?.amount) || 0
          await client.query('UPDATE users SET energy_currency = energy_currency + $1 WHERE id=$2', [amt, userId])
          collectedEnergy += amt
        } else if (it.item_type === 'revenue') {
          const amt = parseInt(it.data?.amount) || 0
          await client.query('UPDATE users SET energy_currency = energy_currency + $1 WHERE id=$2', [amt, userId])
          collectedRevenue += amt
        }
      }
      await client.query(`DELETE FROM fixed_guardian_storage WHERE fixed_guardian_id=$1`, [id])
    })

    require('./missions').progressMission(userId, 'storage_collect', 1).catch(() => {})
    require('./tutorial').autoAdvance(userId, 'visit_storage').catch(() => {})

    res.json({
      success: true,
      collected: { parts: collectedParts, energy: collectedEnergy, revenue: collectedRevenue }
    })
  } catch (e) {
    console.error('collect error', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// 내 모든 고정 수호신 저장소 요약 (UI에서 한꺼번에 표시)
router.get('/my/:userId/storage-summary', async (req, res) => {
  try {
    const { userId } = req.params
    const result = await db.query(
      `SELECT fg.id, fg.user_id, fg.storage_capacity,
              t.id as territory_id, t.center_lat, t.center_lng, t.radius,
              COUNT(s.id) AS stored_count
       FROM fixed_guardians fg
       LEFT JOIN territories t ON fg.territory_id = t.id
       LEFT JOIN fixed_guardian_storage s ON s.fixed_guardian_id = fg.id
       WHERE fg.user_id = $1
       GROUP BY fg.id, t.id`,
      [userId]
    )
    const num = (v, d = 0) => { const n = parseInt(v); return Number.isFinite(n) ? n : d }
    const fnum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
    res.json({
      success: true,
      guardians: result.rows.map(r => ({
        id: r.id,
        territoryId: r.territory_id,
        center: { lat: fnum(r.center_lat), lng: fnum(r.center_lng) },
        radius: fnum(r.radius),
        capacity: num(r.storage_capacity, 5),
        storedCount: num(r.stored_count),
        isFull: num(r.stored_count) >= num(r.storage_capacity, 5)
      }))
    })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

module.exports = router
module.exports.distMeters = distMeters
module.exports.COLLECT_RADIUS_METERS = COLLECT_RADIUS_METERS
