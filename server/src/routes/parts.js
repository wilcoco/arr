const express = require('express')
const router = express.Router()
const db = require('../db')

// ─── 파츠 슬롯 / 티어 설정 ────────────────────────────────────────
const SLOT_CONFIG = {
  head:  { primary: 'rng', secondary: null },
  body:  { primary: 'hp',  secondary: 'def' },
  arms:  { primary: 'atk', secondary: null },
  legs:  { primary: 'spd', secondary: null },
  core:  { primary: 'prd', secondary: 'abs' }
}

// 티어별 스탯 보너스 범위 (flat)
const TIER_BONUS = {
  1: { primary: [2, 5],    secondary: [1, 2] },
  2: { primary: [5, 10],   secondary: [2, 5] },
  3: { primary: [10, 18],  secondary: [5, 9] },
  4: { primary: [18, 30],  secondary: [9, 18] },
  5: { primary: [30, 50],  secondary: [18, 30] }
}

const PASSIVES_CATALOG = {
  fortify:   { trigger: 'hp_low',      effect: 'def_boost',  value: 0.20, desc: 'HP 30% 미만 시 DEF +20%' },
  harvest:   { trigger: 'warning',     effect: 'prd_boost',  value: 0.30, desc: '영역 경고 중 PRD +30%' },
  shield:    { trigger: 'battle',      effect: 'negate',     value: 0.10, desc: '전투 피해 10% 확률 무효' },
  overclock: { trigger: 'battle',      effect: 'atk_boost',  value: 0.15, desc: '전투 시작 ATK +15%' },
  regenerate:{ trigger: 'tick',        effect: 'hp_restore', value: 0.05, desc: '경제 틱마다 HP 5% 회복' },
  precision: { trigger: 'always',      effect: 'rng_boost',  value: 0.25, desc: 'RNG 상시 +25%' },
  ironwall:  { trigger: 'always',      effect: 'def_flat',   value: 15,   desc: 'DEF 상시 +15' },
  berserker: { trigger: 'always',      effect: 'atk_boost',  value: 0.10, desc: 'ATK 상시 +10%' }
}

function rand(min, max) { return Math.floor(min + Math.random() * (max - min + 1)) }

function generatePartStats(slot, tier, guardianType) {
  const cfg = SLOT_CONFIG[slot] || SLOT_CONFIG.arms
  const tb  = TIER_BONUS[tier]   || TIER_BONUS[1]

  const bonuses = {}
  // HP는 5배 스케일
  const primaryRange = cfg.primary === 'hp'
    ? [tb.primary[0] * 5, tb.primary[1] * 5]
    : tb.primary
  bonuses[cfg.primary] = rand(primaryRange[0], primaryRange[1])

  if (cfg.secondary) {
    bonuses[cfg.secondary] = rand(tb.secondary[0], tb.secondary[1])
  }

  // T3 이상 패시브 부여
  const passiveKeys = Object.keys(PASSIVES_CATALOG)
  const passives = []
  if (tier >= 3) {
    passives.push(passiveKeys[Math.floor(Math.random() * passiveKeys.length)])
  }
  if (tier >= 5) {
    let second
    do { second = passiveKeys[Math.floor(Math.random() * passiveKeys.length)] }
    while (second === passives[0])
    passives.push(second)
  }

  return { stat_bonuses: bonuses, passives }
}

// 장착 파츠 기반 유효 스탯 계산 (export용)
async function computeEffectiveStats(userId, baseStats) {
  const equipped = await db.query(
    'SELECT * FROM parts WHERE user_id = $1 AND equipped = true',
    [userId]
  )
  const stats = { ...baseStats }
  const activePassives = []

  for (const part of equipped.rows) {
    for (const [stat, val] of Object.entries(part.stat_bonuses || {})) {
      if (stats[stat] !== undefined) stats[stat] += val
    }
    for (const pid of (part.passives || [])) {
      const p = PASSIVES_CATALOG[pid]
      if (!p) continue
      if (p.trigger === 'always') {
        if (p.effect === 'rng_boost') stats.rng = Math.round(stats.rng * (1 + p.value))
        if (p.effect === 'def_flat')  stats.def += p.value
        if (p.effect === 'atk_boost') stats.atk = Math.round(stats.atk * (1 + p.value))
      }
      activePassives.push({ id: pid, ...p })
    }
  }
  return { stats, equippedParts: equipped.rows, activePassives }
}

// ─── 라우터 ───────────────────────────────────────────────────────

// 내 파츠 목록
router.get('/my/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const result = await db.query(
      'SELECT * FROM parts WHERE user_id = $1 ORDER BY tier DESC, equipped DESC, created_at DESC',
      [userId]
    )
    // stat_bonuses/passives JSONB 정규화 + Unity 호환 success 플래그
    const parts = result.rows.map(p => ({
      id: p.id,
      slot: p.slot,
      tier: parseInt(p.tier) || 1,
      guardian_type: p.guardian_type || '',
      stat_bonuses: p.stat_bonuses || {},
      passives: Array.isArray(p.passives) ? p.passives : [],
      equipped: !!p.equipped
    }))
    res.json({ success: true, parts })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// 유효 스탯 조회 (기본 스탯 + 장착 파츠 합산)
router.get('/effective-stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const gRes = await db.query('SELECT * FROM guardians WHERE user_id = $1', [userId])
    if (gRes.rows.length === 0) return res.json({ effectiveStats: null })

    const g = gRes.rows[0]
    const base = { atk: g.atk, def: g.def, hp: g.hp, abs: g.abs, prd: g.prd, spd: g.spd, rng: g.rng, ter: g.ter }
    const { stats, equippedParts, activePassives } = await computeEffectiveStats(userId, base)

    res.json({ effectiveStats: stats, equippedParts, activePassives })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// 파츠 장착 (같은 슬롯 기존 장착 자동 해제)
router.post('/equip', async (req, res) => {
  try {
    const { userId, partId } = req.body

    const part = await db.query('SELECT * FROM parts WHERE id = $1 AND user_id = $2', [partId, userId])
    if (part.rows.length === 0) return res.status(404).json({ success: false, error: '파츠를 찾을 수 없습니다' })

    await db.transaction(async (client) => {
      await client.query(
        'UPDATE parts SET equipped = false WHERE user_id = $1 AND slot = $2 AND equipped = true',
        [userId, part.rows[0].slot]
      )
      await client.query('UPDATE parts SET equipped = true WHERE id = $1', [partId])
    })

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// 파츠 탈착
router.post('/unequip', async (req, res) => {
  try {
    const { userId, partId } = req.body
    const result = await db.query(
      'UPDATE parts SET equipped = false WHERE id = $1 AND user_id = $2 RETURNING id',
      [partId, userId]
    )
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: '파츠를 찾을 수 없습니다' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// 파츠 합성 v2: 티어별 차등 확률 + 실패 시 잔해 1개 반환
//   T1→T2: 70%  실패 시 T1 1개 반환
//   T2→T3: 55%  실패 시 T1 1개 반환 (강등)
//   T3→T4: 40%  실패 시 T2 1개 반환
//   T4→T5: 25%  실패 시 T3 1개 반환
const COMBINE_RATES = { 1: 0.70, 2: 0.55, 3: 0.40, 4: 0.25 }
router.post('/combine', async (req, res) => {
  try {
    const { userId, partIds } = req.body

    if (!Array.isArray(partIds) || partIds.length !== 3) {
      return res.status(400).json({ success: false, error: '파츠 3개를 선택해야 합니다' })
    }

    const parts = await db.query(
      'SELECT * FROM parts WHERE id = ANY($1) AND user_id = $2',
      [partIds, userId]
    )
    if (parts.rows.length !== 3) return res.status(400).json({ success: false, error: '파츠를 찾을 수 없습니다' })

    const tiers = [...new Set(parts.rows.map(p => p.tier))]
    const slots = [...new Set(parts.rows.map(p => p.slot))]
    if (tiers.length !== 1) return res.status(400).json({ success: false, error: '같은 티어 파츠만 합성 가능합니다' })
    if (slots.length !== 1) return res.status(400).json({ success: false, error: '같은 슬롯 파츠만 합성 가능합니다' })
    if (tiers[0] >= 5)      return res.status(400).json({ success: false, error: '이미 최고 티어입니다' })

    // 장착 중인 파츠가 포함되어 있으면 거부
    if (parts.rows.some(p => p.equipped)) {
      return res.status(400).json({ success: false, error: '장착 중인 파츠는 합성할 수 없습니다' })
    }

    const currentTier = tiers[0]
    const slot = slots[0]
    const gType = parts.rows[0].guardian_type
    const successRate = COMBINE_RATES[currentTier] || 0.5

    // 소스 파츠 삭제 (성공 여부 무관)
    await db.query('DELETE FROM parts WHERE id = ANY($1)', [partIds])

    const success = Math.random() < successRate
    if (success) {
      const newTier = currentTier + 1
      const { stat_bonuses, passives } = generatePartStats(slot, newTier, gType)
      const newPart = await db.query(
        `INSERT INTO parts (user_id, slot, tier, guardian_type, stat_bonuses, passives)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [userId, slot, newTier, gType, JSON.stringify(stat_bonuses), JSON.stringify(passives)]
      )
      return res.json({
        success: true, result: 'success', part: newPart.rows[0],
        successRate: Math.round(successRate * 100),
        message: `합성 성공! T${newTier} 파츠 획득`
      })
    }

    // 실패 시 잔해 1개 반환 (T-1, 최소 T1)
    const salvageTier = Math.max(1, currentTier - 1)
    const { stat_bonuses, passives } = generatePartStats(slot, salvageTier, gType)
    const salvage = await db.query(
      `INSERT INTO parts (user_id, slot, tier, guardian_type, stat_bonuses, passives)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, slot, salvageTier, gType, JSON.stringify(stat_bonuses), JSON.stringify(passives)]
    )
    res.json({
      success: true, result: 'fail', part: salvage.rows[0],
      successRate: Math.round(successRate * 100),
      message: `합성 실패… T${salvageTier} 잔해 반환`
    })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
module.exports.generatePartStats = generatePartStats
module.exports.computeEffectiveStats = computeEffectiveStats
module.exports.PASSIVES_CATALOG = PASSIVES_CATALOG
module.exports.COMBINE_RATES = COMBINE_RATES
