const express = require('express')
const router = express.Router()
const db = require('../db')

// GET /api/activity/summary/:userId
// 마지막 접속(last_seen_at) 이후의 활동 요약 반환
// - 파츠 획득 수
// - 공격받은 횟수 (승/패)
// - 취약 영역 수
// - 레이더보드 순위 변화 (간단 버전)
router.get('/summary/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    const userRes = await db.query(
      'SELECT last_seen_at, username FROM users WHERE id = $1',
      [userId]
    )
    if (userRes.rows.length === 0) return res.status(404).json({ success: false, error: '사용자 없음' })

    const lastSeen = userRes.rows[0].last_seen_at || new Date(0)

    const [partsRes, eventsRes, vulnRes, rankRes] = await Promise.all([
      // 지난 기간 드랍된 파츠
      db.query(
        `SELECT tier, COUNT(*) as count FROM parts
         WHERE user_id = $1 AND created_at > $2
         GROUP BY tier ORDER BY tier`,
        [userId, lastSeen]
      ),
      // 공격받은 이벤트
      db.query(
        `SELECT event_type, data, created_at FROM activity_events
         WHERE user_id = $1 AND created_at > $2
         ORDER BY created_at DESC LIMIT 50`,
        [userId, lastSeen]
      ),
      // 현재 취약 영역
      db.query(
        `SELECT COUNT(*) FROM territories
         WHERE user_id = $1 AND vulnerable_until > NOW()`,
        [userId]
      ),
      // 내 현재 순위 (면적 기준)
      db.query(
        `SELECT my_rank FROM (
           SELECT u.id,
             RANK() OVER (ORDER BY COALESCE(SUM(PI() * t.radius * t.radius), 0) DESC) as my_rank
           FROM users u LEFT JOIN territories t ON t.user_id = u.id
           GROUP BY u.id
         ) r WHERE r.id = $1`,
        [userId]
      )
    ])

    const num = (v, d = 0) => { const n = parseInt(v); return Number.isFinite(n) ? n : d }

    const partsCount = partsRes.rows.reduce((sum, r) => sum + num(r.count), 0)
    const partsByTier = partsRes.rows.map(r => ({ tier: num(r.tier, 1), count: num(r.count) }))

    const attackedEvents = eventsRes.rows.filter(e => e.event_type === 'attacked_by')
    const attackedWon  = attackedEvents.filter(e => e.data?.winner === 'defender').length
    const attackedLost = attackedEvents.filter(e => e.data?.winner === 'attacker').length
    const defeated = eventsRes.rows.some(e => e.event_type === 'defeated')

    const vulnerableCount = num(vulnRes.rows[0]?.count)
    const currentRank = num(rankRes.rows[0]?.my_rank)

    const hasContent = partsCount > 0 || attackedEvents.length > 0 || defeated || vulnerableCount > 0

    await db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [userId])

    res.json({
      success: true,
      lastSeen: lastSeen ? new Date(lastSeen).toISOString() : '',
      hasContent,
      summary: {
        partsCount,
        partsByTier,
        attackedCount: attackedEvents.length,
        attackedWon,
        attackedLost,
        defeated,
        vulnerableCount,
        currentRank
      }
    })
  } catch (err) {
    console.error('Activity summary error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/activity/ping — 앱 실행 중 주기적으로 last_seen_at 갱신
// 하루에 한 번 첫 핑 시 일일 보너스 XP +25
router.post('/ping', async (req, res) => {
  try {
    const { userId } = req.body
    if (!userId) return res.json({ success: false })

    // 일일 첫 접속 체크 (last_seen_at이 24시간 이상 전이면 보너스)
    const u = await db.query('SELECT last_seen_at FROM users WHERE id=$1', [userId])
    const last = u.rows[0]?.last_seen_at
    let dailyBonus = null
    if (!last || (Date.now() - new Date(last).getTime()) > 24 * 60 * 60 * 1000) {
      dailyBonus = await require('../levels').gainXp(null, userId, 25, 'daily_login').catch(() => null)
    }

    await db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [userId])
    res.json({ success: true, dailyBonus })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
