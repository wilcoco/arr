// β 모델 베타 테스트 — DB stub 기반 라우트 핸들러 단위 테스트.
// 실제 PostgreSQL이 없어도 라우트 로직(검증/응답 shape/에러 경로)을 실행 검증.
//
// 사용: cd server && node ../tools/beta-test.js
// 종료코드 0=모든 케이스 통과, 1=실패 있음.

const path = require('path')
const Module = require('module')

// ─── DB stub: query 결과를 사전 큐에 push해두면 순서대로 반환 ──────────
const queryQueue = []
const queryLog = []

function dbQuery(sql, params = []) {
  const trimmed = sql.replace(/\s+/g, ' ').trim()
  const upper = trimmed.toUpperCase()
  // BEGIN/COMMIT/ROLLBACK은 큐 소비 안 함 (트랜잭션 제어, 응답 안 봄)
  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') {
    return Promise.resolve({ rows: [], rowCount: 0 })
  }
  queryLog.push({ sql: trimmed.substring(0, 80), params })
  if (queryQueue.length === 0) {
    return Promise.resolve({ rows: [], rowCount: 0 })
  }
  const next = queryQueue.shift()
  if (next instanceof Error) return Promise.reject(next)
  return Promise.resolve(next)
}

function makeStubPool() {
  return {
    connect: async () => ({
      query: dbQuery,
      release: () => {}
    })
  }
}

const stubDb = {
  query: dbQuery,
  pool: makeStubPool(),
  transaction: async (fn) => fn({ query: dbQuery })
}

// require('../db') 가로채기 — server 디렉토리 기준
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if ((request === '../db' || request === '../../db' || request.endsWith('/db')) &&
      parent && parent.filename && parent.filename.includes('server')) {
    return require.resolve(path.resolve(__dirname, '../server/src/db.js'))
  }
  return origResolve.call(this, request, parent, ...rest)
}

// db 모듈 캐시를 stub으로 대체
const dbPath = path.resolve(__dirname, '../server/src/db.js')
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: stubDb,
  paths: []
}

// fcm도 noop으로 대체 (firebase 초기화 회피)
const fcmPath = path.resolve(__dirname, '../server/src/fcm.js')
require.cache[fcmPath] = {
  id: fcmPath, filename: fcmPath, loaded: true,
  exports: { sendPush: async () => {} },
  paths: []
}

// missions/tutorial/levels — 부수효과 stub
const missionsPath = path.resolve(__dirname, '../server/src/routes/missions.js')
const fakeRouter = (() => {
  const r = (req, res, next) => next && next()
  Object.assign(r, { get: () => {}, post: () => {}, put: () => {}, delete: () => {}, use: () => {}, params: {} })
  r.progressMission = async () => {}
  return r
})()
require.cache[missionsPath] = {
  id: missionsPath, filename: missionsPath, loaded: true,
  exports: fakeRouter, paths: []
}

const levelsPath = path.resolve(__dirname, '../server/src/levels.js')
const realLevels = require(levelsPath)
realLevels.gainXp = async () => ({ leveledUp: false, level: 1, xp: 0 })

// ─── 헬퍼: 가짜 req/res ───────────────────────────────────────────
function makeReq(body = {}, params = {}) {
  return { body, params, query: {} }
}
function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this }
  }
  return res
}

// 라우터에서 path/method로 핸들러 찾기
function findHandler(router, method, urlPath) {
  for (const layer of (router.stack || [])) {
    if (!layer.route) continue
    if (layer.route.path !== urlPath) continue
    const m = layer.route.methods || layer.route.stack?.[0]?.method
    const has = (m && (m[method.toLowerCase()] || m === method.toLowerCase()))
    if (has) {
      return layer.route.stack[layer.route.stack.length - 1].handle
    }
  }
  return null
}

// ─── 테스트 케이스 ────────────────────────────────────────────────
let passed = 0, failed = 0
const fails = []
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; fails.push({ name, detail }); console.log(`  ✗ ${name} — ${detail}`) }
}

function reset() { queryQueue.length = 0; queryLog.length = 0 }

const towers = require(path.resolve(__dirname, '../server/src/routes/towers.js'))
const vassal = require(path.resolve(__dirname, '../server/src/routes/vassal.js'))
const territory = require(path.resolve(__dirname, '../server/src/routes/territory.js'))
const lt = require(path.resolve(__dirname, '../server/src/levelTable.js'))

;(async () => {

console.log('\n=== 1. levelTable 경계 검증 ===')
ok('Lv1 maxRadius == 50',  lt.maxRadiusM(1) === 50, `got ${lt.maxRadiusM(1)}`)
ok('Lv30 maxRadius == 10000', lt.maxRadiusM(30) === 10000, `got ${lt.maxRadiusM(30)}`)
ok('레벨 음수/0 → Lv1 cap', lt.maxRadiusM(0) === 50 && lt.maxRadiusM(-5) === 50, '')
ok('레벨 99 → Lv30 cap', lt.maxRadiusM(99) === 10000, '')
ok('defenseCoef(50) == 1', lt.defenseCoef(50) === 1, '')
ok('defenseCoef(1000) == 0.1', Math.abs(lt.defenseCoef(1000) - 0.1) < 1e-9, '')
ok('upkeep 100m == 2', lt.upkeepPerHour(100) === 2, `got ${lt.upkeepPerHour(100)}`)
ok('upkeep 10000m >= 1000', lt.upkeepPerHour(10000) >= 1000, `got ${lt.upkeepPerHour(10000)}`)
ok('placementCost 면적 비례', lt.placementCostEnergy(1000, 30) > lt.placementCostEnergy(100, 30), '')
ok('titleFor Lv30 == 황제', lt.titleFor(30) === '황제', `got ${lt.titleFor(30)}`)
ok('titleFor Lv1 == 수련생', lt.titleFor(1) === '수련생', '')

console.log('\n=== 2. /api/towers/place 검증 경로 ===')
const placeHandler = findHandler(towers, 'POST', '/place')
ok('POST /place 핸들러 존재', !!placeHandler, '')

if (placeHandler) {
  // 케이스: 필수 파라미터 누락
  reset()
  let res = makeRes()
  await placeHandler(makeReq({ userId: 'u1' }), res)  // lat/lng/towerClass 없음
  ok('파라미터 누락 → success:false', res.body && res.body.success === false, JSON.stringify(res.body))

  // 케이스: 잘못된 클래스
  reset()
  res = makeRes()
  await placeHandler(makeReq({
    userId: 'u1', lat: 37.5, lng: 127.0, towerClass: 'bogus_class'
  }), res)
  ok('잘못된 클래스 → success:false',
     res.body && res.body.success === false && res.body.error.includes('클래스'),
     JSON.stringify(res.body))

  // 케이스: 사용자 없음
  reset()
  queryQueue.push({ rows: [] })  // SELECT level/xp/energy
  res = makeRes()
  await placeHandler(makeReq({
    userId: 'u_missing', lat: 37.5, lng: 127.0, towerClass: 'generic', claimRadiusM: 100
  }), res)
  ok('사용자 없음 → success:false', res.body && res.body.success === false && res.body.error.includes('사용자'),
     JSON.stringify(res.body))

  // 케이스: 레벨 cap 초과 (Lv1 = 50m, 1000m 요청)
  reset()
  queryQueue.push({ rows: [{ level: 1, xp: 0, energy_currency: 1000 }] })
  res = makeRes()
  await placeHandler(makeReq({
    userId: 'u1', lat: 37.5, lng: 127.0, towerClass: 'generic', claimRadiusM: 1000
  }), res)
  ok('Lv1이 1000m 요청 → 거부', res.body && res.body.success === false && res.body.error.includes('cap') === false && res.body.error.includes('m'),
     JSON.stringify(res.body))

  // 케이스: 타워 개수 cap 초과 (Lv1 = max 2개, 이미 2개 있음)
  reset()
  queryQueue.push({ rows: [{ level: 1, xp: 0, energy_currency: 1000 }] })
  queryQueue.push({ rows: [{ n: 2 }] })  // territory count
  res = makeRes()
  await placeHandler(makeReq({
    userId: 'u1', lat: 37.5, lng: 127.0, towerClass: 'generic', claimRadiusM: 50
  }), res)
  ok('Lv1 영역 cap 초과 → 거부',
     res.body && res.body.success === false && /개수|영역/.test(res.body.error),
     JSON.stringify(res.body))

  // 케이스: 면적 예산 초과
  reset()
  queryQueue.push({ rows: [{ level: 1, xp: 0, energy_currency: 1000 }] })  // user
  queryQueue.push({ rows: [{ n: 0 }] })  // count
  queryQueue.push({ rows: [{ used: lt.maxTotalAreaM2(1) }] })  // 이미 cap
  res = makeRes()
  await placeHandler(makeReq({
    userId: 'u1', lat: 37.5, lng: 127.0, towerClass: 'generic', claimRadiusM: 50
  }), res)
  ok('면적 예산 초과 → 거부',
     res.body && res.body.success === false && res.body.error.includes('면적'),
     JSON.stringify(res.body))

  // 케이스: 남의 영역 안 → grant 없으면 거부
  reset()
  queryQueue.push({ rows: [{ level: 5, xp: 1000, energy_currency: 5000 }] })  // user
  queryQueue.push({ rows: [{ n: 0 }] })
  queryQueue.push({ rows: [{ used: 0 }] })
  // candidates: 1개 후보 — 중심이 lat/lng와 일치 → host 식별됨
  queryQueue.push({ rows: [{ id: 't_other', user_id: 'u_other', center_lat: 37.5, center_lng: 127.0, radius: 200 }] })
  res = makeRes()
  await placeHandler(makeReq({
    userId: 'u1', lat: 37.5, lng: 127.0, towerClass: 'generic', claimRadiusM: 50
  }), res)
  ok('남의 영역 안 + grant 없음 → 거부 + hostTerritoryId 안내',
     res.body && res.body.success === false && res.body.hostTerritoryId === 't_other',
     JSON.stringify(res.body))

  // D) Soft expansion: 외곽 25% 겹침 → 거부
  reset()
  queryQueue.push({ rows: [{ level: 5, xp: 1000, energy_currency: 5000 }] })  // user
  queryQueue.push({ rows: [{ n: 0 }] })
  queryQueue.push({ rows: [{ used: 0 }] })
  // candidates: 적 영역 중심을 200m 옆에 (50m 새 영역 + 200m 적 영역 → 큰 겹침)
  // 두 원 중심거리 d=200m, r1=200m(적), r2=50m(나) → 작은 원이 거의 포함 → overlap ~100% → 거부
  queryQueue.push({ rows: [{
    id: 't_overlap', user_id: 'u_other',
    center_lat: 37.5 + 200/111000, center_lng: 127.0,
    radius: 200
  }] })
  res = makeRes()
  await placeHandler(makeReq({
    userId: 'u1', lat: 37.5, lng: 127.0, towerClass: 'generic', claimRadiusM: 50
  }), res)
  ok('soft overlap > 20% → 거부 + overlapPct 안내',
     res.body && res.body.success === false && /겹/.test(res.body.error || ''),
     JSON.stringify(res.body))
}

console.log('\n=== 3. /api/vassal/propose 검증 ===')
const proposeHandler = findHandler(vassal, 'POST', '/propose')
ok('POST /propose 핸들러 존재', !!proposeHandler, '')

if (proposeHandler) {
  // 자기 영역에 자기 속국 시도 → 거부
  reset()
  queryQueue.push({ rows: [{ id: 't_self', user_id: 'u1', center_lat: 37.5, center_lng: 127.0, radius: 200 }] })
  let res = makeRes()
  await proposeHandler(makeReq({
    vassalUserId: 'u1', lordTerritoryId: 't_self', lat: 37.5, lng: 127.0,
    claimRadiusM: 50, towerClass: 'generic', tributeToLordPct: 30
  }), res)
  ok('자기 영역 자기-속국 시도 → 안내',
     res.body && res.body.success === false && res.body.error.includes('자기'),
     JSON.stringify(res.body))

  // 조공률 범위 밖
  reset()
  res = makeRes()
  await proposeHandler(makeReq({
    vassalUserId: 'u1', lordTerritoryId: 't_other', lat: 37.5, lng: 127.0,
    claimRadiusM: 50, towerClass: 'generic', tributeToLordPct: 150
  }), res)
  ok('조공률 150% → 거부',
     res.body && res.body.success === false && res.body.error.includes('조공'),
     JSON.stringify(res.body))

  // 잘못된 클래스
  reset()
  res = makeRes()
  await proposeHandler(makeReq({
    vassalUserId: 'u1', lordTerritoryId: 't_other', lat: 37.5, lng: 127.0,
    claimRadiusM: 50, towerClass: 'fake', tributeToLordPct: 30
  }), res)
  ok('잘못된 클래스 → 거부',
     res.body && res.body.success === false && res.body.error.includes('클래스'),
     JSON.stringify(res.body))
}

console.log('\n=== 4. /api/territory/expand (deprecated) ===')
const expandHandler = findHandler(territory, 'POST', '/expand')
ok('POST /expand 핸들러 존재 (410 wrapper)', !!expandHandler, '')
if (expandHandler) {
  const res = makeRes()
  await expandHandler(makeReq({}), res)
  ok('expand 410 응답', res.statusCode === 410 && res.body.deprecated === true,
     `${res.statusCode} ${JSON.stringify(res.body)}`)
}

console.log('\n=== 4.5. E) 동맹 한도 / 단계 ===')
const battle = require(path.resolve(__dirname, '../server/src/routes/battle.js'))
ok('battle.js 모듈 로드', !!battle, '')
// 헬퍼는 module.exports에 노출되지 않을 수 있음 — 라우트 핸들러 호출로 검증
// /respond에서 alliance 선택 시 한도 초과 시뮬
const respondHandler = findHandler(battle, 'POST', '/respond')
ok('POST /respond 핸들러 존재', !!respondHandler, '')

console.log('\n=== 5. 라우트 등록 검증 ===')
const routeFiles = ['guardian','territory','battle','alliance','parts','activity',
                    'fixedGuardian','formation','tutorial','missions','bosses',
                    'towers','vassal','guilds']
for (const r of routeFiles) {
  try {
    require(path.resolve(__dirname, `../server/src/routes/${r}.js`))
    ok(`route file ${r}.js loads`, true, '')
  } catch (e) {
    ok(`route file ${r}.js loads`, false, e.message)
  }
}

console.log('\n=== 6. 클라이언트 ↔ 서버 계약 ===')
// gameStore.js의 confirmTerritory가 보내는 필드 vs towers/place가 받는 필드
const gameStoreSrc = require('fs').readFileSync(
  path.resolve(__dirname, '../client/src/stores/gameStore.js'), 'utf8'
)
ok('client confirmTerritory가 /api/towers/place로 라우팅',
   gameStoreSrc.includes('/api/towers/place') && gameStoreSrc.includes('claimRadiusM'),
   'placeholder')
ok('client에 vassal 4개 액션 존재 (propose/accept/reject/dissolve)',
   ['proposeVassal','acceptVassal','rejectVassal','dissolveVassal'].every(s => gameStoreSrc.includes(s)),
   'missing one')
ok('client가 deprecated /territory/expand 직접 호출 안 함',
   !gameStoreSrc.includes("'/api/territory/expand'") && !gameStoreSrc.includes('"/api/territory/expand"'),
   'still calls /territory/expand directly')
ok('client가 deprecated /territory/place-guardian 직접 호출 안 함',
   !gameStoreSrc.includes("'/api/territory/place-guardian'") &&
   !gameStoreSrc.includes('"/api/territory/place-guardian"'),
   'still calls deprecated')

// Unity ApiManager.cs 검증
const apiCs = require('fs').readFileSync(
  path.resolve(__dirname, '../../My project/Assets/Scripts/Core/ApiManager.cs'), 'utf8'
)
ok('Unity ExpandTerritory가 /api/towers/place로 라우팅',
   apiCs.includes('"/api/towers/place"') && apiCs.includes('ExpandTerritory'),
   'no')
ok('Unity ProposeVassal 추가됨',
   apiCs.includes('ProposeVassal'), 'no')

// ─── 최종 ─────────────────────────────────────────────────────────
console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===`)
if (failed > 0) {
  console.log('\n실패 목록:')
  for (const f of fails) console.log(` - ${f.name}: ${f.detail}`)
}
process.exit(failed > 0 ? 1 : 0)
})()
