// β 모델 — 레벨에 따른 영역 cap, 면적 예산, 방어계수, 유지비 (코드 상수, 튜닝은 여기 한 곳에서)
// 모든 함수는 순수(pure)로 유지. DB 접근 없음. 변경 시 서버 재시작만 필요.

const MAX_LEVEL = 30
const MIN_RADIUS_M = 50
const ABS_MAX_RADIUS_M = 10000   // Lv30 황제 = 서울 광역

function clampLevel(level) {
  const lv = parseInt(level) || 1
  return Math.max(1, Math.min(MAX_LEVEL, lv))
}

// 단일 영역 최대 반경 — 기하 보간 (50m → 10000m 사이 부드럽게)
function maxRadiusM(level) {
  const lv = clampLevel(level)
  const t = (lv - 1) / (MAX_LEVEL - 1)
  return Math.round(MIN_RADIUS_M * Math.pow(ABS_MAX_RADIUS_M / MIN_RADIUS_M, t))
}

// 총 점유 면적 예산 (m²) — 단일 max 영역의 N배. N = ceil(level/5).
//   Lv1~5: 1배 (단일 max 사이즈 1개 = 모두 소진)
//   Lv6~10: 2배
//   Lv26~30: 6배
function maxTotalAreaM2(level) {
  const lv = clampLevel(level)
  const oneCircle = Math.PI * Math.pow(maxRadiusM(lv), 2)
  const multiplier = Math.max(1, Math.ceil(lv / 5))
  return oneCircle * multiplier
}

// 최대 영역(=타워) 개수 — 0.05L² + L + 1
//   L1=2, L5=7, L10=16, L20=41, L30=76
function maxTowerCount(level) {
  const lv = clampLevel(level)
  return Math.floor(0.05 * lv * lv + lv + 1)
}

// 방어계수 — min(1.0, 100/r) (사용자 추천)
//   100m=1.0, 500m=0.20, 1km=0.10, 5km=0.02, 10km=0.01
function defenseCoef(radiusM) {
  const r = parseFloat(radiusM) || 0
  if (r <= 100) return 1.0
  return Math.min(1.0, 100 / r)
}

// 영역 유지비 (에너지/시간) — 면적 가파른 곡선
//   100m → 2/h, 300m → 10/h, 1km → 63/h, 3km → 329/h, 10km → 2000/h
function upkeepPerHour(radiusM) {
  const r = Math.max(1, parseFloat(radiusM) || 0)
  return Math.max(1, Math.round(2 * Math.pow(r / 100, 1.5)))
}

// 타워 배치 비용 (에너지) — 클래스 비용 + 면적 비용
//   100m=클래스+31, 500m=+785, 1km=+3141, 10km=+314159 (Lv30이 ABS 영역 잡으려면 30만 에너지)
function placementCostEnergy(radiusM, towerClassCost) {
  const r = Math.max(MIN_RADIUS_M, parseFloat(radiusM) || MIN_RADIUS_M)
  const area = Math.PI * r * r
  const areaCost = Math.round(area / 1000)
  return Math.max(1, (parseInt(towerClassCost) || 0) + areaCost)
}

const TITLES = [
  [1, '수련생'], [3, '견습'], [5, '영주'], [8, '백작'],
  [12, '후작'], [16, '공작'], [20, '왕'], [25, '대왕'], [30, '황제']
]
function titleFor(level) {
  const lv = clampLevel(level)
  let t = '수련생'
  for (const [threshold, title] of TITLES) {
    if (lv >= threshold) t = title
  }
  return t
}

function levelInfo(level) {
  const lv = clampLevel(level)
  return {
    level: lv,
    title: titleFor(lv),
    maxRadiusM: maxRadiusM(lv),
    maxTotalAreaM2: Math.round(maxTotalAreaM2(lv)),
    maxTowerCount: maxTowerCount(lv)
  }
}

module.exports = {
  MAX_LEVEL, MIN_RADIUS_M, ABS_MAX_RADIUS_M,
  clampLevel, maxRadiusM, maxTotalAreaM2, maxTowerCount,
  defenseCoef, upkeepPerHour, placementCostEnergy,
  titleFor, levelInfo
}
