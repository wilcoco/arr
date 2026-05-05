# Guardian AR — 통합 기획서 (Living Document)

**버전:** 4.0 | **최종 갱신:** 2026-05-05 | **상태:** β 모델 + 동맹 단계 동기화 완료

> 이 문서는 **단일 진실 공급원(SSOT)**. 모든 기획 변경은 여기에 즉시 반영하고 하단 **변경 이력**에 한 줄 추가한다. 옛 v1/v2/v3는 폐기됨.

---

## 0. 핵심 컨셉 (3 줄)

1. 플레이어는 **모바일 수호신** 1체와 함께 움직인다 (위치 기반)
2. 1 영역 = 1 타워 (β 모델). 13종 타워를 5티어까지 키워 위치를 점유한다
3. 적 영역 점령은 **두 가지 경로**로만 가능 — 직접 침투(Solo Infiltration) 또는 공성(Tower Siege)

---

## 1. 두 가지 정복 경로 (★ 핵심 차별화)

게임의 모든 PvP는 둘 중 하나로 분류된다.

### 경로 A — 직접 침투 (Solo Infiltration)
> "혼자 들어가서 타워와 1:1로 붙어 그 자리를 빼앗는다"

| 단계 | 행동 | 결과 |
|------|------|------|
| 1 | 적 영역 진입 (사거리 내) | 영역 내 타워 자동 발사 (`processTowerDamage`) |
| 2 | 플레이어가 타워 클릭 → "도전" | **본체 ATK vs 타워 DEF/HP** 1:1 전투 |
| 3-A | 타워 1개 격파 | 해당 타워 삭제, 그 자리에 **30분 무료 건설권**(`slot_grants`) |
| 3-B | 영역 모든 타워 격파 | 6h grace 푸시 → 미재건 시 영역 자동 점령 |
| 패배 | 본체 HP 차감, 5분 쿨다운 | 영역 24h vulnerable 진입 (사망 시) |

**특징**
- 빠르고 위험 — 단독 진입, 본체 HP 소모, 즉시 결과
- 보상 — 격파 즉시 storage 약탈 + 발판(slot_grant) 30분 무료 건설
- AR 보너스 — 실제 위치 50m 내에서 공격 시 ATK ×1.20

### 경로 B — 공성전 (Tower Siege)
> "옆에 타워를 박고 멀리서 두들겨 깬다"

| 단계 | 행동 | 결과 |
|------|------|------|
| 1 | 적 영역 인근 사거리 안에 자기 영역+타워 건설 | 사거리 닿는 타워끼리 자동 교전 |
| 2 | 5분 tick (`processTowerSiege`) | 양방향 데미지, 본체 무관 |
| 3 | 적 타워 모두 HP 0 | `siege_breached_at` 설정, 6h grace |
| 4 | grace 만료 + 미재건 | `siege_last_attacker`에게 영역 자동 점령 (+150 XP) |

**특징**
- 느리고 안전 — 본체 노출 없이 비동기, 오프라인에서도 진행
- 사거리 메타 — 발리스타(150m)·SF(130m)가 핵심 어택커
- 자원 부담 — 인접 영역 확장 + 다수 타워 건설 비용
- 카운터 — 방어자가 grace 6시간 안에 타워 1개 재건 시 점령 무효

### 경로 비교 매트릭스

| 차원 | 직접 침투 (A) | 공성전 (B) |
|------|---------------|------------|
| 주체 | 본체 수호신 | 자기 타워 |
| 시간 | 즉시 (분) | 비동기 (시간~일) |
| 위험 | 본체 HP / 사망 | 자기 타워 손실 |
| 자원 | AR 이동 | 영역+타워 건설비 |
| 보상 | 발판 + 약탈 | 영역 통째 |
| 적합 | 가까운 약한 타워 | 멀고 두꺼운 영역 |
| 멀티 | 1명만 가능 | 동맹·길드 합류 가능 |

> **설계 원칙:** 둘은 **상호 대체가 아니라 보완**. 같은 영역도 상황에 따라 어느 쪽이 효율적인지 다르다.

---

## 2. 유닛 구조

### 2.1 모바일 수호신 (본체) — 1차 출시는 단일 타입

플레이어 1명 = 본체 1체. 위치 = 플레이어 GPS 좌표.

**기본 스탯 (Lv1)** ATK 10 / DEF 10 / HP 100 / ABS 10% / SPD 10 / RNG 10
**스탯 캡** ATK 500 / DEF 500 / HP 2000 / ABS 80%

**역할**
- 직접 침투(A)의 유일한 공격자
- 영역 확장·타워 건설 트리거 (현재 위치 기준)
- 사망 시(HP 0): HP 50 복구, 모든 영역 24h vulnerable, `veteran→beginner` 강등

### 2.2 고정 수호탑 (β 모델: 1 영역 = 1 타워, 13종 × 5티어)

**β 모델 핵심:** territories와 fixed_guardians가 1:1. 타워를 세우는 것이 곧 영역을 만드는 것.
영역 cap은 레벨로 제한 (구 "영역당 3개 타워" 폐기).

#### 13 클래스 매트릭스

| 카테고리 | 클래스 | 사거리 | 연사 | DPS(L1) | HP | 특수효과 | 비용 |
|---|---|---|---|---|---|---|---|
| **DPS — 단일** | 발리스타 | 150 | 4s | 4.5 | 50 | 첫 발 +50% | 50 |
| | SF | 130 | 5s | 7.0 | 50 | 관통 +30% | 75 |
| | 돌격 | 70 | 1s | 6.0 | 60 | 연사 우위 | 50 |
| **AOE / DOT** | 대포 | 100 | 7s | 5.0 | 80 | 30m 폭발 | 70 |
| | 화염 | 60 | 2s | 4.0 | 50 | 5초 화상 +50% | 55 |
| | 독 | 65 | 3s | 1.7 | 50 | 누적 독 +70% | 55 |
| **CC** | 얼음 | 80 | 3s | 2.0 | 50 | 적 영역 vuln 10s | 60 |
| | 아쿠아 | 90 | 3s | 4.0 | 60 | 적 영역 vuln 5분 | 60 |
| | 전기 | 75 | 4s | 3.5 | 50 | 체인 +50% | 65 |
| **유틸 / 비전투** | 자연 | 50 | — | — | 60 | 인접 우호 +5%/tick 회복 | 50 |
| | 비전 | 100 | 6s | 3.7 | 50 | 적 합성률 디버프 | 70 |
| | 크리스탈 | 40 | — | — | 80 | 동맹 시너지 +10% | 80 |
| **시작용** | 제네릭 | 80 | 3s | 3.3 | 50 | 없음 | 30 |

#### 클래스 해금 (레벨 게이팅)

신규 유저의 클래스 마비 방지.

| Lv | 해금 | 누적 |
|---|---|---|
| 1 | generic | 1종 |
| 3 | balista, assault | 3 |
| 5 | cannon, fire | 5 |
| 8 | ice, aqua, venom | 8 |
| 12 | electric, scifi | 10 |
| 16 | nature, arcane, crystal | 13 |

#### 레벨 스케일 (Lv1 → Lv5 타워 티어)

```
DMG  ×(1 + 0.45 × (L-1))     L5 = ×2.80
HP   ×(1 + 0.55 × (L-1))     L5 = ×3.20
RNG  ×(1 + 0.10 × (L-1))     L5 = ×1.40
연사  ×max(0.6, 1 - 0.08(L-1))  L5 = ×0.68
비용  ×1.4^(L-1)              L5 = ×3.84
```

#### 빌드 가이드 (권장 조합)

| 빌드 | 조합 | 컨셉 |
|---|---|---|
| 공격 거점 | 발리스타 + SF + 자연 | 장거리 정밀 + 인접 회복 |
| 요새 | 돌격×2 + 자연 | 연사 + 회복 |
| CC 함정 | 아쿠아 + 얼음 + 대포 | 묶고 광역 폭발 |
| 시너지 허브 | 크리스탈 + 자연 + 비전 | 동맹 부스트 / 적 디버프 |

> 영역 = 타워 1개라서 위 조합은 인접 영역들 사이에서 형성됨.

#### Storage (생산 누적)
타워마다 cap=5 (+ 레벨 보너스). 영역 파츠 드랍은 타워 storage에 누적, 격파 시 약탈됨.

---

## 3. 영역 시스템 (β 모델)

### 3.1 레벨별 영역 cap

`server/src/levelTable.js` 단일 진실 공급원. 레벨에 따른 cap.

| Lv | 칭호 | 단일 영역 최대 반경 | 영역 개수 cap | 면적 예산 (m²) |
|---|---|---|---|---|
| 1 | 수련생 | 50m | 2 | π·50² × 1 |
| 3 | 견습 | ~85m | 5 | 1배 |
| 5 | 영주 | ~140m | 7 | 1배 |
| 8 | 백작 | ~280m | 12 | 2배 |
| 10 | (백작) | ~390m | 16 | 2배 |
| 12 | 후작 | ~530m | 22 | 3배 |
| 16 | 공작 | ~1100m | 33 | 4배 |
| 20 | 왕 | ~2150m | 41 | 4배 |
| 25 | 대왕 | ~4730m | 57 | 5배 |
| 30 | 황제 | 10000m | 76 | 6배 |

**공식 요약:**
- `maxRadiusM(lv)`: `50m × (10000/50)^((lv-1)/29)` 기하 보간
- `maxTowerCount(lv)`: `0.05L² + L + 1`
- `maxTotalAreaM2(lv)`: `π·maxR² × ceil(lv/5)` (레벨 5단마다 1배씩 증가)

### 3.2 비용 / 유지비 / 방어계수

```
placementCost(r, classCost) = classCost + 30·√r
upkeep(r) = max(1, round(2 · (r/100)^1.5))    [에너지/시간]
defenseCoef(r) = min(1.0, 100/r)
```

| 반경 | placement | upkeep/h | defenseCoef |
|---|---|---|---|
| 50m | 30√50 ≈ 212 | 1 | 1.00 |
| 100m | 30√100 = 300 | 2 | 1.00 |
| 200m | 30√200 ≈ 424 | 6 | 0.50 |
| 500m | 30√500 ≈ 671 | 22 | 0.20 |
| 1km | 948 | 63 | 0.10 |
| 5km | 2121 | 707 | 0.02 |
| 10km (Lv30) | 3000 | 2000 | 0.01 |

> 이전 면적비례(`r²`)는 Lv30 황제 영역 비용 314k로 cap 9999 데드락 → `30√r`로 완화.
> 큰 영역의 부담은 유지비(`r^1.5`)가 담당.

### 3.3 Soft Expansion (20% 겹침 허용)

신규 진입성 확보. `towers.js /place` 외곽 겹침 검사:
- 새 영역의 host 없는 경우(중심이 빈 곳), 적 영역과 원-원 교차 면적 비율 계산
- **20% 초과 → 거부** (`overlapPct` 응답)
- **0~20% → 허용 + `territories.defense_penalty=0.7`** (영구)
- 자기 영역끼리 겹침은 제약 없음

`defense_penalty`는 해당 영역의 모든 타워 발사 데미지에 ×0.7 적용 (`processTowerDamage` + `processTowerSiege`).

### 3.4 자원 고갈 / 소멸

```
energy = 0       → warning_at 시작
warning + 12h   → weakened_at (방어 -50%, [TODO] 효과)
warning + 48h   → 영역 + 타워 자동 삭제
energy 회복     → 경고 자동 해제
```

영역 마커: 정상(녹/적), warning(노랑+굵은선), weakened(빨강+점선).

### 3.5 취약 (Vulnerable)

`vulnerable_until` 활성 시 — 방어 ×0.7, 공격 ×1.2.
- 본체 사망 → 모든 영역 24h
- 아쿠아 타워 피격 → 5분 / 얼음 → 10초 / 비전 → 1분

### 3.6 진형 (바둑식)

**Atari (단수)** — 적 영역이 ≥3개 우호 영역으로 둘러싸임
- 매 tick +5 데미지 누적
- 24h 후 첫 공격자에게 자동 점령 (+100 XP, 어시스트 +30)

**Eye (눈)** — 같은 사용자 영역 ≥3개로 둘러싸이고 적 인접 0
- `in_eye_zone=true` (보호 표시)

**시너지** — 우호 연결 1개당 +5%, 캡 +30% (동맹 stage weight 적용 — §6 참조)
**분산 패널티** — 고정 타워 N개 → ×1/√N (레벨 freeSlot으로 면제)

### 3.7 속국 (Vassal) — 영역 안 영역

`/api/vassal/propose` 흐름:
1. **Vassal**(을)이 lord territory 내부 좌표/반경/타워 클래스 + **조공률**(0~100%) 제안
2. **Lord**(주)가 accept → 서버가 atomic으로 vassal의 territory + tower 생성, 계약 active
3. Lord가 reject → status='rejected'

**조공 (`vassal_contracts`)**:
- 매 economy tick (1h), vassal의 본체 PRD × 0.5 × tribute_pct% 만큼 lord에게 이전
- `tribute_total` 누적 컬럼 — UI에서 양측 누적량 표시
- 조공률 가이드 컬러 (<20% 거절↑, 20~40% 표준, 40~60% 후함, >60% 매우 후함)

**자기-속국**: 자기 영역 안에 자기 작은 타워는 계약 불필요. `/api/towers/place`가 자동 처리 (`parent_territory_id` 자동 설정).

---

## 4. 자원 / 진행

### 4.1 단일 자원 — 에너지 💎

`users.energy_currency`. cap = `5000 + lv × 1000` (Lv1=6000, Lv30=35000).

| 획득 | 양 |
|---|---|
| 본체 PRD × 0.5 | 시간당 |
| 영역당 (반경별) | 1 / 3 / 8 / tick |
| 속국 조공 | tribute_pct% × vassal PRD × 0.5 |
| 미션 보상 | 20~80 |

| 소모 | 양 |
|---|---|
| 영역 + 타워 배치 | 30√r + classCost |
| 영역 유지 | 2(r/100)^1.5 /h |
| 타워 업그레이드 | ×1.4^(L-1) |

### 4.2 레벨 (1~30) + 칭호

XP geometric. 레벨업 시:
- 영역 cap, 타워 개수 cap, 면적 예산 증가
- 클래스 추가 해금 (1/3/5/8/12/16)
- 칭호: 수련생→견습→영주→백작→후작→공작→왕→대왕→**황제**

**XP 획득**
- 전투승 +50, atari 점령 +100, 공성 점령 +150
- 보스 처치 누적 데미지 비례 (총 500)
- 미션 50~150
- 타워 배치 +20

### 4.3 파츠 (장착)

- **슬롯** head / body / arms / legs / core
- **티어** 1~2 (반경별 차등)
- **드랍** 영역 tick마다 8~15%
  - 타워 있음 → storage 누적 (storage cap=5)
  - storage full → 드랍 정지
- `stat_bonuses` + `passives` (regenerate 등)

### 4.4 궁극기

- `ult_charge` cap 100, 매 tick +5 자연 충전
- 충전: 전투참여 +25, 패배 +15
- 효과: ATK ×1.5 (현재 단일 — 타입별 분화는 추후)

---

## 5. 전투 공식

### 본체 vs 타워 (경로 A) / 본체 vs 본체

```
atkPower = ATK × rand(0.8~1.2)
        × (arMode? ×1.20 : 1)
        × (ult? ×1.5 : 1)
        × vuln.atk(×1.2 if vulnerable)

defPower = (DEF + Σ타워DEF + Σ동맹DEF×efficiency) × defenseCoef(r) × territory.defense_penalty
        × rand(0.8~1.2)
        × vuln.def(×0.7 if vulnerable)
```

### 타워 vs 타워 (경로 B)

```
사거리 안 + 쿨다운(fireRateMs) 경과 → DMG × territory.defense_penalty 발사
HP 0 → destroyed_at, 영역 모든 타워 0 → siege_breached_at + 6h grace
grace 만료 + 타워 0 → siege_last_attacker가 영역 점령
```

> **공간 인덱싱 (2026-05-05)**: `processTowerSiege`/`processTowerDamage`/inside-check/Nature heal 모두 box prefilter (`BETWEEN`) + grid_cell generated 컬럼으로 idx_territories_lat/lng 활용. O(N²) → O(N×9). N=1000 가능.

### 결과 처리

- **승리** — ABS%만큼 ATK/DEF/HP 흡수, 영역 점령 + 모든 타워 삭제, 에너지 +10/-10, battle_wins +1, XP +50
- **사망 (HP≤0)** — HP 50 복구, 모든 영역 24h vulnerable, veteran→beginner 강등
- **쿨다운** — 5분 (`last_battle_at`)

### 보호 / 차단

- **레이어** veteran(승5+영역3) → beginner 공격 차단
- **방어막** `shield_until` 활성 시 공격 거부
- **배신 차단** `betrayal_blocked_until` 24h

---

## 6. 동맹 / 길드 / 속국

### 6.1 동맹 (1:1) — 한도 + 단계

**한도:** 한 사람당 active 동맹 최대 **10명** (`battle.js tryCreateAlliance`).

**단계 (E 시스템, 2026-05-05):**

| 단계 | 효율 | 기간 | 다음 |
|---|---|---|---|
| **temporary** | 50% | 24h | economy tick에서 자동 → permanent |
| **permanent** | 100% | 7일 | economy tick에서 자동 → dissolve |

- 신규 가입은 항상 `stage='temporary'` 24h로 시작 — 가짜 동맹 인플레 방지
- 임시 단계는 synergy/joint-defense 효율 50% (formation `buildAllianceMap` weight=0.5)
- 정식 승격 후 7일 자동 해제 — 정체 동맹 해소
- 요청 5분 타임아웃, 양방향 합의

**공동 방어** — 인접 영역(0.005°) 동맹 타워 DEF가 방어풀에 합산 × efficiency
**배신** — 24h 동맹 차단 (`betrayal_blocked_until`)

### 6.2 길드 (다대다)
- 최대 10명, 채팅, `shared_energy`
- 같은 길드 ↔ 우호 (타워 비공격, 공성 면제)

### 6.3 속국 (위계 동맹) — §3.7 참조

---

## 7. PvE — 월드 보스

3종 (`guardian_titan`/`rogue_swarm`/`ancient_sentinel`), HP 3000~8000.
6시간마다 활성 사용자 ±500m 자동 스폰. 100m 이내 공격 가능. 누적 데미지 비례 XP 분배 (총 500).

---

## 8. 콘텐츠 루프

### 일일 미션 (3개/일)
풀: `win_battles_3 / expand_2 / combine_1 / collect_storage / visit_3_locations / attack_enemy / place_fixed / fight_boss / daily_login`
보상: XP 25~150, 에너지 20~80

### 신규 유저 NPC
첫 영역 생성 시 200m 떨어진 곳에 `NPC_<id>` 사용자 + 영역 + Lv1 타워 자동 spawn (`spawnStarterNpc`).
N=10 환경에서도 PvP 콘텐츠 보장.

### 튜토리얼 (8단계, β 모델 정합)
- create_guardian → first_tower → first_battle → vassal_explore → ...
- 각 단계 보상 XP/에너지

### 시즌
- `battle_wins_season` 누적
- 리더보드: area / current / all-time
- **[TODO]** 시즌 종료 보상, 영역 일부 리셋

---

## 9. UX / 알림

### 마커 (2D 맵)
| 마커 | 의미 | 액션 |
|---|---|---|
| 🟢 | 내 위치 | — |
| 본체 SVG (금) | 내 본체 | — |
| 본체 SVG (빨강) | 적 본체 | 전투/동맹 |
| 타워 SVG | 우호/적 타워 | 공격(경로 A) |
| 보스 | 월드 보스 | 공격 |

### 영역 색
- 정상: 녹색(내) / 파랑(동맹) / 빨강(적)
- warning_at: 노랑+굵은선
- weakened_at: 빨강+점선
- soft overlap (defense_penalty=0.7): 표시 [TODO]

### TerritoryControls UI
- 방어계수 5단계 게이지 (1.0 / 0.5 / 0.25 / 0.13 / 0.10)
- 시간당 수지 (생산 - 유지비), 적자면 빨강+경고
- 건설 비용 명시
- VassalPanel 조공률 슬라이더 + 권장 컬러

### FCM 푸시
전투 결과, 동맹 요청/수락/거절, atari 시작, 타워 격파, 공성 breach, 영역 함락, 보스 출현, 속국 제안

---

## 10. AR 모드 — 두 트랙

### 10.1 Unity AR (앱 안)
- 실제 위치에 자기 타워 3D 모델 표시 (Piloto Studio 13×5=65 프리팹)
- AR 활성 + 직접 침투(A) → ATK ×1.20
- Unity ↔ Web 양방향 메시지 (PLAYER_ENCOUNTER, FIXED_GUARDIAN_ATTACK)
- AR 타워 배치: ARFixedGuardianPlacer가 `/api/towers/place` 호출
  - 발판(slot grant) 모드: `StartFootholdPlacement(grant)` — Lv1 고정, 무료
- TMP 한글 폰트 부재 → ASCII fallback

### 10.2 야전 모드 (Field Mode, 웹)
> Unity가 없는 웹 브라우저용 대체

- **카메라 배경:** `getUserMedia({ facingMode: 'environment' })`
- **컴패스 화살표:** 디바이스 방향 기반, 가장 가까운 위협 가리킴
- **HUD:** 위협 카드, 위협 리스트, 발판 리스트, 액션 바
- **AR 내 타워 배치:** TowerPlacementModal 인라인 (z-index 6000)
- **보너스:** AR 활성 동안 ATK ×1.20
- **카메라 권한 거부 시:** 검은 그라디언트 + HUD만

---

## 11. 인프라 / 성능

### 11.1 공간 인덱싱 (2026-05-05)

JS 측:
- `server/src/spatialGrid.js` — uniform grid (cellSize 사용자 지정), `forEachPair` / `neighbors` 순회
- `processTowerSiege` (cellSize=MAX_TOWER_RANGE_M 250m), `computeFormation` (cellSize=maxRadius×LINK_DISTANCE_MULT×2) 사용

DB 측 — `boxParams(lat, lng, radiusM)` 헬퍼:
- `BETWEEN` prefilter로 idx_territories_lat / idx_territories_lng 활용
- 적용 위치: `/place` inside check (10km box), `processTowerDamage` (1km), `/territory/check-intrusion` (10km), `/territory/debug/nearby-all` (1.5km), `/towers/my-sieges` (MAX_TOWER_RANGE), Nature heal (50m), boss spawn 푸시 / nearby (1km)

`territories.grid_cell` — `FLOOR(lat*100)||','||FLOOR(lng*100)` generated stored 컬럼 + idx_territories_grid (클러스터/통계용).

### 11.2 자동 정리

- `activity_events` 7일 초과 매 economy tick (1h) DELETE
- 만료 battles/alliance_requests 1분마다 expired 마킹

### 11.3 부하 시뮬 (`tools/SIMULATION_REPORT.md`, N=10/100/1000)

| N | PvP 빈도 | 영역 확장 성공률 | 결론 |
|---|---|---|---|
| 10 | 1~2/일 (NPC 보강) | 자유 | 친구·동호회 |
| 100 | 5~10/일 | ~60% | 스윗 스팟 |
| 1000 | 50/일 | 15% (soft expansion 도입 후 ~30%↑) | 도시 광역 |

---

## 12. 구현 상태 (2026-05-05)

### ✅ 구현 완료
- β 모델 (1 영역 = 1 타워), 레벨 1~30 cap 시스템
- 13종 타워 × 5 티어, 클래스 레벨 해금, storage 누적
- 두 정복 경로 (A 직접침투 + B 공성), 발판 30분 무료 건설
- 영역 확장/유지/소멸 (warning/weakened), 취약, atari/eye 진형
- **Soft expansion 20% 겹침** + defense_penalty 데미지 약화
- 속국(Vassal) 시스템 — 제안/수락/조공/dissolve
- **동맹 한도 10명 + 임시(24h) → 정식(7d) 단계**
- 길드, FCM 푸시, 일일 미션, 월드 보스, 시즌 리더보드
- AR 모드 (Unity + 야전 웹) 자기 타워 표시
- NPC 봇 자동 spawn (신규 유저 PvP 보장)
- 튜토리얼 8단계 β 모델 정합
- TerritoryControls 방어 게이지 + 수지 + 비용 표시
- VassalPanel 조공률 슬라이더 가이드
- 영역 마커 warning/weakened 색상
- 공간 인덱싱 (box prefilter + grid_cell)
- activity_events 7일 자동 정리

### 🚧 부분 / 폴리싱
- 궁극기 (단일 효과만 — 타입 미분화)
- 시즌 종료 보상 (테이블만)
- 약화(weakened) 단계 효과 (컬럼만)
- soft overlap 영역 시각 표시 (defense_penalty 표시)

### 📋 다음 우선순위
1. 시즌 종료 보상 + 영역 부분 리셋
2. 타워 밸런스 패스 (scifi DPS 7→5.5, nature 5%→3%, crystal 영역당 1개 제한)
3. 침입 알림 5분마다 재발생 (현재 영역당 1회)
4. AR 야전모드 위치 점프 버튼
5. 발판 정책 정밀화 (영역 점령/격파 시 처리, 발판 수 제한)
6. 궁극기 타입별 분화 (현재 단일)

### ❌ 폐기 (V1/V2/V3에서 제거)
- 코어🔮 / 결정편✨ 자원 분리 → 에너지 단일화
- ~~동맹 단일 등급~~ → V4에서 부활: 임시(50%, 24h) / 정식(100%, 7일)
- 영역당 3개 타워 분배 → β 모델 1:1로 단순화
- 정찰형 고정 수호신 → 타워 13종으로 충분
- 본체 분배(50% 회수손실) → 타워 비용 모델로 대체
- 휴면 자동 영역 축소(30d/90d) → 유지비 + warning_at 시스템으로 대체

### 🔮 추후 (수호신 확장 시)
- 본체 타입 4종 (animal/robot/aircraft/production)
- 타입별 궁극기 4종
- 본체 파츠 머리/몸통/팔/다리 시각 변경
- AR 본체 3D

---

## 13. 핵심 파일 빠른 참조

| 영역 | 파일 |
|---|---|
| 레벨 cap / 면적 / 비용 / 클래스 해금 | `server/src/levelTable.js` |
| 타워 클래스 + place + siege + damage | `server/src/routes/towers.js` |
| 영역 조회 / 침입 / 손실 | `server/src/routes/territory.js` |
| 본체 전투 + 동맹 INSERT 헬퍼 | `server/src/routes/battle.js` |
| 동맹 my / 배신 / 공동방어 | `server/src/routes/alliance.js` |
| 진형(formation) + 시너지 weight | `server/src/routes/formation.js` |
| 속국 propose/accept/dissolve | `server/src/routes/vassal.js` |
| 길드 | `server/src/routes/guilds.js` |
| 보스 spawn + 공격 | `server/src/routes/bosses.js` |
| 튜토리얼 | `server/src/routes/tutorial.js` |
| 일일 미션 | `server/src/routes/missions.js` |
| 본체 + 위치 + offline 요약 | `server/src/routes/guardian.js` |
| 공간 인덱싱 헬퍼 | `server/src/spatialGrid.js` |
| economy tick (1h) | `server/src/index.js` runEconomyTick |
| siege tick (5분) | `server/src/index.js` setInterval |
| 마이그레이션 (단일 SoT) | `server/src/migrate.js` |
| 클라이언트 전역 상태 | `client/src/stores/gameStore.js` |
| 메인 맵 + 마커 | `client/src/App.jsx` |
| 영역 컨트롤 | `client/src/components/TerritoryControls.jsx` |
| 베타 테스트 (DB stub, 48 케이스) | `tools/beta-test.js` |
| 부하 테스트 + 시뮬 보고서 | `tools/loadtest.js` + `tools/SIMULATION_REPORT.md` |

---

## 14. 변경 이력

| 일자 | 변경 |
|---|---|
| 2026-05-03 | V3 통합 기획서 신설. 두 정복 경로(A 직접침투 / B 공성)를 핵심 축으로 명문화 |
| 2026-05-03 | 우선순위 1~4: BattleModal Path Choice, slot_grants 5분 발판, 적 타워 HP 바, 4종 빌드 프리셋 |
| 2026-05-03 | 야전 모드(웹 AR 대체) 신설 |
| 2026-05-03~04 | AR 타워 배치 마이그레이션, Setup AR Tower Picker UI 자동 생성, TMP 한글 fallback |
| 2026-05-04 | 디버그 위치 점프 버튼 |
| 2026-05-04 | **β 모델 도입** — 1 tower = 1 territory + 레벨 기반 영역 cap + 속국 계약 |
| 2026-05-04 | npm audit 10개 취약점(critical 4) 전부 해결, package-lock.json 트래킹 |
| 2026-05-04 | β 모델 클라이언트 — `/api/towers/place` 라우팅 + VassalPanel |
| 2026-05-04 | 베타 테스트 도구(`tools/beta-test.js`, DB stub 45 케이스) + 부하 시뮬 보고서 |
| 2026-05-05 | P0/P1/P2 UX 일괄 개선 — placement 30√r, 에너지 cap 5000+lv*1000, 클래스 Lv 해금, NPC starter, 조공률 가이드, 방어 게이지, 시간당 수지, vassal tribute_total, 영역 마커 색상 |
| 2026-05-05 | 발판 grant 5분 → 30분 (모바일 전환 시간 여유) |
| 2026-05-05 | **공간 인덱싱** — boxParams 헬퍼 + 모든 SQRT 쿼리에 BETWEEN prefilter, generated grid_cell 컬럼 + 단일 인덱스 (P0-1/2/3 스케일 차단 해소) |
| 2026-05-05 | **Soft expansion 20% 겹침** — host 없을 때 원-원 교차 면적 비율, 20% 초과 거부, 0~20% 허용+defense_penalty=0.7 영구 (P1-1 신규 진입성) |
| 2026-05-05 | **동맹 한도 10명 + 임시/정식 단계** — temporary 24h(50% 효율) → permanent 7일(100%) → dissolve. tryCreateAlliance 헬퍼, formation weight 가중 합산, alliance/my efficiency 노출 (P1-4 동맹 인플레 차단) |
| 2026-05-05 | activity_events 7일 자동 정리 economy tick에 통합 |

---

> **편집 규칙**
> - 본문 변경 시 즉시 반영, **변경 이력**에 한 줄 추가 (일자 + 한 줄 요약)
> - "구현 상태" 섹션은 코드 변경마다 갱신
> - 폐기된 기획은 지우지 말고 "❌ 폐기"로 표시 — 결정 근거 보존
> - 이 문서가 코드와 어긋나면 **코드를 우선** 신뢰하고 문서를 갱신
