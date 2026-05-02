const express = require('express')
const router = express.Router()
const db = require('../db')

const LINK_DISTANCE_MULT = 1.5      // 두 영역 거리 < (r1+r2)*1.5 → 연결
const ATARI_SURROUND_MIN = 3        // 적 영역을 ≥3개로 둘러싸면 단수
const ATARI_DURATION_MS  = 24 * 60 * 60 * 1000  // 24시간
const ATARI_DAMAGE_PER_HOUR = 5

function distMeters(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sa = Math.sin(dLat/2)**2 +
             Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2
  return 2 * R * Math.asin(Math.sqrt(sa))
}

function isLinked(t1, t2) {
  const d = distMeters(
    { lat: t1.center_lat, lng: t1.center_lng },
    { lat: t2.center_lat, lng: t2.center_lng }
  )
  return d < (Number(t1.radius) + Number(t2.radius)) * LINK_DISTANCE_MULT
}

// 동맹 관계 맵 만들기: { userId: Set<allyUserId> }
async function buildAllianceMap() {
  const r = await db.query(`SELECT user_id_1, user_id_2 FROM alliances WHERE active = true`)
  const map = new Map()
  for (const row of r.rows) {
    if (!map.has(row.user_id_1)) map.set(row.user_id_1, new Set())
    if (!map.has(row.user_id_2)) map.set(row.user_id_2, new Set())
    map.get(row.user_id_1).add(row.user_id_2)
    map.get(row.user_id_2).add(row.user_id_1)
    // 자기 자신도 포함 (편의)
    map.get(row.user_id_1).add(row.user_id_1)
    map.get(row.user_id_2).add(row.user_id_2)
  }
  return map
}

function isFriendly(allyMap, ownerA, ownerB) {
  if (ownerA === ownerB) return true
  return !!(allyMap.get(ownerA)?.has(ownerB))
}

// 모든 영역의 진영(formation) 상태 계산
async function computeFormation() {
  const all = await db.query(`SELECT id, user_id, center_lat, center_lng, radius FROM territories`)
  const territories = all.rows
  const allyMap = await buildAllianceMap()

  // 1) 인접 그래프 작성 — 모든 쌍을 거리로 검사
  const links = []  // [{a, b}]
  const adj = new Map() // territoryId -> [{otherId, friendly, otherUserId}]
  for (const t of territories) adj.set(t.id, [])

  for (let i = 0; i < territories.length; i++) {
    for (let j = i + 1; j < territories.length; j++) {
      const a = territories[i], b = territories[j]
      if (!isLinked(a, b)) continue
      const friendly = isFriendly(allyMap, a.user_id, b.user_id)
      links.push({ a: a.id, b: b.id, friendly, aUser: a.user_id, bUser: b.user_id })
      adj.get(a.id).push({ otherId: b.id, friendly, otherUserId: b.user_id })
      adj.get(b.id).push({ otherId: a.id, friendly, otherUserId: a.user_id })
    }
  }

  // 2) 각 영역의 단수(atari) 상태 계산
  // 적 영역 t를 둘러싼 (uncloseable) 우호 영역들이 ≥3개면 atari
  const atariMap = new Map() // territoryId -> { surrounderIds[], attackerUserIds[] }
  for (const t of territories) {
    const enemies = adj.get(t.id).filter(e => !e.friendly)
    if (enemies.length >= ATARI_SURROUND_MIN) {
      // 적 사용자 ID 추출 (중복 제거)
      const attackerSet = new Set(enemies.map(e => e.otherUserId))
      atariMap.set(t.id, {
        surrounderIds: enemies.map(e => e.otherId),
        attackerUserIds: [...attackerSet]
      })
    }
  }

  // 3) 동맹 시너지 — 각 사용자가 가진 우호 연결 수
  // synergyByUser: userId -> linkedFriendlyTerritoriesCount
  const synergyByUser = new Map()
  for (const t of territories) {
    const friendlyLinks = adj.get(t.id).filter(e => e.friendly).length
    if (!synergyByUser.has(t.user_id)) synergyByUser.set(t.user_id, 0)
    synergyByUser.set(t.user_id, synergyByUser.get(t.user_id) + friendlyLinks)
  }

  // 4) "눈" 감지 (간이): 내 영역이 ≥3개의 같은 사용자 영역으로 둘러싸여 있고 적 영역이 인접 없으면 in_eye
  const eyeSet = new Set()
  for (const t of territories) {
    const sameOwnerLinks = adj.get(t.id).filter(e => e.otherUserId === t.user_id).length
    const enemyLinks = adj.get(t.id).filter(e => !e.friendly).length
    if (sameOwnerLinks >= 3 && enemyLinks === 0) eyeSet.add(t.id)
  }

  return { territories, adj, links, atariMap, synergyByUser, eyeSet }
}

// 사용자별 고정 수호신 개수 → 분산 패널티 계수
async function distributionPenalty(userId) {
  const r = await db.query(
    `SELECT COUNT(*) AS cnt FROM fixed_guardians WHERE user_id = $1`, [userId]
  )
  const n = parseInt(r.rows[0]?.cnt) || 0
  if (n <= 1) return 1.0
  return 1.0 / Math.sqrt(n)
}

// 동맹 시너지 보너스 (연결된 우호 영역 1개당 +5%, 최대 +30%)
function synergyBonus(linkedFriendlyCount) {
  return 1.0 + Math.min(0.30, linkedFriendlyCount * 0.05)
}

// 캐시 (60초)
let cached = null, cachedAt = 0
const CACHE_TTL_MS = 60 * 1000

router.get('/state', async (req, res) => {
  try {
    const now = Date.now()
    if (cached && now - cachedAt < CACHE_TTL_MS) {
      return res.json(cached)
    }
    const { territories, links, atariMap, synergyByUser, eyeSet } = await computeFormation()

    // atari_started_at 가져와서 남은 시간 계산
    const startedRows = await db.query(`SELECT id, atari_started_at FROM territories WHERE atari_started_at IS NOT NULL`)
    const startedMap = new Map(startedRows.rows.map(r => [r.id, r.atari_started_at]))

    const fnum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
    const payload = {
      success: true,
      territories: territories.map(t => {
        const started = startedMap.get(t.id)
        const elapsedMs = started ? (Date.now() - new Date(started).getTime()) : 0
        const remainMs = Math.max(0, ATARI_DURATION_MS - elapsedMs)
        return {
          id: t.id,
          userId: t.user_id,
          center: { lat: fnum(t.center_lat), lng: fnum(t.center_lng) },
          radius: fnum(t.radius),
          atari: atariMap.has(t.id),
          atariAttackers: atariMap.get(t.id)?.attackerUserIds || [],
          atariStartedAt: started ? new Date(started).toISOString() : '',
          atariRemainMs: started ? remainMs : 0,
          inEye: eyeSet.has(t.id)
        }
      }),
      links: links.map(l => ({ a: l.a, b: l.b, friendly: l.friendly })),
      synergyByUser: Object.fromEntries(synergyByUser),
      eyeIds: [...eyeSet],
      atariCount: atariMap.size
    }
    cached = payload
    cachedAt = now
    res.json(payload)
  } catch (e) {
    console.error('formation state error', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

router.post('/invalidate-cache', (req, res) => {
  cached = null
  res.json({ success: true })
})

module.exports = router
module.exports.computeFormation = computeFormation
module.exports.distributionPenalty = distributionPenalty
module.exports.synergyBonus = synergyBonus
module.exports.distMeters = distMeters
module.exports.LINK_DISTANCE_MULT = LINK_DISTANCE_MULT
module.exports.ATARI_DURATION_MS = ATARI_DURATION_MS
module.exports.ATARI_DAMAGE_PER_HOUR = ATARI_DAMAGE_PER_HOUR
