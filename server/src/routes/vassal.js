// 속국(vassal) 계약 — 남의 영역 안에 협력자로 편입
//   1) vassal이 propose: 위치/반경/타워클래스/조공률(tribute_to_lord_pct) 제안
//   2) lord가 accept → 서버가 vassal의 territory + tower를 그 자리에 atomic으로 생성, 계약 active
//   3) lord가 reject → status='rejected'
//   4) 어느 쪽이든 dissolve 가능 (정책: 즉시 해제 + 24h 동맹 금지 같은 페널티는 추후)
//
// 자기-속국(자기 영역 안에 자기 작은 타워)은 계약 불필요. /api/towers/place에서 자동 처리됨.
const express = require('express')
const router = express.Router()
const db = require('../db')
const levelTable = require('../levelTable')
const { TOWER_CLASSES, towerStats } = require('./towers')

const PROPOSE_TTL_HOURS = 24

// POST /api/vassal/propose
//   body: { vassalUserId, lordTerritoryId, lat, lng, claimRadiusM, towerClass, tributeToLordPct }
router.post('/propose', async (req, res) => {
  try {
    const { vassalUserId, lordTerritoryId, lat, lng, claimRadiusM, towerClass, tributeToLordPct } = req.body
    if (!vassalUserId || !lordTerritoryId || lat === undefined || lng === undefined ||
        !claimRadiusM || !towerClass || tributeToLordPct === undefined) {
      return res.json({ success: false, error: '필수 파라미터 누락' })
    }
    if (!TOWER_CLASSES[towerClass]) {
      return res.json({ success: false, error: '유효하지 않은 타워 클래스' })
    }
    const tributePct = parseFloat(tributeToLordPct)
    if (!Number.isFinite(tributePct) || tributePct < 0 || tributePct > 100) {
      return res.json({ success: false, error: '조공률 0~100 범위' })
    }

    // lord territory 검증
    const lt = await db.query(
      'SELECT * FROM territories WHERE id=$1', [lordTerritoryId]
    )
    if (lt.rows.length === 0) return res.json({ success: false, error: '대상 영역 없음' })
    const lord = lt.rows[0]
    if (lord.user_id === vassalUserId) {
      return res.json({ success: false, error: '자기 영역에는 자기 속국이 자동 — 계약 불필요. 그냥 /api/towers/place 호출' })
    }

    // 위치가 lord 영역 안에 있어야 함 (Haversine)
    const inside = await db.query(
      `SELECT (SQRT(POW((center_lat - $1) * 111000, 2) + POW((center_lng - $2) * 88700, 2)) < radius) AS inside
       FROM territories WHERE id=$3`,
      [parseFloat(lat), parseFloat(lng), lordTerritoryId]
    )
    if (!inside.rows[0]?.inside) {
      return res.json({ success: false, error: '제안 위치가 대상 영역 밖입니다' })
    }

    // vassal의 레벨 cap 사전 검증
    const u = await db.query('SELECT level FROM users WHERE id=$1', [vassalUserId])
    if (u.rows.length === 0) return res.json({ success: false, error: 'vassal 사용자 없음' })
    const vLevel = parseInt(u.rows[0].level) || 1
    const cap = levelTable.maxRadiusM(vLevel)
    const reqR = parseInt(claimRadiusM)
    if (reqR > cap) {
      return res.json({ success: false, error: `Lv${vLevel}는 최대 반경 ${cap}m (제안 ${reqR}m)` })
    }

    // 동일 (vassal, lord_territory) 이미 pending이면 갱신 (한 사람당 한 영역에 1개 pending)
    const existing = await db.query(
      `SELECT id FROM vassal_contracts
       WHERE vassal_user_id=$1 AND lord_territory_id=$2 AND status='pending'`,
      [vassalUserId, lordTerritoryId]
    )
    let contractId
    if (existing.rows.length > 0) {
      contractId = existing.rows[0].id
      await db.query(
        `UPDATE vassal_contracts SET
            proposed_position_lat=$2, proposed_position_lng=$3,
            proposed_radius_m=$4, proposed_tower_class=$5, tribute_to_lord_pct=$6,
            proposed_at=NOW(), expires_at=NOW() + ($7 || ' hours')::INTERVAL
         WHERE id=$1`,
        [contractId, parseFloat(lat), parseFloat(lng), reqR, towerClass, tributePct, PROPOSE_TTL_HOURS]
      )
    } else {
      const ins = await db.query(
        `INSERT INTO vassal_contracts (
           vassal_user_id, lord_user_id, lord_territory_id,
           proposed_position_lat, proposed_position_lng,
           proposed_radius_m, proposed_tower_class, tribute_to_lord_pct,
           status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending',
                 NOW() + ($9 || ' hours')::INTERVAL)
         RETURNING id`,
        [vassalUserId, lord.user_id, lordTerritoryId, parseFloat(lat), parseFloat(lng),
         reqR, towerClass, tributePct, PROPOSE_TTL_HOURS]
      )
      contractId = ins.rows[0].id
    }

    // lord에게 푸시
    try {
      const lf = await db.query('SELECT fcm_token, username FROM users WHERE id=$1', [lord.user_id])
      const vu = await db.query('SELECT username FROM users WHERE id=$1', [vassalUserId])
      if (lf.rows[0]?.fcm_token) {
        const { sendPush } = require('../fcm')
        await sendPush(lf.rows[0].fcm_token, '🤝 속국 제안',
          `${vu.rows[0]?.username || '?'}이(가) 영역 안에 ${reqR}m 영역 + 조공 ${tributePct}% 제안`,
          { type: 'VASSAL_PROPOSE', contractId })
      }
    } catch {}

    res.json({ success: true, contractId, expiresInHours: PROPOSE_TTL_HOURS })
  } catch (e) {
    console.error('vassal propose error', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// POST /api/vassal/accept
//   body: { lordUserId, contractId }
//   서버가 vassal의 territory + tower를 atomic으로 생성. status='active'.
router.post('/accept', async (req, res) => {
  const client = await db.pool.connect().catch(() => null)
  if (!client) return res.status(500).json({ success: false, error: 'DB 연결 실패' })

  try {
    await client.query('BEGIN')
    const { lordUserId, contractId } = req.body
    if (!lordUserId || !contractId) {
      await client.query('ROLLBACK')
      return res.json({ success: false, error: '필수 파라미터 누락' })
    }

    const c = await client.query(
      `SELECT * FROM vassal_contracts
       WHERE id=$1 AND lord_user_id=$2 AND status='pending' AND expires_at > NOW()`,
      [contractId, lordUserId]
    )
    if (c.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.json({ success: false, error: '유효한 pending 계약 없음 (만료/없음/권한 X)' })
    }
    const ct = c.rows[0]

    // vassal의 cap/예산/개수 재확인 (제안 시점 ~ accept 시점에 변동 가능)
    const uRes = await client.query('SELECT level FROM users WHERE id=$1', [ct.vassal_user_id])
    const vLevel = parseInt(uRes.rows[0]?.level) || 1
    const reqR = parseInt(ct.proposed_radius_m)
    const cap = levelTable.maxRadiusM(vLevel)
    if (reqR > cap) {
      await client.query('UPDATE vassal_contracts SET status=$2, responded_at=NOW() WHERE id=$1', [contractId, 'rejected'])
      await client.query('COMMIT')
      return res.json({ success: false, error: `vassal Lv${vLevel} 캡 초과 (요청 ${reqR}m > cap ${cap}m). 자동 거절.` })
    }
    const aRes = await client.query(
      'SELECT COALESCE(SUM(PI() * radius * radius), 0) AS used, COUNT(*) AS n FROM territories WHERE user_id=$1',
      [ct.vassal_user_id]
    )
    const usedArea = parseFloat(aRes.rows[0].used) || 0
    const newArea = Math.PI * reqR * reqR
    const budget = levelTable.maxTotalAreaM2(vLevel)
    const towerCount = parseInt(aRes.rows[0].n) || 0
    const towerCap = levelTable.maxTowerCount(vLevel)
    if (usedArea + newArea > budget) {
      await client.query('UPDATE vassal_contracts SET status=$2, responded_at=NOW() WHERE id=$1', [contractId, 'rejected'])
      await client.query('COMMIT')
      return res.json({ success: false, error: 'vassal 면적 예산 초과 — 자동 거절' })
    }
    if (towerCount >= towerCap) {
      await client.query('UPDATE vassal_contracts SET status=$2, responded_at=NOW() WHERE id=$1', [contractId, 'rejected'])
      await client.query('COMMIT')
      return res.json({ success: false, error: 'vassal 영역 개수 cap 도달 — 자동 거절' })
    }

    // lord 영역이 여전히 존재하는지
    const lt = await client.query('SELECT id FROM territories WHERE id=$1', [ct.lord_territory_id])
    if (lt.rows.length === 0) {
      await client.query('UPDATE vassal_contracts SET status=$2, responded_at=NOW() WHERE id=$1', [contractId, 'rejected'])
      await client.query('COMMIT')
      return res.json({ success: false, error: '대상 영역이 사라졌습니다. 계약 무효.' })
    }

    // territory + tower 생성
    const tier = 1
    const stats = towerStats(ct.proposed_tower_class, tier)
    const territoryRes = await client.query(
      `INSERT INTO territories (user_id, center_lat, center_lng, radius, parent_territory_id, tower_type)
       VALUES ($1, $2, $3, $4, $5, 'normal') RETURNING *`,
      [ct.vassal_user_id, ct.proposed_position_lat, ct.proposed_position_lng, reqR, ct.lord_territory_id]
    )
    const territory = territoryRes.rows[0]
    const towerRes = await client.query(
      `INSERT INTO fixed_guardians (user_id, territory_id, guardian_type, tower_class, tier,
                                     tower_range, fire_rate_ms, atk, def, hp, max_hp,
                                     position_lat, position_lng)
       VALUES ($1, $2, 'defense', $3, $4, $5, $6, $7, $8, $9, $9, $10, $11) RETURNING *`,
      [ct.vassal_user_id, territory.id, ct.proposed_tower_class, tier,
       stats.range, stats.fireRateMs, stats.damage, Math.round(stats.damage * 0.5),
       stats.hp, ct.proposed_position_lat, ct.proposed_position_lng]
    )

    await client.query(
      `UPDATE vassal_contracts SET status='active', responded_at=NOW(), vassal_territory_id=$2 WHERE id=$1`,
      [contractId, territory.id]
    )

    await client.query('COMMIT')

    // vassal에게 푸시
    try {
      const vf = await client.query('SELECT fcm_token FROM users WHERE id=$1', [ct.vassal_user_id])
      if (vf.rows[0]?.fcm_token) {
        const { sendPush } = require('../fcm')
        await sendPush(vf.rows[0].fcm_token, '✅ 속국 계약 성립',
          `당신의 ${reqR}m 영역이 생성되었습니다 (조공 ${ct.tribute_to_lord_pct}%)`,
          { type: 'VASSAL_ACCEPTED', contractId, territoryId: territory.id })
      }
    } catch {}

    res.json({
      success: true,
      contract: { id: contractId, status: 'active', tributeToLordPct: ct.tribute_to_lord_pct },
      territory: {
        id: territory.id, userId: ct.vassal_user_id,
        center: { lat: parseFloat(territory.center_lat), lng: parseFloat(territory.center_lng) },
        radius: parseInt(territory.radius), parentTerritoryId: ct.lord_territory_id
      },
      tower: towerRes.rows[0]
    })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    console.error('vassal accept error', e)
    res.status(500).json({ success: false, error: e.message })
  } finally {
    client.release()
  }
})

// POST /api/vassal/reject
router.post('/reject', async (req, res) => {
  try {
    const { lordUserId, contractId } = req.body
    const r = await db.query(
      `UPDATE vassal_contracts SET status='rejected', responded_at=NOW()
       WHERE id=$1 AND lord_user_id=$2 AND status='pending' RETURNING id`,
      [contractId, lordUserId]
    )
    if (r.rows.length === 0) return res.json({ success: false, error: 'pending 계약 없음' })

    // vassal에게 푸시
    try {
      const c = await db.query('SELECT vassal_user_id FROM vassal_contracts WHERE id=$1', [contractId])
      const vf = await db.query('SELECT fcm_token FROM users WHERE id=$1', [c.rows[0].vassal_user_id])
      if (vf.rows[0]?.fcm_token) {
        const { sendPush } = require('../fcm')
        await sendPush(vf.rows[0].fcm_token, '❌ 속국 거절', '제안이 거절되었습니다',
          { type: 'VASSAL_REJECTED', contractId })
      }
    } catch {}

    res.json({ success: true })
  } catch (e) {
    console.error('vassal reject error', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// POST /api/vassal/dissolve  — 양측 누구나 호출 가능. 즉시 해제(향후 페널티 추가 여지).
//   해제 시 vassal_territory는 그대로 두되 parent_territory_id를 NULL로 끊음 → 독립 영역화.
router.post('/dissolve', async (req, res) => {
  const client = await db.pool.connect().catch(() => null)
  if (!client) return res.status(500).json({ success: false, error: 'DB 연결 실패' })

  try {
    await client.query('BEGIN')
    const { userId, contractId } = req.body
    const c = await client.query(
      `SELECT * FROM vassal_contracts
       WHERE id=$1 AND status='active' AND (vassal_user_id=$2 OR lord_user_id=$2)`,
      [contractId, userId]
    )
    if (c.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.json({ success: false, error: '활성 계약 없음 또는 권한 없음' })
    }
    const ct = c.rows[0]
    await client.query(
      `UPDATE vassal_contracts SET status='dissolved', dissolved_at=NOW() WHERE id=$1`, [contractId]
    )
    if (ct.vassal_territory_id) {
      await client.query(
        `UPDATE territories SET parent_territory_id=NULL WHERE id=$1`, [ct.vassal_territory_id]
      )
    }
    await client.query('COMMIT')
    res.json({ success: true })
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    console.error('vassal dissolve error', e)
    res.status(500).json({ success: false, error: e.message })
  } finally {
    client.release()
  }
})

// GET /api/vassal/incoming/:userId  — 내가 lord인 pending 제안들
router.get('/incoming/:userId', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT vc.*, vu.username AS vassal_name
       FROM vassal_contracts vc
       LEFT JOIN users vu ON vc.vassal_user_id = vu.id
       WHERE vc.lord_user_id=$1 AND vc.status='pending' AND vc.expires_at > NOW()
       ORDER BY vc.proposed_at DESC LIMIT 50`,
      [req.params.userId]
    )
    const fnum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
    res.json({
      success: true,
      proposals: r.rows.map(c => ({
        contractId: c.id,
        vassalUserId: c.vassal_user_id,
        vassalName: c.vassal_name || '?',
        lordTerritoryId: c.lord_territory_id,
        proposedPosition: { lat: fnum(c.proposed_position_lat), lng: fnum(c.proposed_position_lng) },
        proposedRadiusM: parseInt(c.proposed_radius_m),
        proposedTowerClass: c.proposed_tower_class,
        tributeToLordPct: parseFloat(c.tribute_to_lord_pct),
        proposedAt: c.proposed_at,
        expiresAt: c.expires_at
      }))
    })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

// GET /api/vassal/my/:userId  — 내가 가입돼 있는 모든 active 계약 (vassal로든 lord로든)
router.get('/my/:userId', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT vc.*, vu.username AS vassal_name, lu.username AS lord_name
       FROM vassal_contracts vc
       LEFT JOIN users vu ON vc.vassal_user_id = vu.id
       LEFT JOIN users lu ON vc.lord_user_id = lu.id
       WHERE (vc.vassal_user_id=$1 OR vc.lord_user_id=$1) AND vc.status='active'
       ORDER BY vc.responded_at DESC`,
      [req.params.userId]
    )
    res.json({
      success: true,
      contracts: r.rows.map(c => ({
        contractId: c.id,
        role: c.vassal_user_id === req.params.userId ? 'vassal' : 'lord',
        vassalUserId: c.vassal_user_id,
        vassalName: c.vassal_name || '?',
        lordUserId: c.lord_user_id,
        lordName: c.lord_name || '?',
        lordTerritoryId: c.lord_territory_id,
        vassalTerritoryId: c.vassal_territory_id,
        tributeToLordPct: parseFloat(c.tribute_to_lord_pct),
        tributeTotal: parseInt(c.tribute_total) || 0,
        establishedAt: c.responded_at
      }))
    })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

module.exports = router
