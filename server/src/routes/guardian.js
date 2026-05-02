const express = require('express')
const router = express.Router()
const db = require('../db')

// 수호신 생성
router.post('/create', async (req, res) => {
  try {
    const { visitorId, type, parts } = req.body

    // 먼저 사용자 생성 또는 조회
    let userResult = await db.query(
      'SELECT id FROM users WHERE username = $1',
      [visitorId]
    )

    let userId
    if (userResult.rows.length === 0) {
      // 새 사용자 생성
      const newUser = await db.query(
        'INSERT INTO users (username, energy_currency) VALUES ($1, 100) RETURNING id',
        [visitorId]
      )
      userId = newUser.rows[0].id
    } else {
      userId = userResult.rows[0].id
    }

    // 기존 수호신 확인
    const existingGuardian = await db.query(
      'SELECT id FROM guardians WHERE user_id = $1',
      [userId]
    )

    if (existingGuardian.rows.length > 0) {
      return res.status(400).json({ success: false, error: '이미 수호신이 있습니다' })
    }

    // 타입별 기본 스탯
    const baseStats = {
      animal: { atk: 10, def: 8, hp: 100, abs: 15, prd: 10, spd: 15, rng: 10, ter: 10 },
      robot: { atk: 15, def: 15, hp: 120, abs: 10, prd: 8, spd: 8, rng: 10, ter: 10 },
      aircraft: { atk: 12, def: 8, hp: 80, abs: 12, prd: 12, spd: 12, rng: 20, ter: 15 }
    }

    const stats = baseStats[type] || baseStats.animal

    // 수호신 생성
    const result = await db.query(
      `INSERT INTO guardians (user_id, type, parts, atk, def, hp, abs, prd, spd, rng, ter)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [userId, type, JSON.stringify(parts || {}), stats.atk, stats.def, stats.hp, stats.abs, stats.prd, stats.spd, stats.rng, stats.ter]
    )

    // 신규 유저는 24시간 방어막 자동 부여
    if (userResult.rows.length === 0) {
      await db.query(
        `UPDATE users SET shield_until = NOW() + INTERVAL '24 hours' WHERE id = $1`,
        [userId]
      )
    }

    const num = (v, d = 0) => { const n = parseInt(v); return Number.isFinite(n) ? n : d }
    const r0 = result.rows[0]
    res.json({
      success: true,
      guardian: {
        id: r0.id || '',
        type: r0.type || 'animal',
        stats: {
          atk: num(r0.atk), def: num(r0.def), hp: num(r0.hp), abs: num(r0.abs),
          prd: num(r0.prd), spd: num(r0.spd), rng: num(r0.rng), ter: num(r0.ter),
          ult_charge: num(r0.ult_charge)
        }
      },
      userId: userId || ''
    })
  } catch (err) {
    console.error('Guardian create error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 디버그: 모든 유저 위치 확인
router.get('/debug-users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, last_location_lat, last_location_lng, is_online FROM users LIMIT 20`
    )
    res.json({ users: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 주변 플레이어 조회 (/:visitorId 보다 먼저 정의해야 함!)
router.get('/nearby-players', async (req, res) => {
  try {
    const { lat, lng, radius, excludeUserId } = req.query

    // 일단 모든 유저 반환 (위치 있는)
    const result = await db.query(
      `SELECT u.id, u.username, u.last_location_lat, u.last_location_lng, u.is_online,
              g.type as guardian_type, g.atk, g.def, g.hp
       FROM users u
       LEFT JOIN guardians g ON u.id = g.user_id
       WHERE u.last_location_lat IS NOT NULL
         AND u.last_location_lng IS NOT NULL
         AND u.id::text != $1
       LIMIT 50`,
      [excludeUserId || '']
    )

    console.log('Nearby players query result:', result.rows.length, 'excludeUserId:', excludeUserId)

    const num = (v, d = 0) => { const n = parseInt(v); return Number.isFinite(n) ? n : d }
    const fnum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
    res.json({
      players: result.rows.map(p => ({
        id: p.id || '',
        username: p.username || '',
        location: { lat: fnum(p.last_location_lat), lng: fnum(p.last_location_lng) },
        isOnline: !!p.is_online,
        guardian: p.guardian_type ? {
          id: '',
          type: p.guardian_type,
          stats: { atk: num(p.atk), def: num(p.def), hp: num(p.hp), abs: 0, prd: 0, spd: 0, rng: 0, ter: 0, ult_charge: 0 }
        } : null
      }))
    })
  } catch (err) {
    console.error('Nearby players error:', err)
    res.json({ players: [], error: err.message })
  }
})

// 수호신 조회 (주의: 이 라우트는 /nearby-players 뒤에 있어야 함)
router.get('/:visitorId', async (req, res) => {
  try {
    const { visitorId } = req.params

    const result = await db.query(
      `SELECT g.*, u.id as user_id, u.energy_currency, u.user_layer, u.battle_wins, u.graduated_at
       FROM guardians g
       JOIN users u ON g.user_id = u.id
       WHERE u.username = $1`,
      [visitorId]
    )

    if (result.rows.length === 0) {
      return res.json({ guardian: null })
    }

    const g = result.rows[0]
    const num = (v, d = 0) => { const n = parseInt(v); return Number.isFinite(n) ? n : d }
    const base = {
      atk: num(g.atk), def: num(g.def), hp: num(g.hp), abs: num(g.abs),
      prd: num(g.prd), spd: num(g.spd), rng: num(g.rng), ter: num(g.ter),
      ult_charge: num(g.ult_charge)
    }

    // 장착 파츠 유효 스탯
    const { computeEffectiveStats } = require('./parts')
    const effectiveResult = await computeEffectiveStats(g.user_id, base)
    const { stats: effectiveStats, equippedParts, activePassives, level: levelInfo, formation } = effectiveResult

    res.json({
      guardian: {
        id: g.id || '',
        type: g.type || 'animal',
        stats: base,
        effectiveStats: effectiveStats || base,
        equippedParts: equippedParts || [],
        activePassives: activePassives || [],
        formation: formation || null
      },
      userId: g.user_id || '',
      energy: num(g.energy_currency),
      layer: g.user_layer || 'beginner',
      battleWins: num(g.battle_wins),
      graduatedAt: g.graduated_at ? new Date(g.graduated_at).toISOString() : '',
      level: levelInfo
    })
  } catch (err) {
    console.error('Guardian get error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 위치 업데이트 — 타워 디펜스 데미지 발동
router.post('/location', async (req, res) => {
  try {
    const { visitorId, lat, lng } = req.body

    const u = await db.query(
      `UPDATE users SET last_location_lat = $1, last_location_lng = $2, is_online = true
       WHERE username = $3 RETURNING id`,
      [lat, lng, visitorId]
    )
    const userId = u.rows[0]?.id

    // 타워 자동 발사 처리
    let towerResult = { strikes: [], totalDmg: 0 }
    if (userId) {
      try {
        towerResult = await require('./towers').processTowerDamage(userId, parseFloat(lat), parseFloat(lng))
      } catch (e) { console.error('tower damage', e.message) }
    }

    res.json({ success: true, towerStrikes: towerResult.strikes, totalTowerDamage: towerResult.totalDmg })
  } catch (err) {
    console.error('Location update error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
