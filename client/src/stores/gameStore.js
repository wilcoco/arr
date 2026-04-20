import { create } from 'zustand'

// 같은 도메인에서 서빙되므로 빈 문자열 사용
const API_URL = ''

// localStorage에서 visitorId 불러오기
const getSavedVisitorId = () => {
  return localStorage.getItem('visitorId') || null
}

export const useGameStore = create((set, get) => ({
  // 유저 정보
  visitorId: getSavedVisitorId(),
  userId: null,
  userLocation: null,
  energy: 100,

  // 수호신
  guardian: null,

  // 영역
  territories: [],
  nearbyTerritories: [],
  expandingTerritory: null,

  // 주변 플레이어
  nearbyPlayers: [],

  // 주변 고정 수호신
  nearbyFixedGuardians: [],

  // 전투
  currentBattle: null,
  battleModalOpen: false,
  lastIntrudedTerritoryId: null,

  // 동맹
  alliances: [],

  // 로딩/에러
  loading: false,
  error: null,

  // Actions
  setVisitorId: (id) => {
    localStorage.setItem('visitorId', id)
    set({ visitorId: id })
  },

  setUserLocation: (location) => set({ userLocation: location }),

  // 초기 데이터 로드
  loadUserData: async () => {
    const { visitorId } = get()
    if (!visitorId) return

    try {
      const res = await fetch(`${API_URL}/api/guardian/${visitorId}`)
      const data = await res.json()

      if (data.guardian) {
        set({
          guardian: data.guardian,
          userId: data.userId,
          energy: data.energy
        })

        // 영역도 로드
        if (data.userId) {
          const terrRes = await fetch(`${API_URL}/api/territory/my/${data.userId}`)
          const terrData = await terrRes.json()
          set({
            territories: terrData.territories?.map(t => ({ ...t, isOwn: true })) || []
          })
        }
      }
    } catch (err) {
      console.error('Load user data error:', err)
    }
  },

  // 수호신 생성
  createGuardian: async (type, parts) => {
    const { visitorId } = get()
    set({ loading: true, error: null })

    try {
      const res = await fetch(`${API_URL}/api/guardian/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, type, parts })
      })

      const data = await res.json()

      if (data.success) {
        set({
          guardian: data.guardian,
          userId: data.userId,
          loading: false
        })
      } else {
        set({ error: data.error, loading: false })
      }

      return data
    } catch (err) {
      set({ error: err.message, loading: false })
      return { success: false, error: err.message }
    }
  },

  // 위치 업데이트 (서버에 전송)
  updateLocation: async (lat, lng) => {
    const { visitorId } = get()
    try {
      await fetch(`${API_URL}/api/guardian/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, lat, lng })
      })

      // 주변 영역 및 플레이어 조회
      const { userId } = get()
      if (userId) {
        // 주변 영역 조회
        const terrRes = await fetch(
          `${API_URL}/api/territory/nearby?lat=${lat}&lng=${lng}&radius=1000&excludeUserId=${userId}`
        )
        const terrData = await terrRes.json()
        set({ nearbyTerritories: terrData.territories || [] })

        // 주변 플레이어 조회
        const playersRes = await fetch(
          `${API_URL}/api/guardian/nearby-players?lat=${lat}&lng=${lng}&radius=1000&excludeUserId=${userId}`
        )
        const playersData = await playersRes.json()
        set({ nearbyPlayers: playersData.players || [] })

        // 주변 고정 수호신 조회
        const fixedRes = await fetch(
          `${API_URL}/api/territory/nearby-fixed-guardians?lat=${lat}&lng=${lng}&radius=1000&excludeUserId=${userId}`
        )
        const fixedData = await fixedRes.json()
        set({ nearbyFixedGuardians: fixedData.fixedGuardians || [] })

        // 침입 체크
        const intrusionRes = await fetch(`${API_URL}/api/territory/check-intrusion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, lat, lng })
        })
        const intrusionData = await intrusionRes.json()

        const { lastIntrudedTerritoryId } = get()

        if (intrusionData.intruded) {
          // 새로운 영역 침입일 때만 알림 (한 번만)
          if (intrusionData.territory.id !== lastIntrudedTerritoryId) {
            set({
              currentBattle: {
                status: 'intrusion_detected',
                territory: intrusionData.territory
              },
              battleModalOpen: true,
              lastIntrudedTerritoryId: intrusionData.territory.id
            })
          }
        } else {
          // 영역 벗어나면 초기화
          if (lastIntrudedTerritoryId) {
            set({ lastIntrudedTerritoryId: null })
          }
        }
      }
    } catch (err) {
      console.error('Update location error:', err)
    }
  },

  // 영역 확장 시작
  startTerritoryExpand: () => {
    const { userLocation } = get()
    if (!userLocation) return

    set({
      expandingTerritory: {
        center: userLocation,
        radius: 50
      }
    })
  },

  // 영역 반경 업데이트
  updateTerritoryRadius: (radius) => {
    const { expandingTerritory } = get()
    if (expandingTerritory) {
      set({
        expandingTerritory: { ...expandingTerritory, radius }
      })
    }
  },

  // 영역 확정
  confirmTerritory: async () => {
    const { expandingTerritory, userId } = get()
    if (!expandingTerritory || !userId) return

    set({ loading: true })

    try {
      const res = await fetch(`${API_URL}/api/territory/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          lat: expandingTerritory.center.latitude,
          lng: expandingTerritory.center.longitude,
          radius: expandingTerritory.radius
        })
      })

      const data = await res.json()

      if (data.success) {
        set(state => ({
          territories: [...state.territories, { ...data.territory, isOwn: true }],
          expandingTerritory: null,
          loading: false
        }))
        return data
      } else {
        set({ error: data.error, loading: false })
      }

      return data
    } catch (err) {
      set({ error: err.message, loading: false })
      return { success: false, error: err.message }
    }
  },

  // 고정 수호신 배치
  placeFixedGuardian: async (territoryId, lat, lng, stats, guardianType) => {
    const { userId } = get()
    if (!userId) return { success: false, error: '로그인 필요' }

    try {
      const res = await fetch(`${API_URL}/api/territory/place-guardian`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          territoryId,
          userId,
          lat,
          lng,
          stats,
          guardianType
        })
      })

      const data = await res.json()

      if (data.success) {
        // 본체 수호신 능력치 업데이트
        set(state => ({
          guardian: state.guardian ? {
            ...state.guardian,
            stats: {
              ...state.guardian.stats,
              atk: state.guardian.stats.atk - stats.atk,
              def: state.guardian.stats.def - stats.def,
              hp: state.guardian.stats.hp - stats.hp
            }
          } : null
        }))

        // 데이터 새로고침
        get().loadUserData()
      }

      return data
    } catch (err) {
      console.error('Place fixed guardian error:', err)
      return { success: false, error: err.message }
    }
  },

  // 전투 모달
  openBattleModal: (battle) => set({
    currentBattle: battle,
    battleModalOpen: true
  }),

  closeBattleModal: () => set({
    battleModalOpen: false,
    currentBattle: null
  }),

  // 플레이어 직접 전투/협력 요청
  initiatePlayerEncounter: (player) => {
    set({
      currentBattle: {
        status: 'player_encounter',
        targetPlayer: player
      },
      battleModalOpen: true
    })
  },

  // 고정 수호신 직접 공격
  initiateFixedGuardianAttack: (fixedGuardian) => {
    set({
      currentBattle: {
        status: 'fixed_guardian_attack',
        targetFixedGuardian: fixedGuardian
      },
      battleModalOpen: true
    })
  },

  // 전투/동맹 선택
  respondToBattle: async (choice) => {
    const { currentBattle, userId } = get()
    if (!currentBattle) return

    try {
      // 플레이어 직접 조우
      if (currentBattle.status === 'player_encounter') {
        const targetPlayer = currentBattle.targetPlayer

        const reqRes = await fetch(`${API_URL}/api/battle/request-player`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attackerId: userId,
            defenderId: targetPlayer.id,
            choice
          })
        })

        const reqData = await reqRes.json()

        if (!reqData.success) {
          alert(reqData.error || '요청 실패')
          set({ battleModalOpen: false, currentBattle: null })
          return reqData
        }

        if (choice === 'alliance') {
          alert('동맹 제안을 보냈습니다!')
          set({ battleModalOpen: false, currentBattle: null })
          return reqData
        }

        // 전투 실행
        const execRes = await fetch(`${API_URL}/api/battle/execute-player`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ battleId: reqData.battleId })
        })

        const execData = await execRes.json()

        set({
          currentBattle: {
            ...currentBattle,
            status: 'animating',
            result: execData
          }
        })

        setTimeout(() => {
          set({
            currentBattle: { ...currentBattle, status: 'completed', result: execData }
          })
          get().loadUserData()
        }, 4000)

        return execData
      }

      // 고정 수호신 직접 공격
      if (currentBattle.status === 'fixed_guardian_attack') {
        const targetFG = currentBattle.targetFixedGuardian

        const res = await fetch(`${API_URL}/api/battle/attack-fixed-guardian`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attackerId: userId,
            fixedGuardianId: targetFG.id
          })
        })

        const data = await res.json()

        if (!data.success) {
          alert(data.error || '공격 실패')
          set({ battleModalOpen: false, currentBattle: null })
          return data
        }

        set({
          currentBattle: {
            ...currentBattle,
            status: 'animating',
            result: data
          }
        })

        setTimeout(() => {
          set({
            currentBattle: { ...currentBattle, status: 'completed', result: data }
          })
          get().loadUserData()
          // 주변 정보 새로고침
          const { userLocation } = get()
          if (userLocation) {
            get().updateLocation(userLocation.latitude, userLocation.longitude)
          }
        }, 4000)

        return data
      }

      // 영역 침입 (기존 로직)
      if (currentBattle.status === 'intrusion_detected') {
        const reqRes = await fetch(`${API_URL}/api/battle/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attackerId: userId,
            defenderId: currentBattle.territory.userId,
            territoryId: currentBattle.territory.id
          })
        })

        const reqData = await reqRes.json()

        if (!reqData.success) {
          set({ error: reqData.error })
          return reqData
        }

        // 선택 응답
        const res = await fetch(`${API_URL}/api/battle/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            battleId: reqData.battleId,
            odingerId: userId,
            choice
          })
        })

        const data = await res.json()

        if (data.result === 'alliance') {
          alert('동맹이 체결되었습니다!')
          set({ battleModalOpen: false, currentBattle: null })
        } else if (data.result === 'battle') {
          // 전투 실행
          const execRes = await fetch(`${API_URL}/api/battle/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ battleId: data.battleId })
          })

          const execData = await execRes.json()

          // 먼저 애니메이션 상태로 설정
          set({
            currentBattle: {
              ...currentBattle,
              status: 'animating',
              result: execData
            }
          })

          // 애니메이션 후 완료 상태로 변경 (BattleModal에서 처리)
          setTimeout(() => {
            set({
              currentBattle: {
                ...currentBattle,
                status: 'completed',
                result: execData
              }
            })
            // 데이터 새로고침
            get().loadUserData()
          }, 4000)
        }

        return data
      }
    } catch (err) {
      console.error('Respond to battle error:', err)
      set({ error: err.message })
      return { success: false, error: err.message }
    }
  },

  // 궁극기 사용
  useUltimate: async () => {
    const { currentBattle, visitorId } = get()

    try {
      const res = await fetch(`${API_URL}/api/battle/ultimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId,
          battleId: currentBattle?.id
        })
      })

      return res.json()
    } catch (err) {
      console.error('Ultimate error:', err)
      return { success: false, error: err.message }
    }
  },

  // 동맹 목록 로드
  loadAlliances: async () => {
    const { userId } = get()
    if (!userId) return

    try {
      const res = await fetch(`${API_URL}/api/alliance/my/${userId}`)
      const data = await res.json()
      set({ alliances: data.alliances || [] })
    } catch (err) {
      console.error('Load alliances error:', err)
    }
  },

  // 배신
  betrayAlliance: async (allianceId) => {
    const { visitorId } = get()

    try {
      const res = await fetch(`${API_URL}/api/alliance/betray`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allianceId, visitorId })
      })

      const data = await res.json()

      if (data.success) {
        get().loadAlliances()
      }

      return data
    } catch (err) {
      console.error('Betray error:', err)
      return { success: false, error: err.message }
    }
  }
}))
