const express = require('express')
const router = express.Router()
const db = require('../db')

// 수호신 생성
router.post('/create', async (req, res) => {
  try {
    const { visitorId, type, parts } = req.body

    // 먼저 사용자 생성 또는 조회
    let userResult = await db.query(
      'SELECT id FROM users WHERE username = $1',
      [visitorId]
    )

    let userId
    if (userResult.rows.length === 0) {
      // 새 사용자 생성
      const newUser = await db.query(
        'INSERT INTO users (username, energy_currency) VALUES ($1, 100) RETURNING id',
        [visitorId]
      )
      userId = newUser.rows[0].id
    } else {
      userId = userResult.rows[0].id
    }

    // 기존 수호신 확인
    const existingGuardian = await db.query(
      'SELECT id FROM guardians WHERE user_id = $1',
      [userId]
    )

    if (existingGuardian.rows.length > 0) {
      return res.status(400).json({ success: false, error: '이미 수호신이 있습니다' })
    }

    // 타입별 기본 스탯
    const baseStats = {
      animal: { atk: 10, def: 8, hp: 100, abs: 15, prd: 10, spd: 15, rng: 10, ter: 10 },
      robot: { atk: 15, def: 15, hp: 120, abs: 10, prd: 8, spd: 8, rng: 10, ter: 10 },
      aircraft: { atk: 12, def: 8, hp: 80, abs: 12, prd: 12, spd: 12, rng: 20, ter: 15 }
    }

    const stats = baseStats[type] || baseStats.animal

    // 수호신 생성
    const result = await db.query(
      `INSERT INTO guardians (user_id, type, parts, atk, def, hp, abs, prd, spd, rng, ter)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [userId, type, JSON.stringify(parts || {}), stats.atk, stats.def, stats.hp, stats.abs, stats.prd, stats.spd, stats.rng, stats.ter]
    )

    res.json({
      success: true,
      guardian: {
        id: result.rows[0].id,
        type: result.rows[0].type,
        stats: {
          atk: result.rows[0].atk,
          def: result.rows[0].def,
          hp: result.rows[0].hp,
          abs: result.rows[0].abs,
          prd: result.rows[0].prd,
          spd: result.rows[0].spd,
          rng: result.rows[0].rng,
          ter: result.rows[0].ter
        }
      },
      userId
    })
  } catch (err) {
    console.error('Guardian create error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 주변 플레이어 조회 (/:visitorId 보다 먼저 정의해야 함!)
router.get('/nearby-players', async (req, res) => {
  try {
    const { lat, lng, radius, excludeUserId } = req.query

    if (!lat || !lng || !excludeUserId) {
      return res.json({ players: [] })
    }

    // 1도 ≈ 111km
    const degreeRadius = parseFloat(radius || 1000) / 111000

    const result = await db.query(
      `SELECT u.id, u.username, u.last_location_lat, u.last_location_lng, u.is_online,
              g.type as guardian_type, g.atk, g.def, g.hp
       FROM users u
       LEFT JOIN guardians g ON u.id = g.user_id
       WHERE u.last_location_lat IS NOT NULL
         AND u.last_location_lng IS NOT NULL
         AND u.id != $4
         AND u.last_location_lat BETWEEN $1 - $3 AND $1 + $3
         AND u.last_location_lng BETWEEN $2 - $3 AND $2 + $3
       ORDER BY ABS(u.last_location_lat - $1) + ABS(u.last_location_lng - $2)
       LIMIT 50`,
      [parseFloat(lat), parseFloat(lng), degreeRadius, excludeUserId]
    )

    res.json({
      players: result.rows.map(p => ({
        id: p.id,
        username: p.username,
        location: { lat: p.last_location_lat, lng: p.last_location_lng },
        isOnline: p.is_online,
        guardian: p.guardian_type ? {
          type: p.guardian_type,
          stats: { atk: p.atk, def: p.def, hp: p.hp }
        } : null
      }))
    })
  } catch (err) {
    console.error('Nearby players error:', err)
    res.json({ players: [] })
  }
})

// 수호신 조회 (주의: 이 라우트는 /nearby-players 뒤에 있어야 함)
router.get('/:visitorId', async (req, res) => {
  try {
    const { visitorId } = req.params

    const result = await db.query(
      `SELECT g.*, u.id as user_id, u.energy_currency
       FROM guardians g
       JOIN users u ON g.user_id = u.id
       WHERE u.username = $1`,
      [visitorId]
    )

    if (result.rows.length === 0) {
      return res.json({ guardian: null })
    }

    const g = result.rows[0]
    res.json({
      guardian: {
        id: g.id,
        type: g.type,
        stats: {
          atk: g.atk,
          def: g.def,
          hp: g.hp,
          abs: g.abs,
          prd: g.prd,
          spd: g.spd,
          rng: g.rng,
          ter: g.ter
        }
      },
      userId: g.user_id,
      energy: g.energy_currency
    })
  } catch (err) {
    console.error('Guardian get error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 위치 업데이트
router.post('/location', async (req, res) => {
  try {
    const { visitorId, lat, lng } = req.body

    await db.query(
      `UPDATE users SET last_location_lat = $1, last_location_lng = $2, is_online = true
       WHERE username = $3`,
      [lat, lng, visitorId]
    )

    res.json({ success: true })
  } catch (err) {
    console.error('Location update error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
