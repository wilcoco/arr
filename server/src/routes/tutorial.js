const express = require('express')
const router = express.Router()
const db = require('../db')

// 튜토리얼 단계 (서버 단일 소스) — β 모델 반영 (1 타워 = 1 영역).
const STEPS = [
  { key: 'welcome',      title: 'Guardian AR에 오신 것을 환영합니다!',
    body: '실제 위치 기반 영역 점령 게임입니다. 타워를 세우면 그 위치 중심으로 영역이 생기고, 영역끼리 부딪히며 전투·협력합니다.' },
  { key: 'create_guardian', title: '1단계: 수호신 생성',
    body: '동물/로봇/비행체 중 하나를 선택해 본체 수호신을 만드세요. 본체 PRD가 영역 에너지를 생산합니다.', cta: '캐릭터 선택' },
  { key: 'expand_first', title: '2단계: 첫 타워(영역) 건설',
    body: '우측 하단 "영역(타워) 건설"을 누르고 슬라이더로 반경(Lv1=최대 50m), 13종 클래스 중 generic을 골라 건설하세요. 타워 1개 = 영역 1개입니다.',
    reward: { xp: 50, energy: 50 } },
  { key: 'visit_storage', title: '3단계: 파츠 수령',
    body: '영역 1시간마다 파츠가 누적됩니다. 영역 50m 이내로 가서 수령하세요.',
    reward: { xp: 50 } },
  { key: 'equip_part',   title: '4단계: 파츠 장착',
    body: '⚙️ PARTS 메뉴에서 받은 파츠를 장착하면 본체 능력치가 강해집니다.',
    reward: { xp: 30 } },
  { key: 'first_battle', title: '5단계: 첫 전투 / 자기-속국',
    body: '내 영역 안에 또 타워를 세우면 자동으로 자기-속국이 됩니다(계약 불필요). 적 영역에 들어가면 전투(공격) 또는 🤝 속국 제안 가능.',
    reward: { xp: 100, energy: 50 } },
  { key: 'alliance',     title: '6단계: 큰 영역의 함정',
    body: '레벨 오르면 영역을 더 크게 잡을 수 있지만, 큰 영역은 방어계수가 약해지고 유지비가 폭발합니다. 동맹/속국으로 보완하세요.',
    reward: { xp: 50 } },
  { key: 'complete',     title: '튜토리얼 완료!',
    body: '이제 자유롭게 영역을 늘리고 황제(Lv30, 10km)에 도전하세요. 큰 영역=리스크↔보상 트레이드오프가 핵심입니다.',
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

// 행동 hook — 다른 라우트에서 사용자 행동 시 자동으로 튜토리얼 단계 advance
async function autoAdvance(userId, actionKey) {
  if (!userId || !actionKey) return
  try {
    const r = await db.query('SELECT tutorial_step FROM users WHERE id=$1', [userId])
    const cur = parseInt(r.rows[0]?.tutorial_step) || 0
    const next = STEPS[cur]
    if (!next || next.key !== actionKey) return
    await db.query('UPDATE users SET tutorial_step = $2 WHERE id = $1', [userId, cur + 1])
    const reward = next.reward || {}
    if (reward.xp)     await require('../levels').gainXp(null, userId, reward.xp, 'tutorial_auto').catch(() => {})
    if (reward.energy) await db.query('UPDATE users SET energy_currency = energy_currency + $1 WHERE id=$2', [reward.energy, userId]).catch(() => {})
  } catch {}
}

module.exports = router
module.exports.STEPS = STEPS
module.exports.autoAdvance = autoAdvance
