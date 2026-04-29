const express = require('express')
const router = express.Router()
const db = require('../db')

// 동맹 목록 조회
router.get('/my/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    const result = await db.query(
      `SELECT a.*,
              u1.username as user1_name,
              u2.username as user2_name
       FROM alliances a
       JOIN users u1 ON a.user_id_1 = u1.id
       JOIN users u2 ON a.user_id_2 = u2.id
       WHERE (a.user_id_1 = $1 OR a.user_id_2 = $1)
         AND a.active = true`,
      [userId]
    )

    res.json({
      alliances: result.rows.map(a => ({
        id: a.id,
        allyId: a.user_id_1 === userId ? a.user_id_2 : a.user_id_1,
        allyName: a.user_id_1 === userId ? a.user2_name : a.user1_name,
        createdAt: a.created_at
      }))
    })
  } catch (err) {
    console.error('Get alliances error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 배신 (동맹 해제)
router.post('/betray', async (req, res) => {
  try {
    const { allianceId, visitorId } = req.body

    const user = await db.query(
      'SELECT id FROM users WHERE username = $1',
      [visitorId]
    )

    if (user.rows.length === 0) {
      return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다' })
    }

    const userId = user.rows[0].id

    // 동맹 확인
    const alliance = await db.query(
      'SELECT * FROM alliances WHERE id = $1 AND (user_id_1 = $2 OR user_id_2 = $2)',
      [allianceId, userId]
    )

    if (alliance.rows.length === 0) {
      return res.status(404).json({ success: false, error: '동맹을 찾을 수 없습니다' })
    }

    // 동맹 해제
    await db.query(
      'UPDATE alliances SET active = false, dissolved_at = NOW() WHERE id = $1',
      [allianceId]
    )

    // 배신자: 24시간 동맹 금지 + 알림
    await db.query(
      `UPDATE users SET betrayal_blocked_until = NOW() + INTERVAL '24 hours' WHERE id = $1`,
      [userId]
    )

    // 상대방에게 배신 알림
    const { sendPush } = require('../fcm')
    const allyId = alliance.rows[0].user_id_1 === userId
      ? alliance.rows[0].user_id_2
      : alliance.rows[0].user_id_1
    const allyToken = await db.query('SELECT fcm_token, username FROM users WHERE id = $1', [allyId])
    await sendPush(
      allyToken.rows[0]?.fcm_token,
      '🗡️ 배신!',
      `${visitorId}이(가) 동맹을 배신했습니다!`,
      { type: 'BETRAYAL', betrayerId: userId }
    )

    res.json({
      success: true,
      message: '동맹이 해제되었습니다. 공동 방어가 비활성화됩니다.'
    })
  } catch (err) {
    console.error('Betray error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 공동 방어 체크
router.post('/check-joint-defense', async (req, res) => {
  try {
    const { territoryId, defenderId } = req.body

    // 방어자의 동맹 조회
    const alliances = await db.query(
      `SELECT a.*,
              CASE WHEN a.user_id_1 = $1 THEN a.user_id_2 ELSE a.user_id_1 END as ally_id
       FROM alliances a
       WHERE (a.user_id_1 = $1 OR a.user_id_2 = $1)
         AND a.active = true`,
      [defenderId]
    )

    if (alliances.rows.length === 0) {
      return res.json({ hasJointDefense: false, allies: [] })
    }

    // 동맹의 인접 영역 확인
    const territory = await db.query(
      'SELECT * FROM territories WHERE id = $1',
      [territoryId]
    )

    if (territory.rows.length === 0) {
      return res.json({ hasJointDefense: false, allies: [] })
    }

    const t = territory.rows[0]
    const adjacentAllies = []

    for (const alliance of alliances.rows) {
      const allyTerritories = await db.query(
        `SELECT * FROM territories
         WHERE user_id = $1
           AND ABS(center_lat - $2) < 0.01
           AND ABS(center_lng - $3) < 0.01`,
        [alliance.ally_id, t.center_lat, t.center_lng]
      )

      if (allyTerritories.rows.length > 0) {
        const allyGuardian = await db.query(
          'SELECT * FROM guardians WHERE user_id = $1',
          [alliance.ally_id]
        )

        const allyUser = await db.query(
          'SELECT username FROM users WHERE id = $1',
          [alliance.ally_id]
        )

        adjacentAllies.push({
          allyId: alliance.ally_id,
          allyName: allyUser.rows[0]?.username,
          stats: allyGuardian.rows[0] ? {
            atk: allyGuardian.rows[0].atk,
            def: allyGuardian.rows[0].def
          } : null
        })
      }
    }

    res.json({
      hasJointDefense: adjacentAllies.length > 0,
      allies: adjacentAllies
    })
  } catch (err) {
    console.error('Check joint defense error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
