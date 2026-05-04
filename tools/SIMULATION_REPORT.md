# Guardian AR — 대규모 사용자 시뮬레이션 보고서

**일자:** 2026-05-04
**방법:** 코드 분석 + 수학적 모델링 (실제 부하 테스트 스크립트 `tools/loadtest.js` 별도)
**시나리오:** N=10 / N=100 / N=1000 동시 활성 사용자

---

## 0. 시뮬레이션 가정

- 평균 사용자당 영역 3개, 반경 100m
- 시뮬 영역: 서울 도심 5×5km (25km²) 기준
- 활동: 위치 갱신 30s/회, 영역 확장 5분/회, 타워 배치 10분/회, 전투 시도 15분/회
- 서버: Railway 단일 인스턴스 + PostgreSQL (인덱스: location, territories.center)
- DB tick: 1시간/회 (영역 유지비, 파츠 드랍, atari 검사)

---

## 1. N=10 (친구·동호회 단위)

### 시뮬 결과
| 항목 | 값 |
|---|---|
| 평균 영역 밀도 | 30개 / 25km² = 1.2개/km² |
| 영역 간 평균 거리 | ~900m |
| 침입 발생 빈도 | 매우 낮음 (1일 1~2회) |
| 동맹 형성 가능성 | 높음 (소수 → 친밀) |
| 서버 RPS | 평균 1.5, 피크 5 |
| DB tick 비용 | 30 territories × O(N²) atari 체크 → ~900 비교 / 1시간 |

### 게임 흐름
- ✅ 영역 확장 거의 막힘 없음
- ✅ 타워 배치 자유로움
- ⚠ **PvP 콘텐츠 부족** — 적 만나기 힘들어 게임 단조로움
- ⚠ **세계 보스만 사실상 PvE 메인** (6h마다 1체 = 하루 4번)
- ❌ 13종 타워 다양성이 무의미 (전투가 거의 없음)

### 발견된 문제
1. **서버 tick 부하 매우 낮음** — 문제 없음
2. **유저 동기 부족** — 누구도 만나지 않음 → 1주일 안에 이탈

---

## 2. N=100 (도시 한 구 단위)

### 시뮬 결과
| 항목 | 값 |
|---|---|
| 평균 영역 밀도 | 300개 / 25km² = 12개/km² |
| 영역 간 평균 거리 | ~290m |
| 영역 확장 성공률 | **~60%** (40%는 overlap 거부) |
| 침입 발생 빈도 | 사용자당 5~10회/일 |
| 동맹 형성 | 활발 (20~30 동맹 동시) |
| 서버 RPS | 평균 15, 피크 50 |
| DB tick 비용 | 300² = 90,000 비교 / 1시간 (formation.js) |
| 전투 발생 | 약 200회/일 |

### 게임 흐름
- ✅ 침입/전투 활발
- ✅ 동맹/배신 메타 작동
- ⚠ **영역 확장 좌절감 시작** — 빈 곳 찾기 어려움
- ⚠ **타워 13종 의미 발현** — 빌드 다양성 보임
- ❌ **DB 부하 증가** — `formation.js` `computeFormation()`이 전체 territory 쌍을 비교 (O(N²))

### 발견된 문제 (코드 단)

#### 2.1 server/src/routes/formation.js — `computeFormation()`
```js
for (let i = 0; i < territories.length; i++) {
  for (let j = i + 1; j < territories.length; j++) {  // O(N²)
    if (!isLinked(a, b)) continue
```
- N=300 → 44,850회 거리 계산
- 60초 캐시 있어 매번은 아니지만 1분 1회는 부담
- **공간 인덱싱 필요** (PostGIS 또는 grid hashing)

#### 2.2 server/src/routes/towers.js — `processTowerSiege()`
```js
for (let i = 0; i < towers.length; i++) {
  for (let j = 0; j < towers.length; j++) {   // O(N²)
```
- 5분 tick. N_towers=900 (영역×3) → 810,000 비교
- 동맹 체크가 inner loop 안에서 friendly() 호출 → 매번 array.some
- **즉시 병목** (10초 이상 소요 추정)

#### 2.3 server/src/routes/territory.js — `/expand` overlap 검사
```sql
WHERE SQRT(POW((center_lat - $1) * 111000, 2) + ...) < (radius + $3)
```
- Full table scan (인덱스 있어도 SQRT 함수에 안 먹힘)
- N=300 영역에선 60ms 정도, 큰 문제 없음 (아직)

---

## 3. N=1000 (도시 전체 / 광역 베타)

### 시뮬 결과
| 항목 | 값 |
|---|---|
| 평균 영역 밀도 | 3000개 / 25km² = 120개/km² |
| 영역 간 평균 거리 | ~90m |
| 영역 확장 성공률 | **~15%** — 거의 다 거부됨 |
| 침입 발생 빈도 | 사용자당 50회/일 |
| 서버 RPS | 평균 150, 피크 500 |
| DB tick 비용 | **터짐** (formation O(N²)=9M 비교, siege O(N²)=81M) |
| 전투 발생 | 5,000회/일 |

### 게임 흐름
- ❌ **신규 유저 진입 불가** — 빈 곳 없어서 영역 못 만듬
- ❌ **공성 tick이 몇 분씩 걸림** — DB 락
- ❌ **atari 검사가 매 tick 실패** — formation 계산 timeout
- ⚠ FCM 푸시 폭주 — 사용자당 시간당 10건 알림

### 치명적 병목
1. **`processTowerSiege` O(N²) 공성 매트릭스** — 90,000개 타워에서 8.1억 비교
2. **`computeFormation` O(N²) 영역 그래프** — 60s 캐시도 갱신 자체가 무거움
3. **`/api/territory/nearby-fixed-guardians` LIMIT 50** — 사용자가 못 보는 타워 다수 (UI 누락)
4. **`activity_events` 무한 누적** — 1000명 × 100 이벤트/일 = 10만 row/일, 청소 로직 없음
5. **atari 24h 자동 점령이 동시다발** — 도미노 점령 (한 타이밍에 수십 개 영역 주인 바뀜)

---

## 4. 식별된 이슈 (분류)

### 🔴 P0 — 스케일 차단 (1000명 부근에서 게임 마비)
| # | 이슈 | 파일 |
|---|---|---|
| P0-1 | `processTowerSiege` O(N²) 매트릭스 | server/src/routes/towers.js:261 |
| P0-2 | `computeFormation` O(N²) 영역 그래프 | server/src/routes/formation.js:49 |
| P0-3 | `/expand` overlap이 SQRT 풀스캔 (인덱스 미활용) | server/src/routes/territory.js:75 |
| P0-4 | `activity_events` 청소 미구현 → 무한 증가 | server/src/index.js |
| P0-5 | atari 동시 점령 도미노 (매 tick 일괄 처리) | server/src/index.js:209 |

### 🟠 P1 — 게임 흐름 문제 (100~1000 사이에서 발현)
| # | 이슈 | 영향 |
|---|---|---|
| P1-1 | 신규 유저 영역 진입 불가 — 빈 곳 없음 | 신규 유입 0 |
| P1-2 | 영역 점령 시 동맹/길드 알림 부재 | 길드원 못 도와줌 |
| P1-3 | 직접 침투(A) 발판 grant 5분이 너무 짧음 | 모바일 전환 타임에 만료 |
| P1-4 | 동맹 무한 — 한 명이 100명과 동맹 가능 | 동맹 인플레, 전투 무력화 |
| P1-5 | 영역 유지비가 너무 약함 (1~30/h, 보유 9999) → 영원히 안 사라짐 | 정체 |
| P1-6 | 시즌 종료 보상 미구현 → 시즌 시스템 무의미 | 진보 의미 X |

### 🟡 P2 — 밸런스 / 익스플로잇
| # | 이슈 | 위험 |
|---|---|---|
| P2-1 | scifi 타워 DPS 7 vs cannon 5 — scifi 가성비 압도 | 메타 단일화 |
| P2-2 | nature 타워 5%/tick HP 회복 — 타워끼리 영원히 안 죽을 수 있음 | DPS 부족 시 무한 lock |
| P2-3 | 발판(slot_grant) 적 영역에 무료 Lv1 → 서로 발판 폭탄 던지기 | 영역 안 발판 도배 |
| P2-4 | 베테랑 → 초심자 공격 차단 = 영구 보호 | 옛 친구 어뷰징 (동급 이상으로 ranking 안 가는데도 안 졸업하면 무적) |
| P2-5 | shield_until 토큰만 있으면 무한 보호 갱신 가능? | 정확한 갱신 룰 검증 필요 |

### 🔵 P3 — UX / 폴리싱
| # | 이슈 |
|---|---|
| P3-1 | AR 야전모드에서 위치 점프 버튼 없음 — 단말기 GPS 의존 |
| P3-2 | 한글 폰트 부재 (Unity AR ASCII 강제) |
| P3-3 | 침입 알림이 진입 1회만 — 다른 영역 다시 들어가도 못 알아챔 (확인 필요) |
| P3-4 | 공성 진척도 시각화는 있지만 푸시는 처음만 |
| P3-5 | 에너지 cap 9999 도달 후 표시 변화 없음 — 자원 의미 약화 |
| P3-6 | 전투 결과 단조로움 — 통계만, 영역 변화 보여주는 cinematic 없음 |

---

## 5. 개선 방향 (우선순위)

### 5.1 즉시 (이번 주)

#### A. 공간 인덱싱 도입 (P0-1, P0-2, P0-3 일괄)
```sql
-- 각 영역에 grid cell 컬럼 추가 (lat/lng를 0.01° = ~1km 격자로)
ALTER TABLE territories ADD COLUMN grid_cell TEXT;
UPDATE territories SET grid_cell = FLOOR(center_lat*100) || ',' || FLOOR(center_lng*100);
CREATE INDEX idx_terr_grid ON territories(grid_cell);
```
- formation.js / siege.js / overlap 모두 같은 grid에 인덱스 활용
- O(N²) → O(N × 9) (9 = 자기 셀 + 8 인접)
- N=1000 → 9000회 비교 (즉시 처리 가능)

#### B. activity_events 자동 정리
```js
// runEconomyTick 내
await db.query(`DELETE FROM activity_events WHERE created_at < NOW() - INTERVAL '7 days'`)
```

#### C. 발판 grant 만료 5분 → 30분
사용자가 단말기 켜고 AR 진입까지 걸림. 30분으로 늘리고 사용 시 30초 grace 추가.

### 5.2 다음 단계 (1~2주)

#### D. 영역 밀도 자동 조절 — Soft expansion
- 도심(밀도 ≥10/km²)에선 50m만 허용, 외곽에선 500m 허용
- "겹침" 거부 대신 "20% 겹쳐도 OK, 단 방어계수 ×0.7" — 신규 유저 진입 가능

#### E. 동맹 한도 + 단계
- 동맹 최대 10명
- 임시(첫 1일, 50% 효율) → 정식(7일 유지, 100%) — V2 기획 부활
- 한 명이 모두와 동맹 = 전투 무력화 방지

#### F. 영역 유지비 곡선 강화
- 100m → 5/h, 200m → 15/h, 500m → 60/h
- PRD 본체 생산 그대로 → 큰 영역은 명백히 적자
- 정체 영역 자연 해체 → 신규 유저 공간

### 5.3 중기 (1~2개월)

#### G. 시즌 종료 보상 + 영역 부분 리셋
- 3개월 시즌 종료 → 상위 10%만 영역 유지, 나머지 50% 축소
- 영구 칭호 + 다음 시즌 시작 보너스

#### H. 타워 13종 밸런스 패스
- scifi DPS 7 → 5.5
- nature 5%/tick → 3%/tick + 동맹 타워만 (자기 자신 X)
- crystal 시너지 +10% → 영역당 1개로 제한

#### I. 침입 알림 재설계
- 영역마다 1회 → 5분마다 1회 (다른 영역 다녀온 후 다시 진입 가능)
- 푸시도 같은 빈도

### 5.4 장기 (분기)

#### J. 본체 수호신 4 타입 도입 (수호신 v2)
- animal/robot/aircraft/production
- 타입별 궁극기 4종
- 메타 다양화

#### K. 길드 전쟁 / 공동 점령
- 길드 단위 영역 점령 ("Citadel" 모드)
- 길드원 동시 침공 시 +30% 데미지 (V2 기획 부활)

#### L. 개체수 증가 대응 — Sharding by region
- 사용자 위치 기반 region 샤딩
- 같은 city 내에서만 매칭 (formation, nearby 검색)

---

## 6. 빠른 의사결정 표 (이번 sprint)

| 작업 | 영향 | 난이도 | 점수 |
|---|---|---|---|
| **A 공간 인덱싱** | 🔴🔴🔴 1000명 가능케 함 | 중 | ★★★★★ |
| **B events 청소** | 🟠 운영 안정성 | 하 | ★★★★ |
| **C grant 30분** | 🟠 UX | 하 | ★★★★ |
| **F 유지비 강화** | 🟠 정체 해소 | 하 | ★★★ |
| **D soft expansion** | 🟠 신규 유입 | 중 | ★★★ |
| **E 동맹 한도** | 🟡 밸런스 | 중 | ★★ |
| H 타워 밸런스 | 🟡 메타 다양성 | 하 | ★★ |
| G 시즌 보상 | 🔵 진보 | 중 | ★ |

**권장 sprint:** A → B → C 우선 (모두 1~2일). 이걸 마치면 N=1000까지 안정.

---

## 7. 부하 테스트 실행 방법

```bash
# 로컬 서버 띄우고
cd server && npm start

# 별 셸에서
node tools/loadtest.js --users=50 --duration=60
node tools/loadtest.js --users=200 --duration=120 --spread=0.05

# Railway에 직접 (운영 데이터 오염 — 끝나면 cleanup이 reset 호출)
API_URL=https://arr-production.up.railway.app node tools/loadtest.js --users=20 --duration=30
```

생성된 사용자는 `loadtest_<timestamp>_<idx>` 형식. 종료 시 자동 cleanup 시도.

---

> 이 문서는 시뮬레이션 가설 + 코드 정적 분석. 실제 부하 테스트 결과는 별도 첨부.
> Live 측정 시 `loadtest.js` 출력 캡처해서 본 문서 §1~3에 비교 데이터 추가할 것.
