import { create } from 'zustand'

export const useGameStore = create((set, get) => ({
  // 유저 정보
  userId: null,
  userLocation: null,

  // 수호신
  guardian: null,

  // 영역
  territories: [],
  expandingTerritory: null,

  // 전투
  currentBattle: null,
  battleModalOpen: false,

  // 동맹
  alliances: [],

  // Actions
  setUserLocation: (location) => set({ userLocation: location }),

  createGuardian: async (type, parts) => {
    const response = await fetch('/api/guardian/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: get().userId,
        type,
        parts
      })
    })
    const data = await response.json()
    if (data.success) {
      set({ guardian: data.guardian })
    }
    return data
  },

  startTerritoryExpand: () => {
    const { userLocation } = get()
    if (!userLocation) return

    set({
      expandingTerritory: {
        center: userLocation,
        radius: 10
      }
    })
  },

  updateTerritoryRadius: (radius) => {
    const { expandingTerritory } = get()
    if (expandingTerritory) {
      set({
        expandingTerritory: { ...expandingTerritory, radius }
      })
    }
  },

  confirmTerritory: async () => {
    const { expandingTerritory, userId } = get()
    if (!expandingTerritory) return

    const response = await fetch('/api/territory/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        lat: expandingTerritory.center.latitude,
        lng: expandingTerritory.center.longitude,
        radius: expandingTerritory.radius
      })
    })
    const data = await response.json()
    if (data.success) {
      set(state => ({
        territories: [...state.territories, { ...data.territory, isOwn: true }],
        expandingTerritory: null
      }))
    }
    return data
  },

  openBattleModal: (battle) => set({
    currentBattle: battle,
    battleModalOpen: true
  }),

  closeBattleModal: () => set({
    battleModalOpen: false
  }),

  respondToBattle: async (choice) => {
    const { currentBattle, userId } = get()
    const response = await fetch('/api/battle/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        battleId: currentBattle.id,
        userId,
        choice
      })
    })
    return response.json()
  },

  useUltimate: async () => {
    const { currentBattle, userId } = get()
    const response = await fetch('/api/battle/ultimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        battleId: currentBattle.id,
        userId
      })
    })
    return response.json()
  }
}))
