const express = require('express')
const router = express.Router()
const db = require('../db')

// 튜토리얼 단계 (서버 단일 소스)
const STEPS = [
  { key: 'welcome',      title: 'Guardian AR에 오신 것을 환영합니다!',
    body: '실제 위치를 기반으로 영역을 점령하고 다른 플레이어와 전투/협력하는 게임입니다.' },
  { key: 'create_guardian', title: '1단계: 수호신 생성',
    body: '동물/로봇/비행체 중 하나를 선택해 수호신을 만드세요.', cta: '캐릭터 선택' },
  { key: 'expand_first', title: '2단계: 첫 영역 확장',
    body: '하단 EXPAND 버튼으로 현재 위치에 영역을 만드세요. 50m가 시작에 좋습니다.',
    reward: { xp: 50, energy: 50 } },
  { key: 'visit_storage', title: '3단계: 파츠 수령',
    body: '영역 1시간마다 파츠가 누적됩니다. 영역에 50m 이내로 가서 수령하세요.',
    reward: { xp: 50 } },
  { key: 'equip_part',   title: '4단계: 파츠 장착',
    body: 'PARTS 메뉴에서 받은 파츠를 장착하면 능력치가 강해집니다.',
    reward: { xp: 30 } },
  { key: 'first_battle', title: '5단계: 첫 전투',
    body: '주변에 다른 플레이어/고정 수호신이 있다면 탭해서 전투를 시도하세요.',
    reward: { xp: 100, energy: 50 } },
  { key: 'alliance',     title: '6단계: 동맹의 힘',
    body: '혼자보다 동맹이 강력합니다. 영역 4개 이상 운영 시 분산 패널티 — 동맹 시너지로 회복됩니다.',
    reward: { xp: 50 } },
  { key: 'complete',     title: '튜토리얼 완료!',
    body: '이제 자유롭게 영역을 늘리고 호구로 적을 잡으세요. Lv.20까지 성장할 수 있습니다.',
    reward: { xp: 200, energy: 100 } }
]

router.get('/steps', (req, res) => {
  res.json({ steps: STEPS })
})

router.get('/state/:userId', async (req, res) => {
  try {
    const r = await db.query('SELECT tutorial_step FROM users WHERE id=$1', [req.params.userId])
    const step = parseInt(r.rows[0]?.tutorial_step) || 0
    res.json({
      success: true,
      step,
      completed: step >= STEPS.length,
      currentStep: STEPS[step] || null
    })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

// 다음 단계로 진행 + 보상 지급
router.post('/advance', async (req, res) => {
  try {
    const { userId, expectedKey } = req.body
    const r = await db.query('SELECT tutorial_step FROM users WHERE id=$1', [userId])
    const cur = parseInt(r.rows[0]?.tutorial_step) || 0
    const next = STEPS[cur]
    if (!next) return res.json({ success: false, error: '튜토리얼 이미 완료' })
    if (expectedKey && next.key !== expectedKey) {
      return res.json({ success: false, error: 'step mismatch', current: cur })
    }

    await db.query('UPDATE users SET tutorial_step = $2 WHERE id = $1', [userId, cur + 1])

    const reward = next.reward || {}
    if (reward.xp)     await require('../levels').gainXp(null, userId, reward.xp, 'tutorial').catch(() => {})
    if (reward.energy) await db.query('UPDATE users SET energy_currency = energy_currency + $1 WHERE id=$2', [reward.energy, userId]).catch(() => {})

    res.json({
      success: true, step: cur + 1, completed: cur + 1 >= STEPS.length,
      reward: reward, nextStep: STEPS[cur + 1] || null
    })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

module.exports = router
module.exports.STEPS = STEPS
