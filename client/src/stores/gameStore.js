import { create } from 'zustand'

const API_URL = ''

const getSavedVisitorId = () => localStorage.getItem('visitorId') || null

export const useGameStore = create((set, get) => ({
  // 유저 정보
  visitorId: getSavedVisitorId(),
  userId: null,
  userLocation: null,
  energy: 100,
  layer: 'beginner',
  battleWins: 0,
  graduatedAt: null,

  // AR 모드
  arMode: false,

  // 수호신
  guardian: null,

  // 파츠
  parts: [],

  // 영역
  territories: [],
  nearbyTerritories: [],
  expandingTerritory: null,

  // 주변 플레이어 / 고정 수호신
  nearbyPlayers: [],
  nearbyFixedGuardians: [],

  // 전투
  currentBattle: null,
  battleModalOpen: false,
  lastIntrudedTerritoryId: null,

  // 동맹
  alliances: [],

  // 리더보드
  leaderboard: [],

  // 알림 토스트
  toast: null,

  // 로딩/에러
  loading: false,
  error: null,

  // ─── 기본 액션 ────────────────────────────────────────────────
  setVisitorId: (id) => {
    localStorage.setItem('visitorId', id)
    set({ visitorId: id })
  },

  setUserLocation: (location) => set({ userLocation: location }),

  setArMode: (val) => set({ arMode: val }),

  leaderboardMode: 'area',
  leaderboardSeason: null,
  setLeaderboardMode: (mode) => set({ leaderboardMode: mode }),

  showToast: (message, type = 'info') => {
    set({ toast: { message, type } })
    setTimeout(() => set({ toast: null }), 4000)
  },

  // ─── 초기 데이터 로드 ─────────────────────────────────────────
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
          energy: data.energy,
          layer: data.layer || 'beginner',
          battleWins: data.battleWins || 0,
          graduatedAt: data.graduatedAt || null
        })

        if (data.userId) {
          const terrRes = await fetch(`${API_URL}/api/territory/my/${data.userId}`)
          const terrData = await terrRes.json()
          set({ territories: terrData.territories?.map(t => ({ ...t, isOwn: true })) || [] })

          get().fetchParts()
          get().fetchOfflineSummary()
          get().fetchStorageSummary()
        }
      }
    } catch (err) {
      console.error('Load user data error:', err)
    }
  },

  // ─── 오프라인 요약 (마지막 접속 이후 활동) ────────────────────
  fetchOfflineSummary: async () => {
    const { userId, showToast } = get()
    if (!userId) return
    try {
      const res = await fetch(`${API_URL}/api/activity/summary/${userId}`)
      const data = await res.json()
      if (!data.success || !data.hasContent) return

      const s = data.summary
      const parts = []
      if (s.partsCount > 0) parts.push(`파츠 ${s.partsCount}개 획득`)
      if (s.attackedCount > 0) parts.push(`공격받음 ${s.attackedCount}회 (승 ${s.attackedWon} / 패 ${s.attackedLost})`)
      if (s.defeated) parts.push('수호신 사망 — 영역 취약 상태')
      if (s.vulnerableCount > 0) parts.push(`취약 영역 ${s.vulnerableCount}개`)
      if (s.currentRank) parts.push(`현재 ${s.currentRank}위`)

      showToast(`📬 돌아오신 것을 환영합니다!\n${parts.join(' · ')}`, 'info')
    } catch (err) {
      console.error('Offline summary error:', err)
    }
  },

  // ─── 전투 프리뷰 (실제 전투 전 예상) ──────────────────────────
  fetchBattlePreview: async (defenderId, territoryId = null) => {
    const { userId, arMode, guardian } = get()
    if (!userId) return null
    try {
      const ultActivated = (guardian?.stats?.ult_charge || 0) >= 100
      const res = await fetch(`${API_URL}/api/battle/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attackerId: userId, defenderId, territoryId, arMode, ultActivated: false })
      })
      const data = await res.json()
      return data.success ? data : null
    } catch (err) {
      console.error('Battle preview error:', err)
      return null
    }
  },

  // ─── 수호신 생성 ──────────────────────────────────────────────
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
        set({ guardian: data.guardian, userId: data.userId, loading: false })
      } else {
        set({ error: data.error, loading: false })
      }
      return data
    } catch (err) {
      set({ error: err.message, loading: false })
      return { success: false, error: err.message }
    }
  },

  // ─── 위치 업데이트 ────────────────────────────────────────────
  updateLocation: async (lat, lng) => {
    const { visitorId } = get()
    try {
      await fetch(`${API_URL}/api/guardian/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, lat, lng })
      })

      const { userId } = get()
      if (userId) {
        const [terrRes, playersRes, fixedRes, intrusionRes] = await Promise.all([
          fetch(`${API_URL}/api/territory/nearby?lat=${lat}&lng=${lng}&radius=1000&excludeUserId=${userId}`),
          fetch(`${API_URL}/api/guardian/nearby-players?lat=${lat}&lng=${lng}&radius=1000&excludeUserId=${userId}`),
          fetch(`${API_URL}/api/territory/nearby-fixed-guardians?lat=${lat}&lng=${lng}&radius=1000&excludeUserId=${userId}`),
          fetch(`${API_URL}/api/territory/check-intrusion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, lat, lng })
          })
        ])

        const [terrData, playersData, fixedData, intrusionData] = await Promise.all([
          terrRes.json(), playersRes.json(), fixedRes.json(), intrusionRes.json()
        ])

        set({
          nearbyTerritories: terrData.territories || [],
          nearbyPlayers: playersData.players || [],
          nearbyFixedGuardians: fixedData.fixedGuardians || []
        })

        const { lastIntrudedTerritoryId } = get()
        if (intrusionData.intruded) {
          if (intrusionData.territory.id !== lastIntrudedTerritoryId) {
            set({
              currentBattle: { status: 'intrusion_detected', territory: intrusionData.territory },
              battleModalOpen: true,
              lastIntrudedTerritoryId: intrusionData.territory.id
            })
          }
        } else {
          if (lastIntrudedTerritoryId) set({ lastIntrudedTerritoryId: null })
        }
      }
    } catch (err) {
      console.error('Update location error:', err)
    }
  },

  // ─── 영역 관리 ────────────────────────────────────────────────
  startTerritoryExpand: () => {
    const { userLocation } = get()
    if (!userLocation) return
    set({ expandingTerritory: { center: userLocation, radius: 50 } })
  },

  updateTerritoryRadius: (radius) => {
    const { expandingTerritory } = get()
    if (expandingTerritory) set({ expandingTerritory: { ...expandingTerritory, radius } })
  },

  confirmTerritory: async (towerType = 'normal') => {
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
          radius: expandingTerritory.radius,
          towerType
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

  placeFixedGuardian: async (territoryId, lat, lng, stats, guardianType) => {
    const { userId } = get()
    if (!userId) return { success: false, error: '로그인 필요' }

    try {
      const res = await fetch(`${API_URL}/api/territory/place-guardian`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ territoryId, userId, lat, lng, stats, guardianType })
      })
      const data = await res.json()

      if (data.success) {
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
        get().loadUserData()
      }
      return data
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  // ─── 진영(formation) 상태 — 바둑 시각화용 ──────────────────
  formationData: null, // { territories, links, synergyByUser, eyeIds, atariCount }
  fetchFormation: async () => {
    try {
      const res = await fetch(`${API_URL}/api/formation/state`)
      const data = await res.json()
      if (data.success) set({ formationData: data })
    } catch (err) { console.error('Fetch formation error:', err) }
  },

  // ─── 고정 수호신 저장소 (생산 누적/수령) ─────────────────────
  fixedGuardianStorage: [], // [{id, territoryId, center, capacity, storedCount, isFull}]
  fetchStorageSummary: async () => {
    const { userId } = get()
    if (!userId) return
    try {
      const res = await fetch(`${API_URL}/api/fixed-guardian/my/${userId}/storage-summary`)
      const data = await res.json()
      if (data.success) set({ fixedGuardianStorage: data.guardians || [] })
    } catch (err) {
      console.error('Fetch storage summary error:', err)
    }
  },
  collectFromGuardian: async (fgId) => {
    const { userId, userLocation, showToast } = get()
    if (!userId || !userLocation) {
      showToast('위치 정보 필요', 'error')
      return { success: false }
    }
    try {
      const res = await fetch(`${API_URL}/api/fixed-guardian/${fgId}/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, lat: userLocation.latitude, lng: userLocation.longitude })
      })
      const data = await res.json()
      if (data.success) {
        const c = data.collected || {}
        const parts = []
        if (c.parts > 0)   parts.push(`파츠 ${c.parts}개`)
        if (c.energy > 0)  parts.push(`에너지 ${c.energy}`)
        if (c.revenue > 0) parts.push(`수익 ${c.revenue}`)
        showToast(parts.length ? `📦 수령: ${parts.join(', ')}` : '저장소가 비어있습니다', 'success')
        get().fetchParts()
        get().loadUserData()
        get().fetchStorageSummary()
      } else {
        showToast(data.error || '수령 실패', 'error')
      }
      return data
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  // ─── 파츠 관리 ────────────────────────────────────────────────
  fetchParts: async () => {
    const { userId } = get()
    if (!userId) return
    try {
      const res = await fetch(`${API_URL}/api/parts/my/${userId}`)
      const data = await res.json()
      set({ parts: data.parts || [] })
    } catch (err) {
      console.error('Fetch parts error:', err)
    }
  },

  equipPart: async (partId) => {
    const { userId } = get()
    try {
      const res = await fetch(`${API_URL}/api/parts/equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, partId })
      })
      const data = await res.json()
      if (data.success) { get().fetchParts(); get().loadUserData() }
      return data
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  unequipPart: async (partId) => {
    const { userId } = get()
    try {
      const res = await fetch(`${API_URL}/api/parts/unequip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, partId })
      })
      const data = await res.json()
      if (data.success) { get().fetchParts(); get().loadUserData() }
      return data
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  combineParts: async (partIds) => {
    const { userId } = get()
    try {
      const res = await fetch(`${API_URL}/api/parts/combine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, partIds })
      })
      const data = await res.json()
      if (data.success) get().fetchParts()
      return data
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  // ─── 리더보드 ─────────────────────────────────────────────────
  // mode: 'area' (면적) | 'current' (시즌 승) | 'all-time' (누적 승)
  fetchLeaderboard: async (mode) => {
    try {
      const m = mode || get().leaderboardMode || 'area'
      const res = await fetch(`${API_URL}/api/territory/leaderboard?season=${m}`)
      const data = await res.json()
      set({
        leaderboard: data.leaderboard || [],
        leaderboardMode: m,
        leaderboardSeason: data.season || null
      })
    } catch (err) {
      console.error('Fetch leaderboard error:', err)
    }
  },

  // ─── 전투 모달 ────────────────────────────────────────────────
  openBattleModal: (battle) => set({ currentBattle: battle, battleModalOpen: true }),
  closeBattleModal: () => set({ battleModalOpen: false, currentBattle: null }),

  initiatePlayerEncounter: (player) => set({
    currentBattle: { status: 'player_encounter', targetPlayer: player },
    battleModalOpen: true
  }),

  initiateFixedGuardianAttack: (fixedGuardian) => set({
    currentBattle: { status: 'fixed_guardian_attack', targetFixedGuardian: fixedGuardian },
    battleModalOpen: true
  }),

  // 전투 결과 처리 공통 함수
  _handleBattleResult: (execData, prevBattle) => {
    set({
      currentBattle: { ...prevBattle, status: 'animating', result: execData }
    })
    setTimeout(() => {
      set({ currentBattle: { ...prevBattle, status: 'completed', result: execData } })
      get().loadUserData()

      if (execData.graduated) {
        get().showToast('베테랑으로 승격되었습니다!', 'success')
      }
      if (execData.defenderDied) {
        get().showToast('상대방이 격파되었습니다! 초심자 레이어로 강등됩니다.', 'info')
      }
    }, 4000)
  },

  // ─── 전투/동맹 선택 ───────────────────────────────────────────
  respondToBattle: async (choice, ultActivated = false) => {
    const { currentBattle, userId, arMode } = get()
    if (!currentBattle) return

    try {
      // 플레이어 직접 조우
      if (currentBattle.status === 'player_encounter') {
        const reqRes = await fetch(`${API_URL}/api/battle/request-player`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attackerId: userId, defenderId: currentBattle.targetPlayer.id, choice })
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

        const execRes = await fetch(`${API_URL}/api/battle/execute-player`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ battleId: reqData.battleId, arMode, ultActivated })
        })
        const execData = await execRes.json()
        get()._handleBattleResult(execData, currentBattle)
        return execData
      }

      // 고정 수호신 공격
      if (currentBattle.status === 'fixed_guardian_attack') {
        const res = await fetch(`${API_URL}/api/battle/attack-fixed-guardian`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attackerId: userId, fixedGuardianId: currentBattle.targetFixedGuardian.id, arMode, ultActivated })
        })
        const data = await res.json()

        if (!data.success) {
          alert(data.error || '공격 실패')
          set({ battleModalOpen: false, currentBattle: null })
          return data
        }

        get()._handleBattleResult(data, currentBattle)
        const { userLocation } = get()
        if (userLocation) get().updateLocation(userLocation.latitude, userLocation.longitude)
        return data
      }

      // 영역 침입
      if (currentBattle.status === 'intrusion_detected') {
        if (choice === 'attack') {
          const res = await fetch(`${API_URL}/api/battle/attack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attackerId: userId,
              defenderId: currentBattle.territory.userId,
              territoryId: currentBattle.territory.id,
              arMode,
              ultActivated
            })
          })
          const data = await res.json()

          if (!data.success) {
            alert(data.error || '공격 실패')
            set({ battleModalOpen: false, currentBattle: null })
            return data
          }

          get()._handleBattleResult(data, currentBattle)
          return data
        }

        if (choice === 'alliance') {
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
          if (!reqData.success) { set({ error: reqData.error }); return reqData }

          const res = await fetch(`${API_URL}/api/battle/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ battleId: reqData.battleId, odingerId: userId, choice })
          })
          const data = await res.json()

          if (data.result === 'alliance') {
            alert('동맹이 체결되었습니다!')
            set({ battleModalOpen: false, currentBattle: null })
          }
          return data
        }
      }
    } catch (err) {
      console.error('Respond to battle error:', err)
      set({ error: err.message })
      return { success: false, error: err.message }
    }
  },

  // ─── 동맹 ─────────────────────────────────────────────────────
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

  betrayAlliance: async (allianceId) => {
    const { visitorId } = get()
    try {
      const res = await fetch(`${API_URL}/api/alliance/betray`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allianceId, visitorId })
      })
      const data = await res.json()
      if (data.success) get().loadAlliances()
      return data
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  // 궁극기 (레거시 - 직접 발동)
  useUltimate: async () => {
    const { currentBattle, visitorId } = get()
    try {
      const res = await fetch(`${API_URL}/api/battle/ultimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, battleId: currentBattle?.id })
      })
      return res.json()
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}))
