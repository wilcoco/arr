const express = require('express')
const router = express.Router()
const db = require('../db')

// 영역 확장
router.post('/expand', async (req, res) => {
  try {
    const { userId, lat, lng, radius } = req.body

    const result = await db.query(
      `INSERT INTO territories (user_id, center_lat, center_lng, radius)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, lat, lng, radius]
    )

    res.json({
      success: true,
      territory: {
        id: result.rows[0].id,
        center: { lat, lng },
        radius,
        createdAt: result.rows[0].created_at
      }
    })
  } catch (err) {
    console.error('Territory expand error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 고정 수호신 배치
router.post('/place-guardian', async (req, res) => {
  try {
    const { territoryId, userId, lat, lng, stats, guardianType } = req.body

    // 본체 수호신 능력치 차감
    const guardian = await db.query(
      'SELECT * FROM guardians WHERE user_id = $1',
      [userId]
    )

    if (guardian.rows.length === 0) {
      return res.status(400).json({ success: false, error: '수호신이 없습니다' })
    }

    const g = guardian.rows[0]

    // 능력치 분배 가능 확인
    if (g.atk < stats.atk || g.def < stats.def || g.hp < stats.hp) {
      return res.status(400).json({ success: false, error: '능력치가 부족합니다' })
    }

    // 본체 능력치 차감
    await db.query(
      `UPDATE guardians SET atk = atk - $1, def = def - $2, hp = hp - $3
       WHERE user_id = $4`,
      [stats.atk, stats.def, stats.hp, userId]
    )

    // 고정 수호신 생성
    const result = await db.query(
      `INSERT INTO fixed_guardians (territory_id, user_id, position_lat, position_lng, atk, def, hp, guardian_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [territoryId, userId, lat, lng, stats.atk, stats.def, stats.hp, guardianType || 'defense']
    )

    res.json({
      success: true,
      fixedGuardian: {
        id: result.rows[0].id,
        position: { lat, lng },
        stats,
        type: guardianType
      }
    })
  } catch (err) {
    console.error('Place guardian error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 주변 영역 조회 (침입 감지용)
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, radius, excludeUserId } = req.query

    if (!lat || !lng || !excludeUserId) {
      return res.json({ territories: [] })
    }

    const result = await db.query(
      `SELECT t.*, u.username
       FROM territories t
       JOIN users u ON t.user_id = u.id
       WHERE t.user_id::text != $1
       LIMIT 20`,
      [excludeUserId]
    )

    res.json({
      territories: result.rows.map(t => ({
        id: t.id,
        userId: t.user_id,
        username: t.username,
        center: { lat: t.center_lat, lng: t.center_lng },
        radius: t.radius
      }))
    })
  } catch (err) {
    console.error('Nearby territories error:', err)
    res.json({ territories: [] })
  }
})

// 내 영역 목록
router.get('/my/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    const territories = await db.query(
      'SELECT * FROM territories WHERE user_id = $1',
      [userId]
    )

    const fixedGuardians = await db.query(
      'SELECT * FROM fixed_guardians WHERE user_id = $1',
      [userId]
    )

    res.json({
      territories: territories.rows.map(t => ({
        id: t.id,
        center: { lat: t.center_lat, lng: t.center_lng },
        radius: t.radius
      })),
      fixedGuardians: fixedGuardians.rows.map(fg => ({
        id: fg.id,
        territoryId: fg.territory_id,
        position: { lat: fg.position_lat, lng: fg.position_lng },
        stats: { atk: fg.atk, def: fg.def, hp: fg.hp },
        type: fg.guardian_type
      }))
    })
  } catch (err) {
    console.error('My territories error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 영역 침입 체크
router.post('/check-intrusion', async (req, res) => {
  try {
    const { userId, lat, lng } = req.body

    if (!userId || lat === undefined || lng === undefined) {
      return res.json({ intruded: false, territory: null })
    }

    // 현재 위치가 다른 사람 영역 안에 있는지 확인
    const result = await db.query(
      `SELECT t.*, u.username
       FROM territories t
       JOIN users u ON t.user_id = u.id
       WHERE t.user_id::text != $1
         AND SQRT(POW(t.center_lat - $2, 2) + POW(t.center_lng - $3, 2)) * 111000 < t.radius`,
      [userId, lat, lng]
    )

    if (result.rows.length > 0) {
      const territory = result.rows[0]
      res.json({
        intruded: true,
        territory: {
          id: territory.id,
          userId: territory.user_id,
          username: territory.username,
          center: { lat: territory.center_lat, lng: territory.center_lng },
          radius: territory.radius
        }
      })
    } else {
      res.json({ intruded: false, territory: null })
    }
  } catch (err) {
    console.error('Check intrusion error:', err)
    res.json({ intruded: false, territory: null })
  }
})

// 주변 고정 수호신 조회
router.get('/nearby-fixed-guardians', async (req, res) => {
  try {
    const { lat, lng, radius, excludeUserId } = req.query

    // 파라미터 검증
    if (!lat || !lng || !excludeUserId) {
      return res.json({ fixedGuardians: [] })
    }

    const degreeRadius = parseFloat(radius || 1000) / 111000

    const result = await db.query(
      `SELECT fg.*, u.username, t.center_lat, t.center_lng, t.radius as territory_radius
       FROM fixed_guardians fg
       JOIN users u ON fg.user_id = u.id
       JOIN territories t ON fg.territory_id = t.id
       WHERE fg.user_id::text != $1
       LIMIT 50`,
      [excludeUserId || '']
    )

    res.json({
      fixedGuardians: result.rows.map(fg => ({
        id: fg.id,
        owner: fg.username,
        ownerId: fg.user_id,
        position: { lat: fg.position_lat, lng: fg.position_lng },
        stats: { atk: fg.atk, def: fg.def, hp: fg.hp },
        type: fg.guardian_type,
        territoryId: fg.territory_id
      }))
    })
  } catch (err) {
    console.error('Nearby fixed guardians error:', err)
    // 테이블 없거나 에러 시 빈 배열 반환
    res.json({ fixedGuardians: [] })
  }
})

module.exports = router
