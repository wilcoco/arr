const express = require('express')
const router = express.Router()
const db = require('../db')

// 미션 풀 — 매일 3개 랜덤 선택
const MISSION_POOL = [
  { key: 'win_battles_3',      label: '전투 3회 승리',    target: 3,  rewardXp: 100, rewardEnergy: 50,  hook: 'battle_win' },
  { key: 'expand_2',           label: '영역 2개 확장',    target: 2,  rewardXp: 80,  rewardEnergy: 30,  hook: 'territory_expand' },
  { key: 'combine_1',          label: '파츠 합성 1회 성공', target: 1, rewardXp: 60, rewardEnergy: 30,  hook: 'combine_success' },
  { key: 'collect_storage',    label: '저장소 1번 수령',   target: 1,  rewardXp: 50,  rewardEnergy: 20,  hook: 'storage_collect' },
  { key: 'visit_3_locations',  label: '3개 영역 방문 (50m 내)', target: 3, rewardXp: 70, rewardEnergy: 30, hook: 'territory_visit' },
  { key: 'attack_enemy',       label: '적 플레이어 1회 공격', target: 1,  rewardXp: 80,  rewardEnergy: 30,  hook: 'attack_player' },
  { key: 'place_fixed',        label: '고정 수호신 1체 배치', target: 1, rewardXp: 100, rewardEnergy: 50,  hook: 'place_fixed' },
  { key: 'fight_boss',         label: '월드 보스 공격 1회',  target: 1,  rewardXp: 150, rewardEnergy: 80,  hook: 'boss_hit' },
  { key: 'daily_streak',       label: '오늘 접속',          target: 1,  rewardXp: 25,  rewardEnergy: 25,  hook: 'daily_login', auto: true }
]

const todayKey = () => new Date().toISOString().slice(0, 10)

// 오늘 미션 자동 생성 (없으면)
async function ensureDaily(userId) {
  const dk = todayKey()
  const r = await db.query(
    `SELECT * FROM daily_missions WHERE user_id=$1 AND date_key=$2 ORDER BY created_at`,
    [userId, dk]
  )
  if (r.rows.length > 0) return r.rows

  // 3개 랜덤 (auto는 항상 포함)
  const auto = MISSION_POOL.filter(m => m.auto)
  const rest = MISSION_POOL.filter(m => !m.auto)
  const picked = [...auto]
  while (picked.length < 3 && rest.length > 0) {
    const idx = Math.floor(Math.random() * rest.length)
    picked.push(rest.splice(idx, 1)[0])
  }

  for (const m of picked) {
    await db.query(
      `INSERT INTO daily_missions (user_id, mission_key, target, reward_xp, reward_energy, date_key, progress)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, m.key, m.target, m.rewardXp, m.rewardEnergy, dk, m.auto ? 1 : 0]
    )
  }
  // 데일리 로그인 자동 완료
  await db.query(`UPDATE daily_missions SET completed=true WHERE user_id=$1 AND date_key=$2 AND mission_key='daily_streak'`, [userId, dk])

  const reload = await db.query(
    `SELECT * FROM daily_missions WHERE user_id=$1 AND date_key=$2 ORDER BY created_at`,
    [userId, dk]
  )
  return reload.rows
}

// hook 호출 — 다른 라우트에서 진행도 갱신
async function progressMission(userId, hook, amount = 1) {
  if (!userId) return
  const dk = todayKey()
  const ms = MISSION_POOL.filter(m => m.hook === hook).map(m => m.key)
  if (ms.length === 0) return
  for (const key of ms) {
    await db.query(
      `UPDATE daily_missions SET progress = LEAST(target, progress + $3),
                                 completed = (progress + $3 >= target)
       WHERE user_id=$1 AND date_key=$2 AND mission_key=$4 AND completed=false`,
      [userId, dk, amount, key]
    ).catch(() => {})
  }
}

router.get('/today/:userId', async (req, res) => {
  try {
    const rows = await ensureDaily(req.params.userId)
    res.json({ success: true, missions: rows.map(r => ({
      id: r.id, key: r.mission_key,
      label: MISSION_POOL.find(m => m.key === r.mission_key)?.label || r.mission_key,
      progress: r.progress, target: r.target,
      completed: r.completed, claimed: r.claimed,
      rewardXp: r.reward_xp, rewardEnergy: r.reward_energy
    })) })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

router.post('/claim', async (req, res) => {
  try {
    const { userId, missionId } = req.body
    const r = await db.query('SELECT * FROM daily_missions WHERE id=$1 AND user_id=$2', [missionId, userId])
    const m = r.rows[0]
    if (!m) return res.json({ success: false, error: '미션을 찾을 수 없습니다' })
    if (m.claimed) return res.json({ success: false, error: '이미 수령했습니다' })
    if (!m.completed) return res.json({ success: false, error: '아직 완료되지 않았습니다' })

    await db.query('UPDATE daily_missions SET claimed=true WHERE id=$1', [missionId])
    if (m.reward_xp)     await require('../levels').gainXp(null, userId, m.reward_xp, 'mission').catch(() => {})
    if (m.reward_energy) await db.query('UPDATE users SET energy_currency = energy_currency + $1 WHERE id=$2', [m.reward_energy, userId])

    res.json({ success: true, reward: { xp: m.reward_xp, energy: m.reward_energy } })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

module.exports = router
module.exports.progressMission = progressMission
module.exports.ensureDaily = ensureDaily
module.exports.MISSION_POOL = MISSION_POOL
