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
      'SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id = u.id WHERE g.user_id = $1',
      [b.attacker_id]
    )

    const defender = await db.query(
      'SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id = u.id WHERE g.user_id = $1',
      [b.defender_id]
    )

    // 고정 수호신도 포함 (영역 방어)
    const fixedGuardians = await db.query(
      'SELECT * FROM fixed_guardians WHERE territory_id = $1',
      [b.territory_id]
    )

    // 동맹 공동방어 확인 (인접 영역 동맹의 고정 수호신)
    const territory = await db.query('SELECT * FROM territories WHERE id = $1', [b.territory_id])
    const t = territory.rows[0]

    let allyDefenders = []
    if (t) {
      const alliances = await db.query(
        `SELECT CASE WHEN a.user_id_1 = $1 THEN a.user_id_2 ELSE a.user_id_1 END as ally_id
         FROM alliances a
         WHERE (a.user_id_1 = $1 OR a.user_id_2 = $1) AND a.active = true`,
        [b.defender_id]
      )

      for (const alliance of alliances.rows) {
        // 동맹의 인접 영역 고정 수호신 찾기
        const allyFixed = await db.query(
          `SELECT fg.*, u.username as owner_name
           FROM fixed_guardians fg
           JOIN users u ON fg.user_id = u.id
           JOIN territories t ON fg.territory_id = t.id
           WHERE fg.user_id = $1
             AND ABS(t.center_lat - $2) < 0.005
             AND ABS(t.center_lng - $3) < 0.005`,
          [alliance.ally_id, t.center_lat, t.center_lng]
        )

        allyFixed.rows.forEach(af => {
          allyDefenders.push({
            id: af.id,
            owner: af.owner_name,
            atk: af.atk,
            def: af.def,
            hp: af.hp
          })
        })
      }
    }

    // 전투력 계산
    const attackerStats = attacker.rows[0] || { atk: 10, def: 10, hp: 100 }
    const defenderStats = defender.rows[0] || { atk: 10, def: 10, hp: 100 }

    let attackerPower = attackerStats.atk
    let defenderPower = defenderStats.def

    // 고정 수호신 방어력 추가
    fixedGuardians.rows.forEach(fg => {
      defenderPower += fg.def
    })

    // 동맹 고정 수호신 방어력 추가 (공동방어 2:1)
    allyDefenders.forEach(ad => {
      defenderPower += ad.def
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
      battleId,
      // 전투 연출용 상세 정보
      battleDetails: {
        attacker: {
          name: attackerStats.username || '공격자',
          type: attackerStats.type,
          stats: { atk: attackerStats.atk, def: attackerStats.def, hp: attackerStats.hp }
        },
        defender: {
          name: defenderStats.username || '방어자',
          type: defenderStats.type,
          stats: { atk: defenderStats.atk, def: defenderStats.def, hp: defenderStats.hp }
        },
        fixedGuardians: fixedGuardians.rows.map(fg => ({
          type: fg.guardian_type,
          stats: { atk: fg.atk, def: fg.def, hp: fg.hp }
        })),
        allyDefenders: allyDefenders,
        isJointDefense: allyDefenders.length > 0
      }
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

// 플레이어 직접 전투 요청
router.post('/request-player', async (req, res) => {
  try {
    const { attackerId, defenderId, choice } = req.body

    // 방어막 확인
    const defender = await db.query(
      'SELECT shield_until FROM users WHERE id = $1',
      [defenderId]
    )

    if (defender.rows[0]?.shield_until && new Date(defender.rows[0].shield_until) > new Date()) {
      return res.json({
        success: false,
        error: '상대방이 방어막 상태입니다'
      })
    }

    if (choice === 'alliance') {
      // 동맹 제안 생성
      const existing = await db.query(
        `SELECT id FROM alliances
         WHERE ((user_id_1 = $1 AND user_id_2 = $2) OR (user_id_1 = $2 AND user_id_2 = $1))
           AND active = true`,
        [attackerId, defenderId]
      )

      if (existing.rows.length > 0) {
        return res.json({ success: false, error: '이미 동맹 관계입니다' })
      }

      await db.query(
        `INSERT INTO alliances (user_id_1, user_id_2, active)
         VALUES ($1, $2, true)`,
        [attackerId, defenderId]
      )

      return res.json({ success: true, result: 'alliance_proposed' })
    }

    // 전투 생성
    const result = await db.query(
      `INSERT INTO battles (attacker_id, defender_id, status, attacker_choice)
       VALUES ($1, $2, 'direct_battle', 'battle')
       RETURNING *`,
      [attackerId, defenderId]
    )

    res.json({
      success: true,
      battleId: result.rows[0].id
    })
  } catch (err) {
    console.error('Request player battle error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 플레이어 직접 전투 실행
router.post('/execute-player', async (req, res) => {
  try {
    const { battleId } = req.body

    const battle = await db.query('SELECT * FROM battles WHERE id = $1', [battleId])
    if (battle.rows.length === 0) {
      return res.status(404).json({ success: false, error: '전투를 찾을 수 없습니다' })
    }

    const b = battle.rows[0]

    const attacker = await db.query(
      'SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id = u.id WHERE g.user_id = $1',
      [b.attacker_id]
    )
    const defender = await db.query(
      'SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id = u.id WHERE g.user_id = $1',
      [b.defender_id]
    )

    const attackerStats = attacker.rows[0] || { atk: 10, def: 10, hp: 100 }
    const defenderStats = defender.rows[0] || { atk: 10, def: 10, hp: 100 }

    let attackerPower = attackerStats.atk * (0.8 + Math.random() * 0.4)
    let defenderPower = defenderStats.def * (0.8 + Math.random() * 0.4)

    const winner = attackerPower > defenderPower ? 'attacker' : 'defender'
    let absorbed = null

    if (winner === 'attacker') {
      const absorbRate = (attackerStats.abs || 10) / 100
      absorbed = {
        atk: Math.floor((defenderStats.atk || 0) * absorbRate),
        def: Math.floor((defenderStats.def || 0) * absorbRate),
        hp: Math.floor((defenderStats.hp || 0) * absorbRate)
      }

      await db.query(
        `UPDATE guardians SET atk = atk + $1, def = def + $2, hp = hp + $3 WHERE user_id = $4`,
        [absorbed.atk, absorbed.def, absorbed.hp, b.attacker_id]
      )
      await db.query(
        `UPDATE guardians SET atk = GREATEST(1, atk - $1), def = GREATEST(1, def - $2), hp = GREATEST(1, hp - $3) WHERE user_id = $4`,
        [absorbed.atk, absorbed.def, absorbed.hp, b.defender_id]
      )
      await db.query(`UPDATE users SET energy_currency = energy_currency + 5 WHERE id = $1`, [b.attacker_id])
    }

    await db.query(
      `UPDATE battles SET status = 'completed', winner_id = $1, attacker_power = $2, defender_power = $3, absorbed_stats = $4 WHERE id = $5`,
      [winner === 'attacker' ? b.attacker_id : b.defender_id, Math.round(attackerPower), Math.round(defenderPower), JSON.stringify(absorbed), battleId]
    )

    res.json({
      success: true,
      winner,
      attackerPower: Math.round(attackerPower),
      defenderPower: Math.round(defenderPower),
      absorbed,
      battleDetails: {
        attacker: { name: attackerStats.username, type: attackerStats.type, stats: { atk: attackerStats.atk, def: attackerStats.def, hp: attackerStats.hp } },
        defender: { name: defenderStats.username, type: defenderStats.type, stats: { atk: defenderStats.atk, def: defenderStats.def, hp: defenderStats.hp } },
        fixedGuardians: [],
        allyDefenders: [],
        isJointDefense: false
      }
    })
  } catch (err) {
    console.error('Execute player battle error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 고정 수호신 직접 공격
router.post('/attack-fixed-guardian', async (req, res) => {
  try {
    const { attackerId, fixedGuardianId } = req.body

    const fg = await db.query(
      `SELECT fg.*, u.username as owner_name, t.user_id as territory_owner_id
       FROM fixed_guardians fg
       JOIN users u ON fg.user_id = u.id
       JOIN territories t ON fg.territory_id = t.id
       WHERE fg.id = $1`,
      [fixedGuardianId]
    )

    if (fg.rows.length === 0) {
      return res.status(404).json({ success: false, error: '고정 수호신을 찾을 수 없습니다' })
    }

    const targetFG = fg.rows[0]

    const attacker = await db.query(
      'SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id = u.id WHERE g.user_id = $1',
      [attackerId]
    )

    const attackerStats = attacker.rows[0] || { atk: 10 }

    let attackerPower = attackerStats.atk * (0.8 + Math.random() * 0.4)
    let defenderPower = targetFG.def * (0.8 + Math.random() * 0.4)

    const winner = attackerPower > defenderPower ? 'attacker' : 'defender'
    let absorbed = null

    if (winner === 'attacker') {
      const absorbRate = (attackerStats.abs || 10) / 100
      absorbed = {
        atk: Math.floor(targetFG.atk * absorbRate),
        def: Math.floor(targetFG.def * absorbRate),
        hp: Math.floor(targetFG.hp * absorbRate)
      }

      await db.query(
        `UPDATE guardians SET atk = atk + $1, def = def + $2, hp = hp + $3 WHERE user_id = $4`,
        [absorbed.atk, absorbed.def, absorbed.hp, attackerId]
      )

      // 고정 수호신 파괴
      await db.query('DELETE FROM fixed_guardians WHERE id = $1', [fixedGuardianId])
    } else {
      // 공격자 데미지 (HP 감소)
      await db.query(
        `UPDATE guardians SET hp = GREATEST(1, hp - $1) WHERE user_id = $2`,
        [Math.floor(targetFG.atk * 0.5), attackerId]
      )
    }

    res.json({
      success: true,
      winner,
      attackerPower: Math.round(attackerPower),
      defenderPower: Math.round(defenderPower),
      absorbed,
      battleDetails: {
        attacker: { name: attackerStats.username, type: attackerStats.type, stats: { atk: attackerStats.atk, def: attackerStats.def, hp: attackerStats.hp } },
        defender: { name: targetFG.owner_name + '의 고정수호신', type: targetFG.guardian_type, stats: { atk: targetFG.atk, def: targetFG.def, hp: targetFG.hp } },
        fixedGuardians: [{ type: targetFG.guardian_type, stats: { atk: targetFG.atk, def: targetFG.def, hp: targetFG.hp } }],
        allyDefenders: [],
        isJointDefense: false,
        isFixedGuardianBattle: true
      }
    })
  } catch (err) {
    console.error('Attack fixed guardian error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
