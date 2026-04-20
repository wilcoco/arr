const express = require('express')
const router = express.Router()
const db = require('../db')

// 전투/동맹 요청
router.post('/request', async (req, res) => {
  try {
    const { attackerId, defenderId, territoryId } = req.body

    // 방어막 확인
    const defender = await db.query(
      'SELECT shield_until FROM users WHERE id = $1',
      [defenderId]
    )

    if (defender.rows[0]?.shield_until && new Date(defender.rows[0].shield_until) > new Date()) {
      return res.json({
        success: false,
        error: '상대방이 방어막 상태입니다',
        shieldUntil: defender.rows[0].shield_until
      })
    }

    // 전투 생성
    const result = await db.query(
      `INSERT INTO battles (attacker_id, defender_id, territory_id, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [attackerId, defenderId, territoryId]
    )

    res.json({
      success: true,
      battleId: result.rows[0].id,
      status: 'pending',
      expiresAt: new Date(Date.now() + 60000).toISOString()
    })
  } catch (err) {
    console.error('Battle request error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 전투/동맹 선택 응답
router.post('/respond', async (req, res) => {
  try {
    const { battleId, odingerId, choice } = req.body

    // 현재 전투 조회
    const battle = await db.query(
      'SELECT * FROM battles WHERE id = $1',
      [battleId]
    )

    if (battle.rows.length === 0) {
      return res.status(404).json({ success: false, error: '전투를 찾을 수 없습니다' })
    }

    const b = battle.rows[0]
    const isAttacker = odingerId === b.attacker_id

    // 선택 저장
    if (isAttacker) {
      await db.query(
        'UPDATE battles SET attacker_choice = $1 WHERE id = $2',
        [choice, battleId]
      )
    } else {
      await db.query(
        'UPDATE battles SET defender_choice = $1 WHERE id = $2',
        [choice, battleId]
      )
    }

    // 양쪽 선택 확인
    const updated = await db.query(
      'SELECT * FROM battles WHERE id = $1',
      [battleId]
    )

    const ub = updated.rows[0]

    if (ub.attacker_choice && ub.defender_choice) {
      // 둘 다 동맹이면 동맹 체결
      if (ub.attacker_choice === 'alliance' && ub.defender_choice === 'alliance') {
        await db.query(
          'UPDATE battles SET status = $1 WHERE id = $2',
          ['alliance_formed', battleId]
        )

        // 동맹 생성
        await db.query(
          `INSERT INTO alliances (user_id_1, user_id_2, active)
           VALUES ($1, $2, true)`,
          [ub.attacker_id, ub.defender_id]
        )

        return res.json({ success: true, result: 'alliance' })
      } else {
        // 전투 진행
        await db.query(
          'UPDATE battles SET status = $1 WHERE id = $2',
          ['in_progress', battleId]
        )

        return res.json({ success: true, result: 'battle', battleId })
      }
    }

    res.json({ success: true, result: 'waiting' })
  } catch (err) {
    console.error('Battle respond error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 전투 실행
router.post('/execute', async (req, res) => {
  try {
    const { battleId, attackerUltimate, defenderUltimate } = req.body

    const battle = await db.query(
      'SELECT * FROM battles WHERE id = $1',
      [battleId]
    )

    if (battle.rows.length === 0) {
      return res.status(404).json({ success: false, error: '전투를 찾을 수 없습니다' })
    }

    const b = battle.rows[0]

    // 양쪽 수호신 스탯 조회
    const attacker = await db.query(
      'SELECT * FROM guardians WHERE user_id = $1',
      [b.attacker_id]
    )

    const defender = await db.query(
      'SELECT * FROM guardians WHERE user_id = $1',
      [b.defender_id]
    )

    // 고정 수호신도 포함 (영역 방어)
    const fixedGuardians = await db.query(
      'SELECT * FROM fixed_guardians WHERE territory_id = $1',
      [b.territory_id]
    )

    let attackerPower = attacker.rows[0]?.atk || 10
    let defenderPower = (defender.rows[0]?.def || 10)

    // 고정 수호신 방어력 추가
    fixedGuardians.rows.forEach(fg => {
      defenderPower += fg.def
    })

    // 궁극기 효과
    if (attackerUltimate) attackerPower *= 1.5
    if (defenderUltimate) defenderPower *= 1.5

    // 확률 요소 추가
    attackerPower *= (0.8 + Math.random() * 0.4)
    defenderPower *= (0.8 + Math.random() * 0.4)

    const winner = attackerPower > defenderPower ? 'attacker' : 'defender'
    const winnerId = winner === 'attacker' ? b.attacker_id : b.defender_id
    const loserId = winner === 'attacker' ? b.defender_id : b.attacker_id

    let absorbed = null

    if (winner === 'attacker') {
      // 공격자 승리 - 능력치 흡수
      const attackerGuardian = attacker.rows[0]
      const absorbRate = (attackerGuardian?.abs || 10) / 100
      const defenderGuardian = defender.rows[0]

      absorbed = {
        atk: Math.floor((defenderGuardian?.atk || 0) * absorbRate),
        def: Math.floor((defenderGuardian?.def || 0) * absorbRate),
        hp: Math.floor((defenderGuardian?.hp || 0) * absorbRate)
      }

      // 공격자 능력치 증가
      await db.query(
        `UPDATE guardians SET atk = atk + $1, def = def + $2, hp = hp + $3
         WHERE user_id = $4`,
        [absorbed.atk, absorbed.def, absorbed.hp, b.attacker_id]
      )

      // 패배자 능력치 감소
      await db.query(
        `UPDATE guardians SET atk = GREATEST(1, atk - $1), def = GREATEST(1, def - $2), hp = GREATEST(1, hp - $3)
         WHERE user_id = $4`,
        [absorbed.atk, absorbed.def, absorbed.hp, b.defender_id]
      )

      // 영역 이전
      await db.query(
        'UPDATE territories SET user_id = $1 WHERE id = $2',
        [b.attacker_id, b.territory_id]
      )

      // 고정 수호신 파괴
      await db.query(
        'DELETE FROM fixed_guardians WHERE territory_id = $1',
        [b.territory_id]
      )

      // 에너지 화폐 약탈
      await db.query(
        `UPDATE users SET energy_currency = energy_currency + 10 WHERE id = $1`,
        [b.attacker_id]
      )
      await db.query(
        `UPDATE users SET energy_currency = GREATEST(0, energy_currency - 10) WHERE id = $1`,
        [b.defender_id]
      )
    }

    // 전투 결과 저장
    await db.query(
      `UPDATE battles SET
         status = 'completed',
         winner_id = $1,
         attacker_power = $2,
         defender_power = $3,
         absorbed_stats = $4,
         completed_at = NOW()
       WHERE id = $5`,
      [winnerId, Math.round(attackerPower), Math.round(defenderPower), JSON.stringify(absorbed), battleId]
    )

    res.json({
      success: true,
      winner,
      attackerPower: Math.round(attackerPower),
      defenderPower: Math.round(defenderPower),
      absorbed,
      battleId
    })
  } catch (err) {
    console.error('Battle execute error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 궁극기 사용
router.post('/ultimate', async (req, res) => {
  try {
    const { visitorId, battleId } = req.body

    // 궁극기 충전 확인
    const user = await db.query(
      'SELECT id FROM users WHERE username = $1',
      [visitorId]
    )

    if (user.rows.length === 0) {
      return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다' })
    }

    const guardian = await db.query(
      'SELECT ult_charge FROM guardians WHERE user_id = $1',
      [user.rows[0].id]
    )

    if (guardian.rows[0]?.ult_charge < 100) {
      return res.json({ success: false, error: '궁극기가 충전되지 않았습니다' })
    }

    // 궁극기 소모
    await db.query(
      'UPDATE guardians SET ult_charge = 0 WHERE user_id = $1',
      [user.rows[0].id]
    )

    res.json({
      success: true,
      effect: 'damage_boost',
      multiplier: 1.5
    })
  } catch (err) {
    console.error('Ultimate error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 전투 결과 조회
router.get('/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params

    const result = await db.query(
      `SELECT b.*,
              a.username as attacker_name,
              d.username as defender_name
       FROM battles b
       JOIN users a ON b.attacker_id = a.id
       JOIN users d ON b.defender_id = d.id
       WHERE b.id = $1`,
      [battleId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '전투를 찾을 수 없습니다' })
    }

    res.json({ battle: result.rows[0] })
  } catch (err) {
    console.error('Battle get error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 진행 중인 전투 조회
router.get('/pending/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    const result = await db.query(
      `SELECT b.*, a.username as attacker_name, d.username as defender_name
       FROM battles b
       JOIN users a ON b.attacker_id = a.id
       JOIN users d ON b.defender_id = d.id
       WHERE (b.attacker_id = $1 OR b.defender_id = $1)
         AND b.status IN ('pending', 'in_progress')
       ORDER BY b.created_at DESC
       LIMIT 1`,
      [userId]
    )

    res.json({ battle: result.rows[0] || null })
  } catch (err) {
    console.error('Pending battle error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
