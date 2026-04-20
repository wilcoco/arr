# Guardian AR - 게임 기획서

## 개요
위치 기반 수호신 전략 게임. 플레이어가 수호신을 생성하고, 실제 위치에서 영역을 점령하며, 다른 플레이어와 전투하거나 동맹을 맺는 전략 게임.

## 기술 스택
- **프론트엔드**: React + Vite + Leaflet + OpenStreetMap
- **백엔드**: Node.js + Express
- **데이터베이스**: PostgreSQL (Railway)
- **상태관리**: Zustand
- **배포**: Railway (서버가 클라이언트 정적 파일 서빙)

## 핵심 시스템

### 1. 수호신 시스템

#### 수호신 타입
| 타입 | 이모지 | 특징 |
|------|--------|------|
| Animal (동물) | 🦁 | 균형형 - ATK 10, DEF 8, HP 100 |
| Robot (로봇) | 🤖 | 방어형 - ATK 15, DEF 15, HP 120 |
| Aircraft (비행체) | ✈️ | 기동형 - ATK 12, DEF 8, HP 80, RNG 20 |

#### 능력치 (Stats)
- **ATK (공격력)**: 전투 시 데미지
- **DEF (방어력)**: 피해 감소
- **HP (체력)**: 생존력
- **ABS (흡수율)**: 승리 시 상대 능력치 흡수 비율
- **PRD (생산력)**: 에너지 생산량
- **SPD (속도)**: 행동 우선권
- **RNG (사거리)**: 영향 범위
- **TER (영역력)**: 영역 확장 효율

#### 파츠 커스터마이징
- 머리/몸통/팔/다리 등 파츠별 커스텀 가능
- 각 파츠가 능력치에 영향

### 2. 영역 시스템

#### 영역 확장
- 현재 위치에서 원형 영역 생성
- 반경 10m ~ 500m 조절 가능
- 영역 확장 시 에너지 소모

#### 고정 수호신 배치
본체 수호신의 능력치를 분배하여 영역에 배치

| 타입 | 아이콘 | 역할 |
|------|--------|------|
| 방어형 | 🛡️ | 영역 방어력 증가 |
| 생산형 | ⚙️ | 에너지 자동 생산 |

- 고정 수호신은 플레이어가 오프라인이어도 맵에 표시
- 배치 시 본체 능력치에서 차감됨

### 3. 전투 시스템

#### 전투 발생 조건
- 다른 플레이어 영역에 진입 시 선택지 제공
  - ⚔️ **전투**: 영역 쟁탈전
  - 🤝 **동맹 제안**: 협력 관계 형성
  - 무시하고 지나가기

#### 전투 계산
```
공격자 전투력 = 본체 ATK × 랜덤(0.8~1.2) × 궁극기보너스
방어자 전투력 = 본체 DEF + 고정수호신 DEF + 동맹고정수호신 DEF × 랜덤(0.8~1.2)
```

#### 전투 결과
**승리 시:**
- 상대 능력치 흡수 (ABS% 비율)
- 영역 획득
- 에너지 +10 약탈

**패배 시:**
- 영역 상실
- 고정 수호신 파괴

#### 전투 연출
- 5단계 애니메이션
- 파워바로 전투력 시각화
- 💥 히트 이펙트
- 공격자/방어자 수호신 표시

### 4. 동맹 시스템

#### 동맹 형성
- 양쪽 모두 "동맹 제안" 선택 시 동맹 체결
- 한쪽이라도 "전투" 선택 시 전투 발생

#### 공동 방어 (2:1 전투)
- 동맹의 인접 영역에 고정 수호신이 있으면 함께 방어
- 방어력 합산: 본인 DEF + 본인 고정수호신 + 동맹 고정수호신
- UI에 "공동방어" 태그 표시

#### 배신
- 언제든 동맹 해제 가능
- 해제 시 공동 방어 비활성화

### 5. 경제 시스템

#### 에너지 화폐
- 생산형 고정 수호신에서 자동 생산
- 전투 승리 시 약탈 (+10)
- 영역 유지에 소모

#### 방어막
- 오프라인 시 일정 시간 방어막 활성화
- 방어막 상태에서는 전투 불가

### 6. 맵 표시

#### 마커 종류
| 마커 | 설명 |
|------|------|
| 🟢 초록 원 | 내 위치 |
| 🦁🤖✈️ (금색) | 내 수호신 |
| 🦁🤖✈️ (빨간) | 다른 플레이어 |
| 🛡️ (파란) | 방어형 고정 수호신 |
| ⚙️ (금색) | 생산형 고정 수호신 |

#### 영역 표시
- 초록 원: 내 영역
- 빨간 원: 다른 플레이어 영역

#### 겹침 방지
- 인접한 마커는 자동으로 옆으로 배열
- 약 15m 간격으로 분산 표시

## 유사 게임 분석

### 경쟁작
1. **Ingress** - 포탈 점령, 팀 대결
2. **Orna: GPS RPG** - 턴제 RPG + 영역 점령
3. **Turf Wars** - 위치 기반 영역 점령
4. **Pokemon Go** - 체육관 시스템

### Guardian AR 차별점
- ✅ 수호신 파츠 커스터마이징
- ✅ 능력치 분배 (본체 → 고정 수호신)
- ✅ 동맹/배신 전략 시스템
- ✅ 공동 방어 (2:1 전투)
- ✅ 능력치 흡수 성장
- ✅ 생산형 vs 방어형 선택

## 데이터베이스 스키마

### users
- id, username, energy_currency
- last_location_lat, last_location_lng
- is_online, shield_until

### guardians
- id, user_id, type, parts(JSON)
- atk, def, hp, abs, prd, spd, rng, ter
- ult_charge

### territories
- id, user_id
- center_lat, center_lng, radius

### fixed_guardians
- id, territory_id, user_id
- position_lat, position_lng
- atk, def, hp, guardian_type

### battles
- id, attacker_id, defender_id, territory_id
- status, attacker_choice, defender_choice
- winner_id, attacker_power, defender_power
- absorbed_stats(JSON)

### alliances
- id, user_id_1, user_id_2
- active, created_at, dissolved_at

## API 엔드포인트

### Guardian
- `POST /api/guardian/create` - 수호신 생성
- `GET /api/guardian/:visitorId` - 수호신 조회
- `POST /api/guardian/location` - 위치 업데이트
- `GET /api/guardian/nearby-players` - 주변 플레이어

### Territory
- `POST /api/territory/expand` - 영역 확장
- `POST /api/territory/place-guardian` - 고정 수호신 배치
- `GET /api/territory/nearby` - 주변 영역
- `GET /api/territory/my/:userId` - 내 영역
- `POST /api/territory/check-intrusion` - 침입 체크
- `GET /api/territory/nearby-fixed-guardians` - 주변 고정 수호신

### Battle
- `POST /api/battle/request` - 전투 요청
- `POST /api/battle/respond` - 전투/동맹 응답
- `POST /api/battle/execute` - 전투 실행
- `POST /api/battle/ultimate` - 궁극기 사용

### Alliance
- `GET /api/alliance/my/:userId` - 동맹 목록
- `POST /api/alliance/betray` - 배신
- `POST /api/alliance/check-joint-defense` - 공동방어 확인

## 향후 개발 계획

### Phase 1 (현재)
- [x] 기본 맵 + 위치 표시
- [x] 수호신 생성
- [x] 영역 확장
- [x] 고정 수호신 배치
- [x] 전투 시스템
- [x] 동맹 시스템
- [x] 전투 애니메이션
- [x] 공동 방어

### Phase 2
- [ ] 궁극기 시스템 완성
- [ ] 에너지 생산 자동화
- [ ] 랭킹 시스템
- [ ] 푸시 알림 (영역 침입)

### Phase 3
- [ ] Unity AR 뷰어 (프리미엄)
- [ ] 3D 수호신 모델
- [ ] AR 전투 연출

## 참고 자료
- [Ingress](https://ingress.com/en)
- [Orna: GPS RPG](https://playorna.com/)
- [Leaflet 문서](https://leafletjs.com/)
- [OpenStreetMap](https://www.openstreetmap.org/)
