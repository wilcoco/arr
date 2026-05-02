const express = require('express')
const router = express.Router()
const db = require('../db')

// 길드 생성
router.post('/create', async (req, res) => {
  try {
    const { userId, name } = req.body
    if (!userId || !name || name.length < 2 || name.length > 30) {
      return res.json({ success: false, error: '길드 이름은 2-30자' })
    }
    const u = await db.query('SELECT guild_id, energy_currency FROM users WHERE id=$1', [userId])
    if (u.rows[0]?.guild_id) return res.json({ success: false, error: '이미 길드에 소속됨' })
    if (parseInt(u.rows[0]?.energy_currency) < 200) return res.json({ success: false, error: '에너지 200 필요' })

    const exists = await db.query('SELECT id FROM guilds WHERE name=$1', [name])
    if (exists.rows.length > 0) return res.json({ success: false, error: '이미 사용 중인 이름' })

    const g = await db.query(
      `INSERT INTO guilds (name, leader_id, member_count) VALUES ($1, $2, 1) RETURNING *`,
      [name, userId]
    )
    await db.query('UPDATE users SET guild_id = $1, energy_currency = energy_currency - 200 WHERE id = $2',
                   [g.rows[0].id, userId])
    res.json({ success: true, guild: g.rows[0] })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

router.post('/join', async (req, res) => {
  try {
    const { userId, guildId } = req.body
    const u = await db.query('SELECT guild_id FROM users WHERE id=$1', [userId])
    if (u.rows[0]?.guild_id) return res.json({ success: false, error: '이미 길드 소속' })
    const g = await db.query('SELECT * FROM guilds WHERE id=$1', [guildId])
    if (g.rows.length === 0) return res.json({ success: false, error: '길드 없음' })
    if (g.rows[0].member_count >= g.rows[0].max_members) return res.json({ success: false, error: '인원 만석' })

    await db.query('UPDATE users SET guild_id=$1 WHERE id=$2', [guildId, userId])
    await db.query('UPDATE guilds SET member_count = member_count + 1 WHERE id=$1', [guildId])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

router.post('/leave', async (req, res) => {
  try {
    const { userId } = req.body
    const u = await db.query('SELECT guild_id FROM users WHERE id=$1', [userId])
    const gid = u.rows[0]?.guild_id
    if (!gid) return res.json({ success: false, error: '길드 미소속' })
    await db.query('UPDATE users SET guild_id=NULL WHERE id=$1', [userId])
    await db.query('UPDATE guilds SET member_count = GREATEST(0, member_count - 1) WHERE id=$1', [gid])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

// 내 길드 정보 + 멤버
router.get('/my/:userId', async (req, res) => {
  try {
    const u = await db.query('SELECT guild_id FROM users WHERE id=$1', [req.params.userId])
    const gid = u.rows[0]?.guild_id
    if (!gid) return res.json({ success: true, guild: null })
    const g = await db.query('SELECT * FROM guilds WHERE id=$1', [gid])
    const members = await db.query(
      `SELECT id, username, COALESCE(level,1) AS level, COALESCE(battle_wins,0) AS battle_wins
       FROM users WHERE guild_id=$1 ORDER BY level DESC LIMIT 50`,
      [gid]
    )
    res.json({ success: true, guild: g.rows[0], members: members.rows })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

// 길드 목록 (가입 가능)
router.get('/list', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, name, member_count, max_members FROM guilds
        WHERE member_count < max_members ORDER BY member_count DESC LIMIT 30`
    )
    res.json({ guilds: r.rows })
  } catch (e) { res.status(500).json({ guilds: [], error: e.message }) }
})

// 채팅
router.post('/chat', async (req, res) => {
  try {
    const { userId, message } = req.body
    if (!message || message.length > 200) return res.json({ success: false, error: '메시지 1~200자' })
    const u = await db.query('SELECT guild_id FROM users WHERE id=$1', [userId])
    const gid = u.rows[0]?.guild_id
    if (!gid) return res.json({ success: false, error: '길드 미소속' })
    await db.query(
      `INSERT INTO guild_messages (guild_id, user_id, message) VALUES ($1, $2, $3)`,
      [gid, userId, message]
    )
    res.json({ success: true })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

router.get('/chat/:userId', async (req, res) => {
  try {
    const u = await db.query('SELECT guild_id FROM users WHERE id=$1', [req.params.userId])
    const gid = u.rows[0]?.guild_id
    if (!gid) return res.json({ messages: [] })
    const r = await db.query(
      `SELECT gm.*, u.username FROM guild_messages gm JOIN users u ON gm.user_id=u.id
       WHERE gm.guild_id=$1 ORDER BY gm.created_at DESC LIMIT 50`,
      [gid]
    )
    res.json({ messages: r.rows.reverse() })
  } catch (e) { res.status(500).json({ messages: [], error: e.message }) }
})

module.exports = router
