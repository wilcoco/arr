#!/usr/bin/env node
/**
 * Guardian AR — 대규모 사용자 시뮬레이션
 *
 * 사용:
 *   API_URL=http://localhost:3001 node tools/loadtest.js --users=100 --duration=60
 *   API_URL=https://arr-production.up.railway.app node tools/loadtest.js --users=20 --duration=30
 *
 * 옵션:
 *   --users      동시 사용자 수 (기본 50)
 *   --duration   초 단위 (기본 30)
 *   --center     "lat,lng" 시뮬 중심 (기본 서울 37.5,127.0)
 *   --spread     도(degree) 단위 분산 반경 (기본 0.02 ≈ 2km)
 *   --cleanup    종료 시 생성한 사용자 영역 reset 호출 여부 (기본 true)
 *
 * 액션 분포 (각 사용자 매 tick):
 *   55% 위치 이동   (random walk)
 *   15% 영역 확장 시도
 *   15% 타워 배치 시도
 *    8% 침입 체크 (이미 자동 호출됨)
 *    5% 전투 요청
 *    2% 동맹 요청
 */

const API_URL = process.env.API_URL || 'http://localhost:3001'

// ─── CLI 파싱 ─────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  })
)
const N        = parseInt(args.users || 50)
const DURATION = parseInt(args.duration || 30)
const [CLAT, CLNG] = (args.center || '37.5,127.0').split(',').map(Number)
const SPREAD   = parseFloat(args.spread || 0.02)
const CLEANUP  = args.cleanup !== 'false'

console.log(`[loadtest] target=${API_URL} users=${N} duration=${DURATION}s spread=${SPREAD}°`)

// ─── 메트릭 ─────────────────────────────────────────────────
const stats = {} // { endpoint: { ok, fail, errors:{[msg]:count}, latencies:[] } }
function record(endpoint, ok, latency, errMsg) {
  const s = stats[endpoint] ??= { ok: 0, fail: 0, errors: {}, latencies: [] }
  if (ok) s.ok++
  else {
    s.fail++
    const k = (errMsg || 'unknown').slice(0, 80)
    s.errors[k] = (s.errors[k] || 0) + 1
  }
  s.latencies.push(latency)
}

async function call(method, path, body) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })
    const json = await res.json().catch(() => ({}))
    const latency = Date.now() - t0
    const ok = res.ok && (json.success !== false)
    record(path.replace(/\/[0-9a-f-]{36}/, '/:id').split('?')[0], ok, latency,
           ok ? null : json.error)
    return { ok, json, latency }
  } catch (e) {
    record(path, false, Date.now() - t0, e.message)
    return { ok: false, json: {}, latency: Date.now() - t0 }
  }
}

// ─── 가상 사용자 ───────────────────────────────────────────
class SimUser {
  constructor(idx) {
    this.idx = idx
    this.visitorId = `loadtest_${Date.now()}_${idx}`
    this.userId = null
    this.lat = CLAT + (Math.random() - 0.5) * SPREAD
    this.lng = CLNG + (Math.random() - 0.5) * SPREAD
    this.energy = 100
    this.territories = []
    this.fixedGuardians = []
  }

  async setup() {
    const types = ['animal', 'robot', 'aircraft']
    const r = await call('POST', '/api/guardian/create', {
      visitorId: this.visitorId,
      type: types[this.idx % types.length]
    })
    if (r.ok && r.json.guardian) this.userId = r.json.userId
    else {
      // 이미 존재 시 fetch
      const g = await call('GET', `/api/guardian/${this.visitorId}`)
      if (g.ok) this.userId = g.json.userId
    }
  }

  randomWalk() {
    this.lat += (Math.random() - 0.5) * 0.0005
    this.lng += (Math.random() - 0.5) * 0.0005
  }

  async tick() {
    if (!this.userId) return
    const roll = Math.random()
    this.randomWalk()

    if (roll < 0.55) {
      // 위치 이동
      await call('POST', '/api/guardian/location',
        { visitorId: this.visitorId, lat: this.lat, lng: this.lng })
    } else if (roll < 0.70) {
      // 영역 확장
      const radius = [50, 100, 200][Math.floor(Math.random() * 3)]
      const r = await call('POST', '/api/territory/expand',
        { userId: this.userId, lat: this.lat, lng: this.lng, radius })
      if (r.ok && r.json.territory) this.territories.push(r.json.territory)
    } else if (roll < 0.85) {
      // 타워 배치 (보유 영역 있을 때)
      if (this.territories.length === 0) return
      const t = this.territories[Math.floor(Math.random() * this.territories.length)]
      const classes = ['generic','balista','cannon','assault','scifi','fire','ice','aqua']
      const towerClass = classes[Math.floor(Math.random() * classes.length)]
      await call('POST', '/api/towers/place',
        { userId: this.userId, territoryId: t.id, towerClass, tier: 1 })
    } else if (roll < 0.93) {
      // 침입 체크
      await call('POST', '/api/territory/check-intrusion',
        { userId: this.userId, lat: this.lat, lng: this.lng })
    } else if (roll < 0.98) {
      // 주변 플레이어 → 전투 요청
      const np = await call('GET',
        `/api/guardian/nearby-players?lat=${this.lat}&lng=${this.lng}&radius=500&excludeUserId=${this.userId}`)
      const others = np.json.players || []
      if (others.length > 0) {
        const target = others[Math.floor(Math.random() * others.length)]
        await call('POST', '/api/battle/request-player',
          { attackerId: this.userId, defenderId: target.id, choice: 'battle' })
      }
    } else {
      // 동맹 제안
      const np = await call('GET',
        `/api/guardian/nearby-players?lat=${this.lat}&lng=${this.lng}&radius=500&excludeUserId=${this.userId}`)
      const others = np.json.players || []
      if (others.length > 0) {
        const target = others[Math.floor(Math.random() * others.length)]
        await call('POST', '/api/battle/alliance-request',
          { requesterId: this.userId, targetId: target.id })
      }
    }
  }

  async cleanup() {
    if (this.userId)
      await call('DELETE', `/api/territory/reset/${this.userId}`)
  }
}

// ─── 메인 루프 ─────────────────────────────────────────────
async function main() {
  console.log('[loadtest] phase 1: setup users…')
  const users = Array.from({ length: N }, (_, i) => new SimUser(i))
  await Promise.all(users.map(u => u.setup()))
  const setup = users.filter(u => u.userId).length
  console.log(`[loadtest] setup complete: ${setup}/${N} users`)

  console.log(`[loadtest] phase 2: run for ${DURATION}s…`)
  const t0 = Date.now()
  let ticks = 0
  while ((Date.now() - t0) / 1000 < DURATION) {
    await Promise.all(users.map(u => u.tick()))
    ticks++
    if (ticks % 5 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
      const totalCalls = Object.values(stats).reduce((a, s) => a + s.ok + s.fail, 0)
      console.log(`[loadtest] t=${elapsed}s ticks=${ticks} calls=${totalCalls}`)
    }
  }

  console.log('[loadtest] phase 3: report…\n')
  printReport()

  if (CLEANUP) {
    console.log('\n[loadtest] phase 4: cleanup…')
    await Promise.all(users.map(u => u.cleanup()))
    console.log('[loadtest] cleanup done')
  }
}

function printReport() {
  const rows = Object.entries(stats).map(([ep, s]) => {
    const lats = s.latencies.sort((a, b) => a - b)
    const p = (q) => lats[Math.floor(lats.length * q)] || 0
    return {
      endpoint: ep,
      total: s.ok + s.fail,
      ok: s.ok,
      failPct: ((s.fail / (s.ok + s.fail)) * 100).toFixed(1),
      p50: p(0.5),
      p95: p(0.95),
      p99: p(0.99),
      topErrors: Object.entries(s.errors).sort((a, b) => b[1] - a[1]).slice(0, 3)
    }
  }).sort((a, b) => b.total - a.total)

  console.log('=== ENDPOINT METRICS ===')
  console.log('endpoint'.padEnd(48), 'calls'.padStart(7), 'fail%'.padStart(7), 'p50'.padStart(6), 'p95'.padStart(6), 'p99'.padStart(6))
  for (const r of rows) {
    console.log(
      r.endpoint.padEnd(48),
      String(r.total).padStart(7),
      String(r.failPct).padStart(7),
      String(r.p50).padStart(6) + 'ms',
      String(r.p95).padStart(6) + 'ms',
      String(r.p99).padStart(6) + 'ms'
    )
    for (const [err, count] of r.topErrors) {
      console.log(`    ↳ ${count}× ${err}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
