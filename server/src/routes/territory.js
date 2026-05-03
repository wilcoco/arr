const express = require('express')
const router = express.Router()
const db = require('../db')

// 리더보드 (영역 점유 면적 기준 상위 20명)
// ?season=current (시즌 전투승 기준) | all-time (누적 전투승 기준) | area (기본: 면적)
router.get('/leaderboard', async (req, res) => {
  try {
    const mode = req.query.season || 'area'

    // 정렬 기준 결정
    let orderBy, winColumn
    if (mode === 'current') {
      orderBy = 'season_wins DESC, total_area DESC NULLS LAST'
      winColumn = 'COALESCE(u.battle_wins_season, 0)'
    } else if (mode === 'all-time') {
      orderBy = 'all_wins DESC, total_area DESC NULLS LAST'
      winColumn = 'COALESCE(u.battle_wins, 0)'
    } else {
      orderBy = 'total_area DESC NULLS LAST'
      winColumn = 'COALESCE(u.battle_wins, 0)'
    }

    // 현재 시즌 정보
    const seasonRes = await db.query(
      'SELECT id, name, started_at FROM seasons WHERE is_active = true ORDER BY id DESC LIMIT 1'
    )
    const currentSeason = seasonRes.rows[0] || null

    const result = await db.query(`
      SELECT
        u.id,
        u.username,
        u.user_layer,
        COALESCE(u.battle_wins, 0) AS all_wins,
        COALESCE(u.battle_wins_season, 0) AS season_wins,
        COUNT(t.id)                      AS territory_count,
        COALESCE(SUM(PI() * t.radius * t.radius), 0) AS total_area,
        COUNT(t.id) FILTER (WHERE t.tower_type = 'revenue') AS revenue_towers
      FROM users u
      LEFT JOIN territories t ON t.user_id = u.id
      GROUP BY u.id, u.username, u.user_layer, u.battle_wins, u.battle_wins_season
      ORDER BY ${orderBy}
      LIMIT 20
    `)
    // 모든 숫자 필드는 NaN 방지 — JsonUtility에서 null로 직렬화되면 파싱 실패
    const num = (v, d = 0) => { const n = parseInt(v); return Number.isFinite(n) ? n : d }
    const numF = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
    res.json({
      mode: mode || 'area',
      season: currentSeason || { id: 0, name: '', started_at: '' },
      leaderboard: result.rows.map((r, i) => ({
        rank: i + 1,
        userId: r.id || '',
        username: r.username || '',
        layer: r.user_layer || 'beginner',
        battleWins: num(r.all_wins),
        seasonWins: num(r.season_wins),
        territoryCount: num(r.territory_count),
        totalArea: Math.round(numF(r.total_area)),
        revenueTowers: num(r.revenue_towers)
      }))
    })
  } catch (err) {
    console.error('Leaderboard error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 영역 확장
router.post('/expand', async (req, res) => {
  try {
    const { userId, lat, lng, radius, towerType } = req.body

    // 겹침 방지: 기존 영역과 두 반경의 합보다 가까우면 거절 (자기/남 무관)
    const overlap = await db.query(
      `SELECT t.id, t.user_id, u.username,
              SQRT(POW((t.center_lat - $1) * 111000, 2) +
                   POW((t.center_lng - $2) * 88700, 2)) AS dist,
              t.radius
       FROM territories t LEFT JOIN users u ON t.user_id = u.id
       WHERE SQRT(POW((t.center_lat - $1) * 111000, 2) +
                  POW((t.center_lng - $2) * 88700, 2)) < (t.radius + $3)
       ORDER BY dist ASC LIMIT 1`,
      [lat, lng, radius]
    )
    if (overlap.rows.length > 0) {
      const o = overlap.rows[0]
      const isMine = o.user_id === userId
      const who = isMine ? '내 영역' : `${o.username || '다른 사용자'}의 영역`
      return res.json({
        success: false,
        error: `${who}과 겹칩니다 (${Math.round(o.dist)}m, 반경 ${Math.round(o.radius)}m). 다른 위치로 이동하세요.`,
        overlapWithMine: isMine,
        overlapOwner: o.username
      })
    }

    const result = await db.query(
      `INSERT INTO territories (user_id, center_lat, center_lng, radius, tower_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, lat, lng, radius, towerType || 'normal']
    )

    const r0 = result.rows[0]
    // XP +20, ult_charge +10, 미션 hook
    const lvResult = await require('../levels').gainXp(null, userId, 20, 'territory_expand').catch(() => null)
    await db.query(
      `UPDATE guardians SET ult_charge = LEAST(100, COALESCE(ult_charge,0) + 10) WHERE user_id = $1`,
      [userId]
    ).catch(() => {})
    require('./missions').progressMission(userId, 'territory_expand', 1).catch(() => {})
    require('./tutorial').autoAdvance(userId, 'expand_first').catch(() => {})

    res.json({
      success: true,
      territory: {
        id: r0.id || '',
        userId: r0.user_id || '',
        center: { lat: parseFloat(lat) || 0, lng: parseFloat(lng) || 0 },
        radius: parseFloat(radius) || 0,
        vulnerable_until: '',
        tower_type: r0.tower_type || 'normal'
      },
      xpGained: 20,
      levelUp: lvResult?.leveledUp ? lvResult : null
    })
  } catch (err) {
    console.error('Territory expand error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 고정 수호신 배치
router.post('/place-guardian', async (req, res) => {
  try {
    const { territoryId, userId, lat, lng, stats, guardianType } = req.body

    // 영역당 고정 수호신 최대 3개 제한
    const fgCount = await db.query(
      'SELECT COUNT(*) FROM fixed_guardians WHERE territory_id = $1',
      [territoryId]
    )
    if (parseInt(fgCount.rows[0].count) >= 3) {
      return res.status(400).json({ success: false, error: '영역당 최대 3개까지 배치할 수 있습니다' })
    }

    // 본체 수호신 능력치 차감
    const guardian = await db.query(
      'SELECT * FROM guardians WHERE user_id = $1',
      [userId]
    )

    if (guardian.rows.length === 0) {
      return res.status(400).json({ success: false, error: '수호신이 없습니다' })
    }

    const g = guardian.rows[0]

    // 능력치 분배 가능 확인
    if (g.atk < stats.atk || g.def < stats.def || g.hp < stats.hp) {
      return res.status(400).json({ success: false, error: '능력치가 부족합니다' })
    }

    // 본체 능력치 차감
    await db.query(
      `UPDATE guardians SET atk = atk - $1, def = def - $2, hp = hp - $3
       WHERE user_id = $4`,
      [stats.atk, stats.def, stats.hp, userId]
    )

    // 고정 수호신 생성
    const result = await db.query(
      `INSERT INTO fixed_guardians (territory_id, user_id, position_lat, position_lng, atk, def, hp, guardian_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [territoryId, userId, lat, lng, stats.atk, stats.def, stats.hp, guardianType || 'defense']
    )

    res.json({
      success: true,
      fixedGuardian: {
        id: result.rows[0].id,
        position: { lat, lng },
        stats,
        type: guardianType
      }
    })
  } catch (err) {
    console.error('Place guardian error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 주변 영역 조회 (침입 감지용)
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, radius, excludeUserId } = req.query

    if (!lat || !lng || !excludeUserId) {
      return res.json({ territories: [] })
    }

    const result = await db.query(
      `SELECT t.*, u.username
       FROM territories t
       JOIN users u ON t.user_id = u.id
       WHERE t.user_id::text != $1
       LIMIT 20`,
      [excludeUserId]
    )

    const fnum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
    res.json({
      territories: result.rows.map(t => ({
        id: t.id || '',
        userId: t.user_id || '',
        username: t.username || '',
        center: { lat: fnum(t.center_lat), lng: fnum(t.center_lng) },
        radius: fnum(t.radius),
        vulnerable_until: t.vulnerable_until ? new Date(t.vulnerable_until).toISOString() : '',
        tower_type: t.tower_type || 'normal',
        atari_started_at: t.atari_started_at ? new Date(t.atari_started_at).toISOString() : '',
        in_eye_zone: !!t.in_eye_zone
      }))
    })
  } catch (err) {
    console.error('Nearby territories error:', err)
    res.json({ territories: [] })
  }
})

// 내 영역 목록
router.get('/my/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    const territories = await db.query(
      'SELECT * FROM territories WHERE user_id = $1',
      [userId]
    )

    const fixedGuardians = await db.query(
      'SELECT * FROM fixed_guardians WHERE user_id = $1',
      [userId]
    )

    const num = (v, d = 0) => { const n = parseInt(v); return Number.isFinite(n) ? n : d }
    const fnum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
    res.json({
      territories: territories.rows.map(t => ({
        id: t.id || '',
        userId: t.user_id || '',
        center: { lat: fnum(t.center_lat), lng: fnum(t.center_lng) },
        radius: fnum(t.radius),
        vulnerable_until: t.vulnerable_until ? new Date(t.vulnerable_until).toISOString() : '',
        tower_type: t.tower_type || 'normal'
      })),
      fixedGuardians: fixedGuardians.rows.map(fg => ({
        id: fg.id || '',
        territoryId: fg.territory_id || '',
        position: { lat: fnum(fg.position_lat), lng: fnum(fg.position_lng) },
        stats: { atk: num(fg.atk), def: num(fg.def), hp: num(fg.hp), maxHp: num(fg.max_hp, num(fg.hp)) },
        type: fg.guardian_type || 'defense',
        towerClass: fg.tower_class || 'generic',
        tier: num(fg.tier, 1),
        range: num(fg.tower_range, 80)
      }))
    })
  } catch (err) {
    console.error('My territories error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// 영역 침입 체크
router.post('/check-intrusion', async (req, res) => {
  try {
    const { userId, lat, lng } = req.body

    if (!userId || lat === undefined || lng === undefined) {
      return res.json({ intruded: false, territory: null })
    }

    // 현재 위치가 다른 사람 영역 안에 있는지 확인
    const result = await db.query(
      `SELECT t.*, u.username
       FROM territories t
       JOIN users u ON t.user_id = u.id
       WHERE t.user_id::text != $1
         AND SQRT(POW(t.center_lat - $2, 2) + POW(t.center_lng - $3, 2)) * 111000 < t.radius`,
      [userId, lat, lng]
    )

    if (result.rows.length > 0) {
      const territory = result.rows[0]
      res.json({
        intruded: true,
        territory: {
          id: territory.id,
          userId: territory.user_id,
          username: territory.username,
          center: { lat: territory.center_lat, lng: territory.center_lng },
          radius: territory.radius
        }
      })
    } else {
      res.json({ intruded: false, territory: null })
    }
  } catch (err) {
    console.error('Check intrusion error:', err)
    res.json({ intruded: false, territory: null })
  }
})

// 주변 고정 수호신 조회
router.get('/nearby-fixed-guardians', async (req, res) => {
  try {
    const { lat, lng, radius, excludeUserId } = req.query

    // 파라미터 검증
    if (!lat || !lng || !excludeUserId) {
      return res.json({ fixedGuardians: [] })
    }

    const degreeRadius = parseFloat(radius || 1000) / 111000

    const result = await db.query(
      `SELECT fg.*, u.username, t.center_lat, t.center_lng, t.radius as territory_radius
       FROM fixed_guardians fg
       JOIN users u ON fg.user_id = u.id
       JOIN territories t ON fg.territory_id = t.id
       WHERE fg.user_id::text != $1
       LIMIT 50`,
      [excludeUserId || '']
    )

    const num = (v, d = 0) => { const n = parseInt(v); return Number.isFinite(n) ? n : d }
    const fnum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
    res.json({
      fixedGuardians: result.rows.map(fg => ({
        id: fg.id || '',
        owner: fg.username || '',
        ownerId: fg.user_id || '',
        position: { lat: fnum(fg.position_lat), lng: fnum(fg.position_lng) },
        stats: {
          atk: num(fg.atk), def: num(fg.def),
          hp: num(fg.hp), maxHp: num(fg.max_hp, num(fg.hp))
        },
        type: fg.guardian_type || 'defense',
        territoryId: fg.territory_id || '',
        towerClass: fg.tower_class || 'arrow',
        tier: num(fg.tier, 1),
        range: num(fg.tower_range, 80),
        fireRateMs: num(fg.fire_rate_ms, 3000)
      }))
    })
  } catch (err) {
    console.error('Nearby fixed guardians error:', err)
    // 테이블 없거나 에러 시 빈 배열 반환
    res.json({ fixedGuardians: [] })
  }
})

// 미확인 영역 손실 알림
router.get('/losses/:userId', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT tl.*, u.username AS taken_by_name FROM territory_losses tl
       LEFT JOIN users u ON tl.new_owner_id = u.id
       WHERE tl.former_owner_id = $1 ORDER BY tl.created_at DESC LIMIT 30`,
      [req.params.userId]
    )
    const fnum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
    res.json({
      success: true,
      losses: r.rows.map(l => ({
        id: l.id,
        center: { lat: fnum(l.center_lat), lng: fnum(l.center_lng) },
        radius: fnum(l.radius),
        takenBy: l.taken_by_name || '?',
        lossType: l.loss_type,
        viewed: !!l.viewed,
        createdAt: l.created_at ? new Date(l.created_at).toISOString() : ''
      })),
      unviewedCount: r.rows.filter(l => !l.viewed).length
    })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

router.post('/losses/mark-viewed', async (req, res) => {
  try {
    const { userId } = req.body
    await db.query('UPDATE territory_losses SET viewed=true WHERE former_owner_id=$1', [userId])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
})

module.exports = router
