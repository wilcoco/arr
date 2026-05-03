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
  level: { level: 1, xp: 0, currentLevelXp: 0, nextLevelXp: 100, progressPct: 0, freeSlots: 1, statBonus: 1.0, isMaxLevel: false },
  graduatedAt: null,

  // AR 모드
  arMode: false,

  // 수호신
  guardian: null,

  // 파츠
  parts: [],

  // 영역
  territories: [],
  myFixedGuardians: [], // 내가 소유한 타워들
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
          level: data.level || get().level,
          graduatedAt: data.graduatedAt || null
        })

        if (data.userId) {
          const terrRes = await fetch(`${API_URL}/api/territory/my/${data.userId}`)
          const terrData = await terrRes.json()
          set({
            territories: terrData.territories?.map(t => ({ ...t, isOwn: true })) || [],
            myFixedGuardians: terrData.fixedGuardians || []
          })

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
    const { visitorId, showToast } = get()
    try {
      const locRes = await fetch(`${API_URL}/api/guardian/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, lat, lng })
      })
      const locData = await locRes.json()
      // 타워 공격받음 알림
      if (locData?.towerStrikes?.length > 0) {
        const total = locData.totalTowerDamage
        const towerNames = locData.towerStrikes.map(s => `${s.icon}T${s.tier}`).join(' ')
        showToast(`💥 타워 공격! -${total} HP (${towerNames})`, 'error')
        get().loadUserData()
      }

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
    const { expandingTerritory, userId, userLocation, showToast } = get()
    if (!expandingTerritory) { showToast('확장 모드가 아닙니다', 'error'); return }
    if (!userId) { showToast('로그인 정보 없음 — 새로고침 후 재시도', 'error'); return }
    if (!userLocation) { showToast('위치 정보 없음 — GPS 권한 확인', 'error'); return }
    set({ loading: true })
    showToast('🏗 확장 시도 중...', 'info')

    // 항상 현재 userLocation 기준 — 텔레포트 후 옛 좌표로 가는 것 방지
    const lat = userLocation?.latitude ?? expandingTerritory.center.latitude
    const lng = userLocation?.longitude ?? expandingTerritory.center.longitude

    try {
      const res = await fetch(`${API_URL}/api/territory/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, lat, lng,
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
        showToast(`✅ 영역 확장 완료 (${data.territory?.radius || ''}m)`, 'success')
        return data
      } else {
        set({ error: data.error, loading: false })
        showToast(`❌ ${data.error || '확장 실패'}`, 'error')
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

  // 일일 미션
  missions: [],
  fetchMissions: async () => {
    const { userId } = get()
    if (!userId) return
    try {
      const r = await fetch(`${API_URL}/api/missions/today/${userId}`)
      const d = await r.json()
      if (d.success) set({ missions: d.missions || [] })
    } catch (e) { console.error('missions fetch', e) }
  },
  claimMission: async (missionId) => {
    const { userId, showToast } = get()
    try {
      const r = await fetch(`${API_URL}/api/missions/claim`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, missionId })
      })
      const d = await r.json()
      if (d.success) {
        showToast(`🎁 보상: +${d.reward.xp} XP, +${d.reward.energy} 에너지`, 'success')
        get().fetchMissions(); get().loadUserData()
      } else showToast(d.error || '보상 수령 실패', 'error')
      return d
    } catch (e) { return { success: false, error: e.message } }
  },

  // 월드 보스
  worldBosses: [],
  fetchWorldBosses: async () => {
    const { userLocation } = get()
    if (!userLocation) return
    try {
      const r = await fetch(`${API_URL}/api/bosses/nearby?lat=${userLocation.latitude}&lng=${userLocation.longitude}`)
      const d = await r.json()
      set({ worldBosses: d.bosses || [] })
    } catch (e) { console.error('bosses fetch', e) }
  },
  attackBoss: async (bossId) => {
    const { userId, userLocation, showToast } = get()
    if (!userId || !userLocation) return
    try {
      const r = await fetch(`${API_URL}/api/bosses/${bossId}/attack`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, lat: userLocation.latitude, lng: userLocation.longitude })
      })
      const d = await r.json()
      if (d.success) {
        showToast(`⚔ 보스에게 ${d.damage} 데미지! 남은 HP ${d.hpPct}%${d.killed ? ' — 처치!' : ''}`, 'success')
        get().fetchWorldBosses()
        if (d.killed) get().loadUserData()
      } else showToast(d.error || '공격 실패', 'error')
    } catch (e) { console.error('boss attack', e) }
  },

  // 공성 상태 — 방어 (내가 당하는 공성)
  siegeStatus: [], // [{territoryId, center, secondsRemaining, towersAlive, attackerName}]
  fetchSiegeStatus: async () => {
    const { userId } = get()
    if (!userId) return
    try {
      const r = await fetch(`${API_URL}/api/towers/siege-status/${userId}`)
      const d = await r.json()
      if (d.success) set({ siegeStatus: d.sieges || [] })
    } catch {}
  },

  // 공성 상태 — 공격 (내가 공격 중인 적 영역)
  mySieges: { breached: [], damaging: [] },
  fetchMySieges: async () => {
    const { userId } = get()
    if (!userId) return
    try {
      const r = await fetch(`${API_URL}/api/towers/my-sieges/${userId}`)
      const d = await r.json()
      if (d.success) set({ mySieges: { breached: d.breached || [], damaging: d.damaging || [] } })
    } catch {}
  },

  // 타워 시스템
  towerClasses: null, // 클래스별 메타 (서버에서 1회 fetch)
  fetchTowerClasses: async () => {
    try {
      const r = await fetch(`${API_URL}/api/towers/classes`)
      const d = await r.json()
      set({ towerClasses: d.classes || null })
    } catch (e) {}
  },
  placeTower: async (territoryId, towerClass, tier = 1, grantId = null) => {
    const { userId, showToast } = get()
    try {
      const r = await fetch(`${API_URL}/api/towers/place`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, territoryId, towerClass, tier, grantId })
      })
      const d = await r.json()
      if (d.success) {
        const msg = d.foothold
          ? `🗡 발판 확보! 적 영역에 타워 건설 (무료)`
          : `🏰 타워 배치 완료 (-${d.cost} 에너지)`
        showToast(msg, 'success')
        get().loadUserData()
        get().fetchSlotGrants()
      } else showToast(d.error || '배치 실패', 'error')
      return d
    } catch (e) { return { success: false } }
  },

  // 디버그 — 내 영역+타워 전부 삭제
  resetMyTerritories: async () => {
    const { userId, showToast } = get()
    if (!userId) return
    if (!confirm('⚠ 내 영역과 타워를 전부 삭제합니다 (테스트용). 계속?')) return
    try {
      const r = await fetch(`${API_URL}/api/territory/reset/${userId}`, { method: 'DELETE' })
      const d = await r.json()
      if (d.success) {
        showToast(`🗑 영역 ${d.deletedTerritories}개 + 타워 ${d.deletedTowers}개 삭제`, 'success')
        get().loadUserData()
      } else showToast(d.error || '리셋 실패', 'error')
    } catch (e) { showToast(e.message, 'error') }
  },

  // 디버그 — 모든 사용자 영역+타워 전부 wipe (테스트 클러스터 정리)
  resetAllTerritories: async () => {
    const { showToast } = get()
    if (!confirm('⚠⚠ 전체 영역+타워를 모두 삭제합니다 (DB wipe). 계속?')) return
    try {
      const r = await fetch(`${API_URL}/api/territory/reset-all/guardian-test`, { method: 'DELETE' })
      const d = await r.json()
      if (d.success) {
        showToast(`🗑🗑 전체 영역 ${d.deletedTerritories}개 + 타워 ${d.deletedTowers}개 삭제`, 'success')
        get().loadUserData()
      } else showToast(d.error || '전체 리셋 실패', 'error')
    } catch (e) { showToast(e.message, 'error') }
  },

  // 디버그 — 주변 영역 모두 조회 (overlap 진단)
  debugNearbyTerritories: async () => {
    const { userLocation, showToast } = get()
    if (!userLocation) return
    try {
      const r = await fetch(`${API_URL}/api/territory/debug/nearby-all?lat=${userLocation.latitude}&lng=${userLocation.longitude}`)
      const d = await r.json()
      if (d.success) {
        const list = d.territories.slice(0, 10).map(t =>
          `${t.owner}: ${t.dist}m (r=${Math.round(t.radius)}m)`
        ).join('\n')
        const msg = d.territories.length === 0
          ? '✅ 1.5km 내 영역 없음 — 자유롭게 확장 가능'
          : `⚠ 주변 ${d.territories.length}개:\n${list}`
        alert(msg)
      }
    } catch (e) { showToast(e.message, 'error') }
  },

  // 슬롯 권리 (직접 침투 격파 후 5분 무료 건설)
  slotGrants: [],
  fetchSlotGrants: async () => {
    const { userId } = get()
    if (!userId) return
    try {
      const r = await fetch(`${API_URL}/api/towers/grants/${userId}`)
      const d = await r.json()
      if (d.success) set({ slotGrants: d.grants || [] })
    } catch {}
  },
  upgradeTower: async (towerId) => {
    const { userId, showToast } = get()
    try {
      const r = await fetch(`${API_URL}/api/towers/upgrade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, towerId })
      })
      const d = await r.json()
      if (d.success) {
        showToast(`⬆ T${d.newTier}로 업그레이드 (-${d.cost} 에너지)`, 'success')
        get().loadUserData()
      } else showToast(d.error || '업그레이드 실패', 'error')
      return d
    } catch (e) { return { success: false } }
  },

  // 튜토리얼
  tutorialState: { step: 0, currentStep: null, completed: false },
  fetchTutorialState: async () => {
    const { userId } = get()
    if (!userId) return
    try {
      const r = await fetch(`${API_URL}/api/tutorial/state/${userId}`)
      const d = await r.json()
      if (d.success) set({ tutorialState: d })
    } catch (e) {}
  },
  advanceTutorial: async (expectedKey) => {
    const { userId, showToast } = get()
    try {
      const r = await fetch(`${API_URL}/api/tutorial/advance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, expectedKey })
      })
      const d = await r.json()
      if (d.success && d.reward) {
        const parts = []
        if (d.reward.xp)     parts.push(`+${d.reward.xp} XP`)
        if (d.reward.energy) parts.push(`+${d.reward.energy} 에너지`)
        if (parts.length) showToast(`📚 튜토리얼: ${parts.join(', ')}`, 'success')
      }
      get().fetchTutorialState()
      get().loadUserData()
      return d
    } catch (e) { return { success: false } }
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
      // 경로 A 격파 보상 — slotGrant 발급되면 즉시 토스트 + 갱신
      if (execData.slotGrant) {
        get().showToast('🗡 적 영역에 발판 확보! 5분 내 무료 타워 1개 건설 가능', 'success')
        get().fetchSlotGrants()
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
