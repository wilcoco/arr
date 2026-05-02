const express = require('express')
const router = express.Router()
const db = require('../db')
const { sendPush } = require('../fcm')

// ─── 공통 상수 / 헬퍼 ─────────────────────────────────────────────
const STAT_CAPS = { atk: 500, def: 500, hp: 2000, abs: 80 }
const BATTLE_COOLDOWN_MS = 5 * 60 * 1000
const BATTLE_REQ_TIMEOUT_MS  = 60 * 1000          // 전투 응답 60초
const ALLIANCE_TIMEOUT_MS    = 5 * 60 * 1000      // 동맹 응답 5분
const isExpired = (ts) => ts && new Date(ts) < new Date()

function defenseCoeff(radius) {
  return Math.min(1.0, 50 / (radius || 50))
}

// 5분 쿨다운 체크
async function checkCooldown(userId) {
  const res = await db.query('SELECT last_battle_at FROM users WHERE id = $1', [userId])
  const last = res.rows[0]?.last_battle_at
  if (!last) return null
  const elapsed = Date.now() - new Date(last).getTime()
  if (elapsed < BATTLE_COOLDOWN_MS) return Math.ceil((BATTLE_COOLDOWN_MS - elapsed) / 1000)
  return null
}

// 레이어 호환성 체크 (베테랑 → 초심자 공격 금지)
async function checkLayer(attackerId, defenderId) {
  const res = await db.query('SELECT id, user_layer FROM users WHERE id = ANY($1)', [[attackerId, defenderId]])
  const map = {}
  res.rows.forEach(r => { map[r.id] = r.user_layer })
  if (map[attackerId] === 'veteran' && (map[defenderId] === 'beginner' || !map[defenderId])) {
    return '초심자는 공격할 수 없습니다 (보호 레이어)'
  }
  return null
}

// 사망 처리 (v2): 영역 삭제 대신 24시간 Vulnerable 상태
// - HP 50으로 회복, 영역 유지, 모든 영역 vulnerable_until = NOW()+24h
// - vulnerable 영역은 방어력 -30%, 공격자 공격력 +20%
// - 베테랑 → 초심자 강등은 유지 (보호 레이어 진입)
async function triggerDeath(client, userId) {
  await client.query('UPDATE guardians SET hp = 50 WHERE user_id = $1', [userId])
  await client.query(
    "UPDATE territories SET vulnerable_until = NOW() + INTERVAL '24 hours' WHERE user_id = $1",
    [userId]
  )
  await client.query(
    "UPDATE users SET user_layer = 'beginner', graduated_at = NULL WHERE id = $1",
    [userId]
  )
  await logActivity(client, userId, 'defeated', { vulnerable_hours: 24 })
}

// 활동 이벤트 로깅 (오프라인 요약용)
async function logActivity(client, userId, eventType, data = {}) {
  try {
    await client.query(
      `INSERT INTO activity_events (user_id, event_type, data) VALUES ($1, $2, $3)`,
      [userId, eventType, JSON.stringify(data)]
    )
  } catch (e) { /* 로깅 실패는 무시 */ }
}

// 궁극기 충전 (전투 후, 영역 확장 시, 매 tick)
// 100 cap
async function gainUltCharge(client, userId, amount) {
  if (!userId || amount <= 0) return
  try {
    await client.query(
      `UPDATE guardians SET ult_charge = LEAST(100, COALESCE(ult_charge, 0) + $1) WHERE user_id = $2`,
      [amount, userId]
    )
  } catch (e) { /* 무시 */ }
}

// 타입 상성: animal > aircraft > robot > animal
// 공격자가 유리하면 ×1.15, 불리하면 ×0.87 (역수)
function typeAdvantage(attackerType, defenderType) {
  if (!attackerType || !defenderType) return 1.0
  const wins = { animal: 'aircraft', aircraft: 'robot', robot: 'animal' }
  if (wins[attackerType] === defenderType) return 1.15
  if (wins[defenderType] === attackerType) return 0.87
  return 1.0
}

// 졸업 조건 체크 (전투 승리 5회 + 영역 3개 이상 → 베테랑 승격)
async function checkGraduation(client, userId) {
  const u = await client.query(
    "SELECT user_layer, battle_wins FROM users WHERE id = $1",
    [userId]
  )
  if (u.rows[0]?.user_layer !== 'beginner') return false
  const wins = u.rows[0]?.battle_wins || 0
  const tc = await client.query('SELECT COUNT(*) FROM territories WHERE user_id = $1', [userId])
  if (wins >= 5 && parseInt(tc.rows[0].count) >= 3) {
    await client.query(
      "UPDATE users SET user_layer = 'veteran', graduated_at = NOW() WHERE id = $1",
      [userId]
    )
    return true
  }
  return false
}

// AR 보너스 + 궁극기 + 타입 상성 적용 (공격력 배율)
async function applyArBonus(client, attackerId, atkPower, arMode, ultActivated, attackerType, defenderType) {
  let power = atkPower
  if (arMode) power *= 1.2
  if (ultActivated) {
    const g = await client.query('SELECT ult_charge FROM guardians WHERE user_id = $1', [attackerId])
    if ((g.rows[0]?.ult_charge || 0) >= 100) {
      power *= 1.5
      await client.query('UPDATE guardians SET ult_charge = 0 WHERE user_id = $1', [attackerId])
    }
  }
  // 타입 상성
  power *= typeAdvantage(attackerType, defenderType)
  return power
}

// 취약 상태 (vulnerable_until 체크): 방어력 계수
async function vulnerabilityCoeff(client, territoryId, defenderId) {
  let targetId = territoryId
  if (!targetId) {
    // territoryId 없는 플레이어 전투 → 방어자 영역 중 가장 큰 것의 취약 여부
    const r = await client.query(
      'SELECT vulnerable_until FROM territories WHERE user_id = $1 ORDER BY radius DESC LIMIT 1',
      [defenderId]
    )
    if (!r.rows[0]?.vulnerable_until || new Date(r.rows[0].vulnerable_until) < new Date()) return { def: 1.0, atk: 1.0 }
    return { def: 0.7, atk: 1.2 }
  }
  const r = await client.query('SELECT vulnerable_until FROM territories WHERE id = $1', [targetId])
  if (!r.rows[0]?.vulnerable_until || new Date(r.rows[0].vulnerable_until) < new Date()) return { def: 1.0, atk: 1.0 }
  return { def: 0.7, atk: 1.2 }
}

// FCM 토큰 저장
router.post('/fcm-token', async (req, res) => {
  try {
    const { userId, fcmToken } = req.body
    await db.query('UPDATE users SET fcm_token = $1 WHERE id = $2', [fcmToken, userId])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 즉시 공격 ───────────────────────────────────────────────────
router.post('/attack', async (req, res) => {
  try {
    const { attackerId, defenderId, territoryId, arMode, ultActivated } = req.body

    const cooldownSec = await checkCooldown(attackerId)
    if (cooldownSec) return res.json({ success: false, error: `전투 쿨다운 중입니다 (${cooldownSec}초 후 가능)` })

    const layerErr = await checkLayer(attackerId, defenderId)
    if (layerErr) return res.json({ success: false, error: layerErr })

    const defenderUser = await db.query('SELECT shield_until, fcm_token, username FROM users WHERE id = $1', [defenderId])
    const du = defenderUser.rows[0]
    if (du?.shield_until && new Date(du.shield_until) > new Date()) {
      return res.json({ success: false, error: '상대방이 방어막 상태입니다' })
    }

    let defenderDied = false
    let graduated = false

    const result = await db.transaction(async (client) => {
      const [atkRes, defRes] = await Promise.all([
        client.query('SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id = u.id WHERE g.user_id = $1', [attackerId]),
        client.query('SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id = u.id WHERE g.user_id = $1', [defenderId])
      ])
      const atkStats = atkRes.rows[0] || { atk: 10, def: 10, hp: 100, abs: 10, type: null, username: '공격자' }
      const defStats = defRes.rows[0] || { atk: 10, def: 10, hp: 100, abs: 10, type: null, username: '방어자' }

      let extraDef = 0, fixedGuardians = [], coeff = 1.0
      if (territoryId) {
        const [fgRes, terrRes] = await Promise.all([
          client.query('SELECT * FROM fixed_guardians WHERE territory_id = $1', [territoryId]),
          client.query('SELECT radius FROM territories WHERE id = $1', [territoryId])
        ])
        fixedGuardians = fgRes.rows
        fixedGuardians.forEach(fg => { extraDef += fg.def })
        coeff = defenseCoeff(terrRes.rows[0]?.radius)
      }

      // 취약 영역 보너스 (vulnerable_until 만료 전이면 공격자 유리)
      const vuln = await vulnerabilityCoeff(client, territoryId, defenderId)

      let atkPower = atkStats.atk * (0.8 + Math.random() * 0.4)
      atkPower = await applyArBonus(client, attackerId, atkPower, arMode, ultActivated, atkStats.type, defStats.type)
      atkPower *= vuln.atk
      let defPower = (defStats.def + extraDef) * coeff * (0.8 + Math.random() * 0.4) * vuln.def

      const winner = atkPower > defPower ? 'attacker' : 'defender'
      let absorbed = null

      if (winner === 'attacker') {
        const rate = Math.min(atkStats.abs || 10, STAT_CAPS.abs) / 100
        absorbed = {
          atk: Math.floor((defStats.atk || 0) * rate),
          def: Math.floor((defStats.def || 0) * rate),
          hp:  Math.floor((defStats.hp  || 0) * rate)
        }
        await client.query(
          `UPDATE guardians SET
             atk = LEAST(${STAT_CAPS.atk}, atk + $1),
             def = LEAST(${STAT_CAPS.def}, def + $2),
             hp  = LEAST(${STAT_CAPS.hp},  hp  + $3)
           WHERE user_id = $4`,
          [absorbed.atk, absorbed.def, absorbed.hp, attackerId]
        )

        if (defStats.hp - absorbed.hp <= 0) {
          defenderDied = true
          await triggerDeath(client, defenderId)
        } else {
          await client.query(
            `UPDATE guardians SET
               atk = GREATEST(1, atk - $1),
               def = GREATEST(1, def - $2),
               hp  = hp - $3
             WHERE user_id = $4`,
            [absorbed.atk, absorbed.def, absorbed.hp, defenderId]
          )
        }

        if (territoryId) {
          await client.query('UPDATE territories SET user_id = $1, warning_at = NULL, weakened_at = NULL WHERE id = $2', [attackerId, territoryId])
          await client.query('DELETE FROM fixed_guardians WHERE territory_id = $1', [territoryId])
        }
        await client.query('UPDATE users SET energy_currency = energy_currency + 10 WHERE id = $1', [attackerId])
        await client.query('UPDATE users SET energy_currency = GREATEST(0, energy_currency - 10) WHERE id = $1', [defenderId])

        await client.query("UPDATE users SET battle_wins = COALESCE(battle_wins, 0) + 1, battle_wins_season = COALESCE(battle_wins_season, 0) + 1 WHERE id = $1", [attackerId])
        graduated = await checkGraduation(client, attackerId)
        await require('../levels').gainXp(client, attackerId, 50, 'battle_win').catch(() => {})
        await gainUltCharge(client, attackerId, 25)
        await gainUltCharge(client, defenderId, 15)  // 진 쪽도 분노 충전
        require('./missions').progressMission(attackerId, 'battle_win', 1).catch(() => {})
        require('./missions').progressMission(attackerId, 'attack_player', 1).catch(() => {})
        require('./tutorial').autoAdvance(attackerId, 'first_battle').catch(() => {})
        await logActivity(client, defenderId, 'attacked_by', { attackerId, territoryId, winner: 'attacker' })
      } else {
        await logActivity(client, defenderId, 'attacked_by', { attackerId, territoryId, winner: 'defender' })
      }

      await client.query('UPDATE users SET last_battle_at = NOW() WHERE id = $1', [attackerId])

      const battleRes = await client.query(
        `INSERT INTO battles (attacker_id, defender_id, territory_id, status, attacker_choice, winner_id, attacker_power, defender_power, absorbed_stats, completed_at)
         VALUES ($1,$2,$3,'completed','battle',$4,$5,$6,$7,NOW()) RETURNING id`,
        [attackerId, defenderId, territoryId || null,
         winner === 'attacker' ? attackerId : defenderId,
         Math.round(atkPower), Math.round(defPower), JSON.stringify(absorbed)]
      )

      return { winner, atkPower, defPower, absorbed, battleId: battleRes.rows[0].id, atkStats, defStats, fixedGuardians }
    })

    const notification = result.winner === 'attacker'
      ? { title: '⚔️ 영역 함락!',  body: `${result.atkStats.username}에게 영역을 빼앗겼습니다!` }
      : { title: '🛡️ 방어 성공!', body: `${result.atkStats.username}의 공격을 막아냈습니다!` }
    await sendPush(du?.fcm_token, notification.title, notification.body,
      { type: 'ATTACK_RESULT', winner: result.winner, battleId: result.battleId })

    res.json({
      success: true,
      winner: result.winner,
      attackerPower: Math.round(result.atkPower),
      defenderPower: Math.round(result.defPower),
      absorbed: result.absorbed,
      battleId: result.battleId,
      defenderDied,
      graduated,
      battleDetails: {
        attacker: { name: result.atkStats.username, type: result.atkStats.type, stats: { atk: result.atkStats.atk, def: result.atkStats.def, hp: result.atkStats.hp } },
        defender: { name: result.defStats.username, type: result.defStats.type, stats: { atk: result.defStats.atk, def: result.defStats.def, hp: result.defStats.hp } },
        fixedGuardians: result.fixedGuardians.map(fg => ({ type: fg.guardian_type, stats: { atk: fg.atk, def: fg.def, hp: fg.hp } })),
        allyDefenders: [],
        isJointDefense: false
      }
    })
  } catch (err) {
    console.error('Attack error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 동맹 요청 ───────────────────────────────────────────────────
router.post('/alliance-request', async (req, res) => {
  try {
    const { requesterId, targetId } = req.body

    const betrayalCheck = await db.query('SELECT betrayal_blocked_until FROM users WHERE id = $1', [requesterId])
    if (betrayalCheck.rows[0]?.betrayal_blocked_until && new Date(betrayalCheck.rows[0].betrayal_blocked_until) > new Date()) {
      const remaining = Math.ceil((new Date(betrayalCheck.rows[0].betrayal_blocked_until) - Date.now()) / 3600000)
      return res.json({ success: false, error: `배신 후 ${remaining}시간 동안 동맹을 맺을 수 없습니다` })
    }

    const existing = await db.query(
      `SELECT id FROM alliances WHERE ((user_id_1=$1 AND user_id_2=$2) OR (user_id_1=$2 AND user_id_2=$1)) AND active=true`,
      [requesterId, targetId]
    )
    if (existing.rows.length > 0) return res.json({ success: false, error: '이미 동맹 관계입니다' })

    const requester = await db.query('SELECT username FROM users WHERE id=$1', [requesterId])
    const target    = await db.query('SELECT fcm_token FROM users WHERE id=$1', [targetId])

    // 만료된 기존 pending 정리
    await db.query(`UPDATE alliance_requests SET status='expired'
                    WHERE status='pending' AND expires_at < NOW()`)

    const expiresAt = new Date(Date.now() + ALLIANCE_TIMEOUT_MS)
    const reqRes = await db.query(
      `INSERT INTO alliance_requests (requester_id, target_id, status, expires_at) VALUES ($1,$2,'pending',$3) RETURNING id`,
      [requesterId, targetId, expiresAt]
    )

    await sendPush(
      target.rows[0]?.fcm_token,
      '🤝 동맹 요청',
      `${requester.rows[0]?.username}이(가) 동맹을 요청했습니다 (5분 내 응답)`,
      { type: 'ALLIANCE_REQUEST', requestId: reqRes.rows[0].id, requesterId }
    )

    res.json({ success: true, requestId: reqRes.rows[0].id, expiresAt: expiresAt.toISOString() })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 동맹 수락/거절 ──────────────────────────────────────────────
router.post('/alliance-respond', async (req, res) => {
  try {
    const { requestId, accept } = req.body

    const reqRow = await db.query(
      `SELECT ar.*, u.username as requester_name, u.fcm_token as requester_token
       FROM alliance_requests ar JOIN users u ON ar.requester_id=u.id WHERE ar.id=$1`,
      [requestId]
    )
    if (reqRow.rows.length === 0) return res.status(404).json({ success: false, error: '요청을 찾을 수 없습니다' })

    const r = reqRow.rows[0]

    // 만료 체크
    if (r.status === 'expired' || (r.status === 'pending' && isExpired(r.expires_at))) {
      await db.query(`UPDATE alliance_requests SET status='expired' WHERE id=$1`, [requestId])
      return res.json({ success: false, error: '동맹 요청이 만료되었습니다 (5분 초과)', expired: true })
    }
    if (r.status !== 'pending') {
      return res.json({ success: false, error: `이미 ${r.status} 상태입니다` })
    }
    const target = await db.query('SELECT username FROM users WHERE id=$1', [r.target_id])

    if (accept) {
      await db.query(
        `INSERT INTO alliances (user_id_1, user_id_2, active) VALUES ($1,$2,true)`,
        [r.requester_id, r.target_id]
      )
      await sendPush(r.requester_token, '🤝 동맹 성사!', `${target.rows[0]?.username}이(가) 동맹을 수락했습니다!`,
        { type: 'ALLIANCE_ACCEPTED', targetId: r.target_id })
    } else {
      await sendPush(r.requester_token, '❌ 동맹 거절', `${target.rows[0]?.username}이(가) 동맹을 거절했습니다`,
        { type: 'ALLIANCE_DECLINED' })
    }

    await db.query(`UPDATE alliance_requests SET status=$1 WHERE id=$2`, [accept ? 'accepted' : 'declined', requestId])
    res.json({ success: true, result: accept ? 'accepted' : 'declined' })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 전투/동맹 요청 (pending) ────────────────────────────────────
router.post('/request', async (req, res) => {
  try {
    const { attackerId, defenderId, territoryId } = req.body

    const layerErr = await checkLayer(attackerId, defenderId)
    if (layerErr) return res.json({ success: false, error: layerErr })

    const defender = await db.query('SELECT shield_until FROM users WHERE id = $1', [defenderId])
    if (defender.rows[0]?.shield_until && new Date(defender.rows[0].shield_until) > new Date()) {
      return res.json({ success: false, error: '상대방이 방어막 상태입니다', shieldUntil: defender.rows[0].shield_until })
    }

    // 만료 처리
    await db.query(`UPDATE battles SET status='expired'
                    WHERE status='pending' AND expires_at < NOW()`)

    const expiresAt = new Date(Date.now() + BATTLE_REQ_TIMEOUT_MS)
    const result = await db.query(
      `INSERT INTO battles (attacker_id, defender_id, territory_id, status, expires_at) VALUES ($1,$2,$3,'pending',$4) RETURNING *`,
      [attackerId, defenderId, territoryId, expiresAt]
    )
    res.json({ success: true, battleId: result.rows[0].id, status: 'pending', expiresAt: expiresAt.toISOString() })
  } catch (err) {
    console.error('Battle request error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 전투/동맹 선택 응답 ─────────────────────────────────────────
router.post('/respond', async (req, res) => {
  try {
    const { battleId, odingerId, choice } = req.body

    const battle = await db.query('SELECT * FROM battles WHERE id = $1', [battleId])
    if (battle.rows.length === 0) return res.status(404).json({ success: false, error: '전투를 찾을 수 없습니다' })

    const b = battle.rows[0]

    // 만료 체크
    if (b.status === 'expired' || (b.status === 'pending' && isExpired(b.expires_at))) {
      await db.query(`UPDATE battles SET status='expired' WHERE id=$1`, [battleId])
      return res.json({ success: false, error: '전투 요청이 만료되었습니다 (60초 초과)', expired: true })
    }

    const isAttacker = odingerId === b.attacker_id

    if (isAttacker) {
      await db.query('UPDATE battles SET attacker_choice = $1 WHERE id = $2', [choice, battleId])
    } else {
      await db.query('UPDATE battles SET defender_choice = $1 WHERE id = $2', [choice, battleId])
    }

    const updated = await db.query('SELECT * FROM battles WHERE id = $1', [battleId])
    const ub = updated.rows[0]

    if (ub.attacker_choice && ub.defender_choice) {
      if (ub.attacker_choice === 'alliance' && ub.defender_choice === 'alliance') {
        await db.query('UPDATE battles SET status = $1 WHERE id = $2', ['alliance_formed', battleId])
        await db.query(`INSERT INTO alliances (user_id_1, user_id_2, active) VALUES ($1,$2,true)`, [ub.attacker_id, ub.defender_id])
        return res.json({ success: true, result: 'alliance' })
      } else {
        await db.query('UPDATE battles SET status = $1 WHERE id = $2', ['in_progress', battleId])
        return res.json({ success: true, result: 'battle', battleId })
      }
    }

    res.json({ success: true, result: 'waiting' })
  } catch (err) {
    console.error('Battle respond error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 전투 실행 (pending 전투) ─────────────────────────────────────
router.post('/execute', async (req, res) => {
  try {
    const { battleId, attackerUltimate, defenderUltimate, arMode } = req.body

    const battle = await db.query('SELECT * FROM battles WHERE id = $1', [battleId])
    if (battle.rows.length === 0) return res.status(404).json({ success: false, error: '전투를 찾을 수 없습니다' })

    const b = battle.rows[0]

    // 만료된 pending: 수비자 무응답 → 자동 'battle'로 처리하고 진행
    if (b.status === 'pending' && isExpired(b.expires_at)) {
      if (!b.defender_choice) {
        await db.query(`UPDATE battles SET defender_choice='battle', status='in_progress' WHERE id=$1`, [battleId])
      }
    } else if (b.status === 'expired') {
      return res.json({ success: false, error: '전투가 이미 만료되었습니다', expired: true })
    }

    const [attacker, defender, fixedGuardians, territory] = await Promise.all([
      db.query('SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id = u.id WHERE g.user_id = $1', [b.attacker_id]),
      db.query('SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id = u.id WHERE g.user_id = $1', [b.defender_id]),
      db.query('SELECT * FROM fixed_guardians WHERE territory_id = $1', [b.territory_id]),
      db.query('SELECT * FROM territories WHERE id = $1', [b.territory_id])
    ])

    const t = territory.rows[0]

    // 동맹 공동방어
    let allyDefenders = []
    if (t) {
      const alliances = await db.query(
        `SELECT CASE WHEN a.user_id_1=$1 THEN a.user_id_2 ELSE a.user_id_1 END as ally_id
         FROM alliances a WHERE (a.user_id_1=$1 OR a.user_id_2=$1) AND a.active=true`,
        [b.defender_id]
      )
      for (const al of alliances.rows) {
        const allyFixed = await db.query(
          `SELECT fg.*, u.username as owner_name FROM fixed_guardians fg
           JOIN users u ON fg.user_id = u.id JOIN territories tr ON fg.territory_id = tr.id
           WHERE fg.user_id=$1 AND ABS(tr.center_lat-$2)<0.005 AND ABS(tr.center_lng-$3)<0.005`,
          [al.ally_id, t.center_lat, t.center_lng]
        )
        allyFixed.rows.forEach(af => allyDefenders.push({ id: af.id, owner: af.owner_name, atk: af.atk, def: af.def, hp: af.hp }))
      }
    }

    const coeff = defenseCoeff(t?.radius)
    const attackerStats = attacker.rows[0] || { atk: 10, def: 10, hp: 100 }
    const defenderStats = defender.rows[0] || { atk: 10, def: 10, hp: 100 }

    // 취약 영역 / 타입 상성
    const vuln = await (async () => {
      const r = await db.query('SELECT vulnerable_until FROM territories WHERE id=$1', [b.territory_id])
      if (!r.rows[0]?.vulnerable_until || new Date(r.rows[0].vulnerable_until) < new Date()) return { def: 1.0, atk: 1.0 }
      return { def: 0.7, atk: 1.2 }
    })()

    let attackerPower = attackerStats.atk
    let defenderPower = defenderStats.def
    fixedGuardians.rows.forEach(fg => { defenderPower += fg.def })
    allyDefenders.forEach(ad => { defenderPower += ad.def })
    defenderPower *= coeff * vuln.def

    // AR 보너스
    if (arMode) attackerPower *= 1.2

    // 타입 상성
    attackerPower *= typeAdvantage(attackerStats.type, defenderStats.type)
    attackerPower *= vuln.atk

    // 궁극기 (ult_charge 소비)
    let atkUltUsed = false, defUltUsed = false
    if (attackerUltimate) {
      const ag = await db.query('SELECT ult_charge FROM guardians WHERE user_id = $1', [b.attacker_id])
      if ((ag.rows[0]?.ult_charge || 0) >= 100) {
        attackerPower *= 1.5
        atkUltUsed = true
      }
    }
    if (defenderUltimate) {
      const dg = await db.query('SELECT ult_charge FROM guardians WHERE user_id = $1', [b.defender_id])
      if ((dg.rows[0]?.ult_charge || 0) >= 100) {
        defenderPower *= 1.5
        defUltUsed = true
      }
    }

    attackerPower *= (0.8 + Math.random() * 0.4)
    defenderPower *= (0.8 + Math.random() * 0.4)

    const winner = attackerPower > defenderPower ? 'attacker' : 'defender'
    const winnerId = winner === 'attacker' ? b.attacker_id : b.defender_id

    let absorbed = null
    let defenderDied = false
    let graduated = false

    await db.transaction(async (client) => {
      if (atkUltUsed) await client.query('UPDATE guardians SET ult_charge = 0 WHERE user_id = $1', [b.attacker_id])
      if (defUltUsed) await client.query('UPDATE guardians SET ult_charge = 0 WHERE user_id = $1', [b.defender_id])

      if (winner === 'attacker') {
        const absorbRate = Math.min(attackerStats.abs || 10, STAT_CAPS.abs) / 100
        absorbed = {
          atk: Math.floor((defenderStats.atk || 0) * absorbRate),
          def: Math.floor((defenderStats.def || 0) * absorbRate),
          hp:  Math.floor((defenderStats.hp  || 0) * absorbRate)
        }
        await client.query(
          `UPDATE guardians SET atk=LEAST(${STAT_CAPS.atk},atk+$1), def=LEAST(${STAT_CAPS.def},def+$2), hp=LEAST(${STAT_CAPS.hp},hp+$3) WHERE user_id=$4`,
          [absorbed.atk, absorbed.def, absorbed.hp, b.attacker_id]
        )

        if (defenderStats.hp - absorbed.hp <= 0) {
          defenderDied = true
          await triggerDeath(client, b.defender_id)
        } else {
          await client.query(
            `UPDATE guardians SET atk=GREATEST(1,atk-$1), def=GREATEST(1,def-$2), hp=hp-$3 WHERE user_id=$4`,
            [absorbed.atk, absorbed.def, absorbed.hp, b.defender_id]
          )
        }

        await client.query('UPDATE territories SET user_id=$1, warning_at=NULL, weakened_at=NULL, vulnerable_until=NULL WHERE id=$2', [b.attacker_id, b.territory_id])
        await client.query('DELETE FROM fixed_guardians WHERE territory_id=$1', [b.territory_id])
        await client.query('UPDATE users SET energy_currency=energy_currency+10 WHERE id=$1', [b.attacker_id])
        await client.query('UPDATE users SET energy_currency=GREATEST(0,energy_currency-10) WHERE id=$1', [b.defender_id])

        await client.query("UPDATE users SET battle_wins=COALESCE(battle_wins,0)+1, battle_wins_season=COALESCE(battle_wins_season,0)+1 WHERE id=$1", [b.attacker_id])
        graduated = await checkGraduation(client, b.attacker_id)
        await require('../levels').gainXp(client, b.attacker_id, 50, 'battle_win').catch(() => {})
        await logActivity(client, b.defender_id, 'attacked_by', { attackerId: b.attacker_id, territoryId: b.territory_id, winner: 'attacker' })
      } else {
        await logActivity(client, b.defender_id, 'attacked_by', { attackerId: b.attacker_id, territoryId: b.territory_id, winner: 'defender' })
      }

      await client.query('UPDATE users SET last_battle_at=NOW() WHERE id=$1', [b.attacker_id])
      await client.query(
        `UPDATE battles SET status='completed', winner_id=$1, attacker_power=$2, defender_power=$3, absorbed_stats=$4, completed_at=NOW() WHERE id=$5`,
        [winnerId, Math.round(attackerPower), Math.round(defenderPower), JSON.stringify(absorbed), battleId]
      )
    })

    res.json({
      success: true,
      winner,
      attackerPower: Math.round(attackerPower),
      defenderPower: Math.round(defenderPower),
      absorbed,
      battleId,
      defenderDied,
      graduated,
      battleDetails: {
        attacker: { name: attackerStats.username || '공격자', type: attackerStats.type, stats: { atk: attackerStats.atk, def: attackerStats.def, hp: attackerStats.hp } },
        defender: { name: defenderStats.username || '방어자', type: defenderStats.type, stats: { atk: defenderStats.atk, def: defenderStats.def, hp: defenderStats.hp } },
        fixedGuardians: fixedGuardians.rows.map(fg => ({ type: fg.guardian_type, stats: { atk: fg.atk, def: fg.def, hp: fg.hp } })),
        allyDefenders,
        isJointDefense: allyDefenders.length > 0
      }
    })
  } catch (err) {
    console.error('Battle execute error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 궁극기 충전 상태 조회 ────────────────────────────────────────
router.post('/ultimate', async (req, res) => {
  try {
    const { visitorId, battleId } = req.body

    const user = await db.query('SELECT id FROM users WHERE username=$1', [visitorId])
    if (user.rows.length === 0) return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다' })

    const guardian = await db.query('SELECT ult_charge FROM guardians WHERE user_id=$1', [user.rows[0].id])
    if ((guardian.rows[0]?.ult_charge || 0) < 100) {
      return res.json({ success: false, error: '궁극기가 충전되지 않았습니다' })
    }

    await db.query('UPDATE guardians SET ult_charge=0 WHERE user_id=$1', [user.rows[0].id])
    res.json({ success: true, effect: 'damage_boost', multiplier: 1.5 })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 전투 결과 조회 ───────────────────────────────────────────────
router.get('/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params
    const result = await db.query(
      `SELECT b.*, a.username as attacker_name, d.username as defender_name
       FROM battles b JOIN users a ON b.attacker_id=a.id JOIN users d ON b.defender_id=d.id
       WHERE b.id=$1`,
      [battleId]
    )
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: '전투를 찾을 수 없습니다' })
    res.json({ battle: result.rows[0] })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// 진행 중인 전투 조회
router.get('/pending/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const result = await db.query(
      `SELECT b.*, a.username as attacker_name, d.username as defender_name
       FROM battles b JOIN users a ON b.attacker_id=a.id JOIN users d ON b.defender_id=d.id
       WHERE (b.attacker_id=$1 OR b.defender_id=$1) AND b.status IN ('pending','in_progress')
       ORDER BY b.created_at DESC LIMIT 1`,
      [userId]
    )
    res.json({ battle: result.rows[0] || null })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 전투 프리뷰 (실제 전투 없이 예상 결과) ─────────────────────
router.post('/preview', async (req, res) => {
  try {
    const { attackerId, defenderId, territoryId, arMode, ultActivated } = req.body

    const layerErr = await checkLayer(attackerId, defenderId)
    if (layerErr) return res.json({ success: false, error: layerErr })

    const [atkRes, defRes] = await Promise.all([
      db.query('SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id=u.id WHERE g.user_id=$1', [attackerId]),
      db.query('SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id=u.id WHERE g.user_id=$1', [defenderId])
    ])
    const atk = atkRes.rows[0]
    const def = defRes.rows[0]
    if (!atk || !def) return res.json({ success: false, error: '수호신 정보 없음' })

    let extraDef = 0, coeff = 1.0, vuln = { def: 1.0, atk: 1.0 }
    if (territoryId) {
      const [fgRes, terrRes] = await Promise.all([
        db.query('SELECT def FROM fixed_guardians WHERE territory_id=$1', [territoryId]),
        db.query('SELECT radius, vulnerable_until FROM territories WHERE id=$1', [territoryId])
      ])
      fgRes.rows.forEach(fg => { extraDef += fg.def })
      coeff = defenseCoeff(terrRes.rows[0]?.radius)
      const vu = terrRes.rows[0]?.vulnerable_until
      if (vu && new Date(vu) > new Date()) vuln = { def: 0.7, atk: 1.2 }
    }

    let atkPower = atk.atk
    if (arMode) atkPower *= 1.2
    if (ultActivated && (atk.ult_charge || 0) >= 100) atkPower *= 1.5
    atkPower *= typeAdvantage(atk.type, def.type) * vuln.atk

    const defPower = (def.def + extraDef) * coeff * vuln.def

    // 승률 추정 (난수 0.8~1.2 고려하여 간단 모델)
    const ratio = atkPower / Math.max(1, defPower)
    const winChance = Math.max(0.05, Math.min(0.95, 0.5 + (ratio - 1) * 0.5))

    res.json({
      success: true,
      attackerPower: Math.round(atkPower),
      defenderPower: Math.round(defPower),
      winChance: Math.round(winChance * 100),
      vulnerable: vuln.atk > 1.0,
      typeAdvantage: typeAdvantage(atk.type, def.type),
      attackerType: atk.type,
      defenderType: def.type
    })
  } catch (err) {
    console.error('Battle preview error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 플레이어 직접 전투 요청 ──────────────────────────────────────
router.post('/request-player', async (req, res) => {
  try {
    const { attackerId, defenderId, choice } = req.body

    const layerErr = await checkLayer(attackerId, defenderId)
    if (layerErr) return res.json({ success: false, error: layerErr })

    const defender = await db.query('SELECT shield_until FROM users WHERE id=$1', [defenderId])
    if (defender.rows[0]?.shield_until && new Date(defender.rows[0].shield_until) > new Date()) {
      return res.json({ success: false, error: '상대방이 방어막 상태입니다' })
    }

    if (choice === 'alliance') {
      const existing = await db.query(
        `SELECT id FROM alliances WHERE ((user_id_1=$1 AND user_id_2=$2) OR (user_id_1=$2 AND user_id_2=$1)) AND active=true`,
        [attackerId, defenderId]
      )
      if (existing.rows.length > 0) return res.json({ success: false, error: '이미 동맹 관계입니다' })
      await db.query(`INSERT INTO alliances (user_id_1, user_id_2, active) VALUES ($1,$2,true)`, [attackerId, defenderId])
      return res.json({ success: true, result: 'alliance_proposed' })
    }

    const result = await db.query(
      `INSERT INTO battles (attacker_id, defender_id, status, attacker_choice) VALUES ($1,$2,'direct_battle','battle') RETURNING *`,
      [attackerId, defenderId]
    )
    res.json({ success: true, battleId: result.rows[0].id })
  } catch (err) {
    console.error('Request player battle error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 플레이어 직접 전투 실행 ──────────────────────────────────────
router.post('/execute-player', async (req, res) => {
  try {
    const { battleId, arMode, ultActivated } = req.body

    const battle = await db.query('SELECT * FROM battles WHERE id=$1', [battleId])
    if (battle.rows.length === 0) return res.status(404).json({ success: false, error: '전투를 찾을 수 없습니다' })
    const b = battle.rows[0]

    const cooldownSec = await checkCooldown(b.attacker_id)
    if (cooldownSec) return res.json({ success: false, error: `전투 쿨다운 중입니다 (${cooldownSec}초 후 가능)` })

    const layerErr = await checkLayer(b.attacker_id, b.defender_id)
    if (layerErr) return res.json({ success: false, error: layerErr })

    const [atkRes, defRes] = await Promise.all([
      db.query('SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id=u.id WHERE g.user_id=$1', [b.attacker_id]),
      db.query('SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id=u.id WHERE g.user_id=$1', [b.defender_id])
    ])
    const attackerStats = atkRes.rows[0] || { atk: 10, def: 10, hp: 100 }
    const defenderStats = defRes.rows[0] || { atk: 10, def: 10, hp: 100 }

    let defenderDied = false
    let graduated = false
    let absorbed = null

    await db.transaction(async (client) => {
      const vuln = await vulnerabilityCoeff(client, null, b.defender_id)
      let atkPower = attackerStats.atk * (0.8 + Math.random() * 0.4)
      atkPower = await applyArBonus(client, b.attacker_id, atkPower, arMode, ultActivated, attackerStats.type, defenderStats.type)
      atkPower *= vuln.atk
      const defPower = defenderStats.def * (0.8 + Math.random() * 0.4) * vuln.def

      const winner = atkPower > defPower ? 'attacker' : 'defender'

      if (winner === 'attacker') {
        const rate = Math.min(attackerStats.abs || 10, STAT_CAPS.abs) / 100
        absorbed = {
          atk: Math.floor((defenderStats.atk || 0) * rate),
          def: Math.floor((defenderStats.def || 0) * rate),
          hp:  Math.floor((defenderStats.hp  || 0) * rate)
        }
        await client.query(
          `UPDATE guardians SET atk=LEAST(${STAT_CAPS.atk},atk+$1), def=LEAST(${STAT_CAPS.def},def+$2), hp=LEAST(${STAT_CAPS.hp},hp+$3) WHERE user_id=$4`,
          [absorbed.atk, absorbed.def, absorbed.hp, b.attacker_id]
        )

        if (defenderStats.hp - absorbed.hp <= 0) {
          defenderDied = true
          await triggerDeath(client, b.defender_id)
        } else {
          await client.query(
            `UPDATE guardians SET atk=GREATEST(1,atk-$1), def=GREATEST(1,def-$2), hp=hp-$3 WHERE user_id=$4`,
            [absorbed.atk, absorbed.def, absorbed.hp, b.defender_id]
          )
        }

        await client.query('UPDATE users SET energy_currency=energy_currency+5 WHERE id=$1', [b.attacker_id])
        await client.query("UPDATE users SET battle_wins=COALESCE(battle_wins,0)+1, battle_wins_season=COALESCE(battle_wins_season,0)+1 WHERE id=$1", [b.attacker_id])
        graduated = await checkGraduation(client, b.attacker_id)
        await require('../levels').gainXp(client, b.attacker_id, 50, 'battle_win').catch(() => {})
        await logActivity(client, b.defender_id, 'attacked_by', { attackerId: b.attacker_id, winner: 'attacker' })
      } else {
        await logActivity(client, b.defender_id, 'attacked_by', { attackerId: b.attacker_id, winner: 'defender' })
      }

      await client.query('UPDATE users SET last_battle_at=NOW() WHERE id=$1', [b.attacker_id])
      await client.query(
        `UPDATE battles SET status='completed', winner_id=$1, attacker_power=$2, defender_power=$3, absorbed_stats=$4 WHERE id=$5`,
        [winner === 'attacker' ? b.attacker_id : b.defender_id,
         Math.round(atkPower), Math.round(defPower), JSON.stringify(absorbed), battleId]
      )

      res.json({
        success: true,
        winner,
        attackerPower: Math.round(atkPower),
        defenderPower: Math.round(defPower),
        absorbed,
        defenderDied,
        graduated,
        battleDetails: {
          attacker: { name: attackerStats.username, type: attackerStats.type, stats: { atk: attackerStats.atk, def: attackerStats.def, hp: attackerStats.hp } },
          defender: { name: defenderStats.username, type: defenderStats.type, stats: { atk: defenderStats.atk, def: defenderStats.def, hp: defenderStats.hp } },
          fixedGuardians: [], allyDefenders: [], isJointDefense: false
        }
      })
    })
  } catch (err) {
    console.error('Execute player battle error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── 고정 수호신 공격 ─────────────────────────────────────────────
router.post('/attack-fixed-guardian', async (req, res) => {
  try {
    const { attackerId, fixedGuardianId, arMode, ultActivated } = req.body

    const fg = await db.query(
      `SELECT fg.*, u.username as owner_name, t.user_id as territory_owner_id
       FROM fixed_guardians fg JOIN users u ON fg.user_id=u.id JOIN territories t ON fg.territory_id=t.id
       WHERE fg.id=$1`,
      [fixedGuardianId]
    )
    if (fg.rows.length === 0) return res.status(404).json({ success: false, error: '고정 수호신을 찾을 수 없습니다' })

    const targetFG = fg.rows[0]

    const cooldownSec = await checkCooldown(attackerId)
    if (cooldownSec) return res.json({ success: false, error: `전투 쿨다운 중입니다 (${cooldownSec}초 후 가능)` })

    const atkRes = await db.query('SELECT g.*, u.username FROM guardians g JOIN users u ON g.user_id=u.id WHERE g.user_id=$1', [attackerId])
    const attackerStats = atkRes.rows[0] || { atk: 10 }

    let absorbed = null
    let graduated = false

    await db.transaction(async (client) => {
      let atkPower = attackerStats.atk * (0.8 + Math.random() * 0.4)
      atkPower = await applyArBonus(client, attackerId, atkPower, arMode, ultActivated)
      const defPower = targetFG.def * (0.8 + Math.random() * 0.4)

      const winner = atkPower > defPower ? 'attacker' : 'defender'

      if (winner === 'attacker') {
        const rate = Math.min(attackerStats.abs || 10, STAT_CAPS.abs) / 100
        absorbed = {
          atk: Math.floor(targetFG.atk * rate),
          def: Math.floor(targetFG.def * rate),
          hp:  Math.floor(targetFG.hp  * rate)
        }
        await client.query(
          `UPDATE guardians SET atk=LEAST(${STAT_CAPS.atk},atk+$1), def=LEAST(${STAT_CAPS.def},def+$2), hp=LEAST(${STAT_CAPS.hp},hp+$3) WHERE user_id=$4`,
          [absorbed.atk, absorbed.def, absorbed.hp, attackerId]
        )

        // 격파 시 storage 약탈: 누적된 파츠/에너지를 공격자에게 전부 이전
        const looted = await client.query(
          `SELECT * FROM fixed_guardian_storage WHERE fixed_guardian_id=$1`,
          [fixedGuardianId]
        )
        let lootParts = 0, lootEnergy = 0
        for (const it of looted.rows) {
          if (it.item_type === 'part') {
            const d = it.data || {}
            await client.query(
              `INSERT INTO parts (user_id, slot, tier, guardian_type, stat_bonuses, passives)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [attackerId, d.slot || 'head', parseInt(d.tier) || 1, d.guardian_type || 'animal',
               JSON.stringify(d.stat_bonuses || {}), JSON.stringify(d.passives || [])]
            )
            lootParts++
          } else if (it.item_type === 'energy' || it.item_type === 'revenue') {
            const amt = parseInt(it.data?.amount) || 0
            await client.query('UPDATE users SET energy_currency = energy_currency + $1 WHERE id=$2', [amt, attackerId])
            lootEnergy += amt
          }
        }
        await client.query('DELETE FROM fixed_guardians WHERE id=$1', [fixedGuardianId])
        if (lootParts > 0 || lootEnergy > 0) {
          await logActivity(client, targetFG.user_id, 'storage_looted',
            { byUserId: attackerId, parts: lootParts, energy: lootEnergy })
        }

        await client.query("UPDATE users SET battle_wins=COALESCE(battle_wins,0)+1 WHERE id=$1", [attackerId])
        graduated = await checkGraduation(client, attackerId)
        await require('../levels').gainXp(client, attackerId, 50, 'battle_win').catch(() => {})
        await gainUltCharge(client, attackerId, 25)
        await gainUltCharge(client, defenderId, 15)  // 진 쪽도 분노 충전
        require('./missions').progressMission(attackerId, 'battle_win', 1).catch(() => {})
        require('./missions').progressMission(attackerId, 'attack_player', 1).catch(() => {})
        require('./tutorial').autoAdvance(attackerId, 'first_battle').catch(() => {})
      } else {
        await client.query(
          `UPDATE guardians SET hp=GREATEST(1,hp-$1) WHERE user_id=$2`,
          [Math.floor(targetFG.atk * 0.5), attackerId]
        )
      }

      await client.query('UPDATE users SET last_battle_at=NOW() WHERE id=$1', [attackerId])

      res.json({
        success: true,
        winner,
        attackerPower: Math.round(atkPower),
        defenderPower: Math.round(defPower),
        absorbed,
        graduated,
        battleDetails: {
          attacker: { name: attackerStats.username, type: attackerStats.type, stats: { atk: attackerStats.atk, def: attackerStats.def, hp: attackerStats.hp } },
          defender: { name: targetFG.owner_name + '의 고정수호신', type: targetFG.guardian_type, stats: { atk: targetFG.atk, def: targetFG.def, hp: targetFG.hp } },
          fixedGuardians: [{ type: targetFG.guardian_type, stats: { atk: targetFG.atk, def: targetFG.def, hp: targetFG.hp } }],
          allyDefenders: [], isJointDefense: false, isFixedGuardianBattle: true
        }
      })
    })
  } catch (err) {
    console.error('Attack fixed guardian error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
