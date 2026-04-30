import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Polyline, Polygon, useMap } from 'react-leaflet'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { useGameStore } from './stores/gameStore'
import GuardianPanel from './components/GuardianPanel'
import TerritoryControls from './components/TerritoryControls'
import BattleModal from './components/BattleModal'
import PWAInstall from './components/PWAInstall'
import PartsPanel from './components/PartsPanel'
import Leaderboard from './components/Leaderboard'
import { sendToUnity, registerUnityReceiver, isInsideUnity } from './unityBridge'

// 아이콘 충돌 감지 및 튕겨내기 (물리 기반)
const resolveMarkerCollisions = (items, getPosition, getIconSize) => {
  if (!items || items.length === 0) return []

  // 위도 1도 ≈ 111km, 경도 1도 ≈ 88km (한국 기준)
  // 픽셀 to 위경도 변환 (줌 15 기준, 대략적)
  const pixelToLat = 0.000003
  const pixelToLng = 0.000004

  // 마커 위치 복사
  const markers = items.map((item, i) => {
    const pos = getPosition(item)
    if (!pos || pos.lat === undefined) {
      return null
    }
    const size = getIconSize ? getIconSize(item) : { width: 50, height: 50 }
    return {
      ...item,
      index: i,
      lat: pos.lat,
      lng: pos.lng,
      width: size.width,
      height: size.height
    }
  }).filter(Boolean)

  // 충돌 해결 반복 (최대 10회)
  for (let iter = 0; iter < 10; iter++) {
    let hasCollision = false

    for (let i = 0; i < markers.length; i++) {
      for (let j = i + 1; j < markers.length; j++) {
        const a = markers[i]
        const b = markers[j]

        // 두 아이콘 간 거리 (픽셀 단위로 변환)
        const dLat = (b.lat - a.lat) / pixelToLat
        const dLng = (b.lng - a.lng) / pixelToLng

        // 필요한 최소 거리 (아이콘 크기의 절반씩)
        const minDistX = (a.width + b.width) / 2 + 5 // 5px 여유
        const minDistY = (a.height + b.height) / 2 + 5

        // 겹침 확인
        const overlapX = Math.abs(dLng) < minDistX
        const overlapY = Math.abs(dLat) < minDistY

        if (overlapX && overlapY) {
          hasCollision = true

          // 밀어내기 방향 계산
          const dist = Math.sqrt(dLat * dLat + dLng * dLng) || 1
          const pushX = (dLng / dist) * (minDistX - Math.abs(dLng) + 10) * 0.5
          const pushY = (dLat / dist) * (minDistY - Math.abs(dLat) + 10) * 0.5

          // 양쪽으로 밀어내기
          a.lng -= pushX * pixelToLng
          a.lat -= pushY * pixelToLat
          b.lng += pushX * pixelToLng
          b.lat += pushY * pixelToLat
        }
      }
    }

    if (!hasCollision) break
  }

  return markers.map(m => ({
    ...m,
    spreadPosition: { lat: m.lat, lng: m.lng }
  }))
}

// Leaflet 기본 마커 아이콘 수정 (Vite 번들링 이슈 해결)
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow
})

// 플레이어 위치 아이콘
const playerIcon = L.divIcon({
  className: 'player-marker',
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#00ff88;border:3px solid white;box-shadow:0 0 10px #00ff88;"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
})

// 인라인 SVG 마커 (간단 픽토그램 — 외부 에셋 의존 0)
const guardianSvgHtml = (type, color = '#FFD700') => {
  if (type === 'animal') return `
    <svg viewBox="0 0 64 64" width="40" height="40">
      <ellipse cx="32" cy="58" rx="14" ry="2" fill="#000" opacity="0.3"/>
      <ellipse cx="32" cy="36" rx="20" ry="13" fill="${color}"/>
      <circle cx="48" cy="22" r="10" fill="${color}"/>
      <polygon points="44,12 47,18 41,18" fill="${color}"/>
      <polygon points="52,12 55,18 49,18" fill="${color}"/>
      <circle cx="46" cy="22" r="1.6" fill="#111"/>
      <circle cx="51" cy="22" r="1.6" fill="#111"/>
      <rect x="14" y="40" width="6" height="14" fill="${color}"/>
      <rect x="22" y="40" width="6" height="14" fill="${color}"/>
      <rect x="36" y="40" width="6" height="14" fill="${color}"/>
      <rect x="44" y="40" width="6" height="14" fill="${color}"/>
    </svg>`
  if (type === 'robot') return `
    <svg viewBox="0 0 64 64" width="40" height="40">
      <ellipse cx="32" cy="58" rx="14" ry="2" fill="#000" opacity="0.3"/>
      <rect x="14" y="22" width="36" height="24" rx="3" fill="${color}"/>
      <rect x="22" y="8" width="20" height="14" rx="2" fill="${color}"/>
      <rect x="20" y="42" width="8" height="14" fill="${color}"/>
      <rect x="36" y="42" width="8" height="14" fill="${color}"/>
      <line x1="32" y1="2" x2="32" y2="8" stroke="${color}" stroke-width="2"/>
      <circle cx="32" cy="2" r="2" fill="#ff4444"/>
      <rect x="26" y="13" width="3" height="3" fill="#0f0"/>
      <rect x="35" y="13" width="3" height="3" fill="#0f0"/>
      <circle cx="32" cy="34" r="3" fill="#fff"/>
    </svg>`
  // aircraft
  return `
    <svg viewBox="0 0 64 64" width="40" height="40">
      <ellipse cx="32" cy="58" rx="14" ry="2" fill="#000" opacity="0.3"/>
      <polygon points="2,38 32,32 2,46" fill="${color}"/>
      <polygon points="62,38 32,32 62,46" fill="${color}"/>
      <ellipse cx="32" cy="38" rx="28" ry="9" fill="${color}"/>
      <ellipse cx="42" cy="36" rx="6" ry="4" fill="#88ddff" opacity="0.7"/>
      <circle cx="32" cy="38" r="4" fill="#fff"/>
    </svg>`
}

// 내 수호신 (금빛)
const createGuardianIcon = (type) => L.divIcon({
  className: 'guardian-marker',
  html: `<div style="filter:drop-shadow(0 0 8px gold);">${guardianSvgHtml(type, '#FFD700')}</div>`,
  iconSize: [40, 40], iconAnchor: [20, 38]
})

// 다른 플레이어 (빨강)
const createOtherPlayerIcon = (type, username) => L.divIcon({
  className: 'other-player-marker',
  html: `<div style="text-align:center;">
    <div style="filter:drop-shadow(0 0 6px #ff4444);">${guardianSvgHtml(type, '#ff5566')}</div>
    <div style="font-size:10px;color:white;background:#ff4444;padding:2px 6px;border-radius:4px;margin-top:-4px;">${username}</div>
  </div>`,
  iconSize: [50, 56], iconAnchor: [25, 50]
})

// 고정 수호신 (방어=파랑, 생산=금)
const fixedGuardianSvg = (isProduction) => `
  <svg viewBox="0 0 48 48" width="32" height="32">
    <rect x="6" y="14" width="36" height="28" rx="3" fill="${isProduction ? '#ffcc00' : '#4488ff'}"/>
    <polygon points="24,2 38,14 10,14" fill="${isProduction ? '#ffaa00' : '#3366cc'}"/>
    ${isProduction
      ? '<circle cx="24" cy="28" r="6" fill="#fff" opacity="0.9"/><circle cx="24" cy="28" r="3" fill="#ffcc00"/>'
      : '<rect x="18" y="22" width="12" height="14" fill="#fff" opacity="0.9"/><polygon points="24,18 28,22 20,22" fill="#fff"/>'
    }
  </svg>`

const createFixedGuardianIcon = (type, owner) => L.divIcon({
  className: 'fixed-guardian-marker',
  html: `<div style="text-align:center;">
    <div style="filter:drop-shadow(0 0 6px ${type === 'production' ? '#ffd700' : '#4488ff'});">${fixedGuardianSvg(type === 'production')}</div>
    <div style="font-size:9px;color:black;background:${type === 'production' ? '#ffd700' : '#4488ff'};padding:1px 4px;border-radius:3px;">${owner}</div>
  </div>`,
  iconSize: [40, 50], iconAnchor: [20, 42]
})

// 맵 중심 이동 컴포넌트
function MapController({ center }) {
  const map = useMap()
  useEffect(() => {
    if (center) {
      map.setView([center.latitude, center.longitude], map.getZoom())
    }
  }, [center, map])
  return null
}

export default function App() {
  const [mapCenter, setMapCenter] = useState([37.5, 127.0])
  const [locationRequested, setLocationRequested] = useState(false)
  const [locationError, setLocationError] = useState(null)
  const [showLogin, setShowLogin] = useState(false)
  const [nickname, setNickname] = useState('')
  const [nearbyData, setNearbyData] = useState(null)
  const [showNearbyPanel, setShowNearbyPanel] = useState(false)
  const [lastAlertCount, setLastAlertCount] = useState(0)
  const [showParts, setShowParts] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)

  const {
    visitorId,
    userLocation,
    userId,
    guardian,
    territories,
    nearbyTerritories,
    nearbyPlayers,
    nearbyFixedGuardians,
    expandingTerritory,
    toast,
    fixedGuardianStorage,
    formationData,
    setUserLocation,
    setVisitorId,
    setArMode,
    loadUserData,
    updateLocation,
    initiatePlayerEncounter,
    initiateFixedGuardianAttack,
    collectFromGuardian,
    fetchStorageSummary,
    fetchFormation
  } = useGameStore()

  // 진영 상태 60초마다 동기화
  useEffect(() => {
    if (!visitorId) return
    fetchFormation()
    const id = setInterval(fetchFormation, 60000)
    return () => clearInterval(id)
  }, [visitorId])

  // 50m 이내 + 누적된 고정 수호신 (Collect 가능)
  const collectibleGuardians = (fixedGuardianStorage || []).filter(g => {
    if (!userLocation || !g.center || g.storedCount <= 0) return false
    const R = 6371000, toRad = d => d * Math.PI / 180
    const dLat = toRad(g.center.lat - userLocation.latitude)
    const dLng = toRad(g.center.lng - userLocation.longitude)
    const sa = Math.sin(dLat/2)**2 +
               Math.cos(toRad(userLocation.latitude)) * Math.cos(toRad(g.center.lat)) *
               Math.sin(dLng/2)**2
    const d = 2 * R * Math.asin(Math.sqrt(sa))
    return d <= 50
  })

  // 위치 변경 시 storage 폴링 (1분마다)
  useEffect(() => {
    if (!visitorId) return
    fetchStorageSummary()
    const id = setInterval(fetchStorageSummary, 60000)
    return () => clearInterval(id)
  }, [visitorId])

  // 초기 데이터 로드 (visitorId가 있을 때만)
  useEffect(() => {
    if (visitorId) {
      loadUserData()
    }
  }, [visitorId])

  // 주기적 ping (last_seen_at 갱신, 일일 보너스 XP 수령)
  useEffect(() => {
    const { userId } = useGameStore.getState()
    if (!userId) return

    const doPing = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/activity/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        })
        const data = await res.json()
        if (data.dailyBonus) {
          const showToast = useGameStore.getState().showToast
          showToast(`📅 일일 접속 보너스 +25 XP${data.dailyBonus.leveledUp ? ` · 🎉 레벨업! Lv.${data.dailyBonus.level}` : ''}`, 'success')
          useGameStore.getState().loadUserData()
        }
      } catch {}
    }
    doPing() // 즉시 한 번 (일일 체크)
    const id = setInterval(doPing, 60000)
    return () => clearInterval(id)
  }, [visitorId])

  // Unity 브릿지 수신 등록
  useEffect(() => {
    registerUnityReceiver((msg) => {
      try {
        const data = typeof msg === 'string' ? JSON.parse(msg) : msg
        // Unity → 웹: visitorId 동기화
        if (data.type === 'SET_VISITOR_ID' && data.visitorId) {
          setVisitorId(data.visitorId)
        }
        // Unity → 웹: 위치 동기화 (Unity GPS를 웹에도 반영)
        if (data.type === 'SET_LOCATION') {
          setUserLocation({ latitude: data.lat, longitude: data.lng })
          setMapCenter([data.lat, data.lng])
        }
        // Unity → 웹: AR 모드 상태 동기화
        if (data.type === 'AR_MODE_CHANGED') {
          setArMode(!!data.active)
        }
      } catch (e) {
        console.error('Unity bridge parse error', e)
      }
    })
  }, [])

  // 주변에 다른 플레이어/고정 수호신 데이터 저장
  useEffect(() => {
    const playerCount = nearbyPlayers?.length || 0
    const fixedCount = nearbyFixedGuardians?.length || 0
    const totalCount = playerCount + fixedCount

    if (totalCount > 0) {
      setNearbyData({
        players: nearbyPlayers || [],
        fixedGuardians: nearbyFixedGuardians || [],
        playerCount,
        fixedCount
      })

      // 새로운 대상 발견 시에만 알림 (한 번만)
      if (totalCount > lastAlertCount) {
        setLastAlertCount(totalCount)
        // 진동으로 알림 (지원되는 경우)
        if (navigator.vibrate) {
          navigator.vibrate(200)
        }
      }
    } else {
      setNearbyData(null)
      setLastAlertCount(0)
    }
  }, [nearbyPlayers, nearbyFixedGuardians])

  // 단순 오프셋 방식으로 마커 분산
  const { spreadPlayers, spreadFixedGuardians } = useMemo(() => {
    const players = (nearbyPlayers || []).map((p, i) => ({
      ...p,
      spreadPosition: {
        lat: p.location?.lat,
        lng: (p.location?.lng || 0) + (i * 0.0003) // 30m씩 오프셋
      }
    })).filter(p => p.spreadPosition.lat !== undefined)

    const fixed = (nearbyFixedGuardians || []).map((fg, i) => ({
      ...fg,
      spreadPosition: {
        lat: fg.position?.lat,
        lng: (fg.position?.lng || 0) + (i * 0.0003) + 0.00015 // 플레이어와 다른 오프셋
      }
    })).filter(fg => fg.spreadPosition.lat !== undefined)

    console.log('Players to render:', players.length, players)
    console.log('Fixed guardians to render:', fixed.length, fixed)

    return { spreadPlayers: players, spreadFixedGuardians: fixed }
  }, [nearbyPlayers, nearbyFixedGuardians])

  // AR 전환 — Unity 안이면 Unity에게, 아니면 PWA 자체 처리
  const switchToAR = () => {
    if (isInsideUnity()) {
      sendToUnity('SWITCH_TO_AR', {
        lat: userLocation?.latitude,
        lng: userLocation?.longitude,
        visitorId,
        userId: useGameStore.getState().userId
      })
    } else {
      alert('AR 모드는 앱에서 지원됩니다')
    }
  }

  // 플레이어 조우 → Unity에 알림 (Unity가 AR 전투 처리)
  const handlePlayerEncounter = (player) => {
    if (isInsideUnity()) {
      sendToUnity('PLAYER_ENCOUNTER', { player })
    } else {
      initiatePlayerEncounter(player)
    }
  }

  // 고정 수호신 공격 → Unity에 알림
  const handleFixedGuardianAttack = (fg) => {
    if (isInsideUnity()) {
      sendToUnity('FIXED_GUARDIAN_ATTACK', { fixedGuardian: fg })
    } else {
      initiateFixedGuardianAttack(fg)
    }
  }

  const requestLocation = () => {
    setLocationRequested(true)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { longitude, latitude } = pos.coords
          setUserLocation({ longitude, latitude })
          setMapCenter([latitude, longitude])
          setLocationError(null)
          // 서버에 위치 업데이트
          updateLocation(latitude, longitude)
          // Unity에도 위치 전달
          sendToUnity('LOCATION_UPDATE', { lat: latitude, lng: longitude })
        },
        (err) => {
          console.error('Geolocation error:', err)
          setLocationError('위치 권한이 거부되었습니다')
          setUserLocation({ longitude: 127.0, latitude: 37.5 })
        },
        { enableHighAccuracy: true, timeout: 10000 }
      )

      // 위치 변경 감시
      navigator.geolocation.watchPosition(
        (pos) => {
          const { longitude, latitude } = pos.coords
          setUserLocation({ longitude, latitude })
          updateLocation(latitude, longitude)
          sendToUnity('LOCATION_UPDATE', { lat: latitude, lng: longitude })
        },
        () => {},
        { enableHighAccuracy: true }
      )
    } else {
      setLocationError('이 브라우저는 위치 기능을 지원하지 않습니다')
      setUserLocation({ longitude: 127.0, latitude: 37.5 })
    }
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      <MapContainer
        center={mapCenter}
        zoom={15}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* 진영(formation) 오버레이 — 연결선 / 호구(atari) / 눈 영역 */}
        {formationData && (() => {
          const tById = Object.fromEntries((formationData.territories || []).map(t => [t.id, t]))
          return (
            <>
              {/* 연결선 — 자기 진영 = 초록, 적과 인접 = 빨강 (호구 표시) */}
              {(formationData.links || []).map((l, i) => {
                const a = tById[l.a], b = tById[l.b]
                if (!a || !b) return null
                const isMineLink = a.userId === userId || b.userId === userId
                const color = l.friendly
                  ? (isMineLink ? '#00ff88' : '#ffd700')   // 내 진영: 에메랄드, 다른 동맹: 골드
                  : '#ff4444'                              // 적대: 빨강
                return (
                  <Polyline
                    key={i}
                    positions={[[a.center.lat, a.center.lng], [b.center.lat, b.center.lng]]}
                    pathOptions={{ color, weight: l.friendly ? 3 : 2, opacity: 0.65, dashArray: l.friendly ? null : '5,5' }}
                  />
                )
              })}

              {/* 호구(atari) 영역 — 빨간 펄스 원 */}
              {(formationData.territories || []).filter(t => t.atari).map(t => (
                <Circle
                  key={`atari-${t.id}`}
                  center={[t.center.lat, t.center.lng]}
                  radius={t.radius * 1.2}
                  pathOptions={{ color: '#ff0044', weight: 3, fillColor: '#ff0044', fillOpacity: 0.15, dashArray: '8,4' }}
                />
              ))}

              {/* 눈(eye) 영역 — 안전지대 */}
              {(formationData.territories || []).filter(t => t.inEye && t.userId === userId).map(t => (
                <Circle
                  key={`eye-${t.id}`}
                  center={[t.center.lat, t.center.lng]}
                  radius={t.radius * 1.05}
                  pathOptions={{ color: '#88ffaa', weight: 1, fillColor: '#88ffaa', fillOpacity: 0.20 }}
                />
              ))}
            </>
          )
        })()}

        {userLocation && (
          <MapController center={userLocation} />
        )}

        {userLocation && (
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={playerIcon}
          />
        )}

        {guardian && userLocation && (
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={createGuardianIcon(guardian.type)}
          />
        )}

        {/* 확장 중인 영역 */}
        {expandingTerritory && (
          <Circle
            center={[expandingTerritory.center.latitude, expandingTerritory.center.longitude]}
            radius={expandingTerritory.radius}
            pathOptions={{
              color: '#00ff88',
              fillColor: '#00ff88',
              fillOpacity: 0.2
            }}
          />
        )}

        {/* 내 영역들 */}
        {territories.map(t => (
          <Circle
            key={t.id}
            center={[t.center.lat, t.center.lng]}
            radius={t.radius}
            pathOptions={{
              color: '#00ff88',
              fillColor: '#00ff88',
              fillOpacity: 0.2
            }}
          />
        ))}

        {/* 다른 플레이어 영역들 */}
        {nearbyTerritories.map(t => (
          <Circle
            key={t.id}
            center={[t.center.lat, t.center.lng]}
            radius={t.radius}
            pathOptions={{
              color: '#ff4444',
              fillColor: '#ff4444',
              fillOpacity: 0.2
            }}
          />
        ))}

        {/* 다른 플레이어들 - 충돌 방지 오프셋 적용 */}
        {nearbyPlayers && nearbyPlayers.map((player, idx) => {
          const offsetLng = (idx % 5) * 0.0003
          const offsetLat = Math.floor(idx / 5) * 0.0003
          return (
            <Marker
              key={player.id}
              position={[player.location.lat + offsetLat, player.location.lng + offsetLng]}
              icon={createOtherPlayerIcon(player.guardian?.type, player.username)}
              eventHandlers={{
                click: () => guardian && handlePlayerEncounter(player)
              }}
            />
          )
        })}

        {/* 다른 플레이어의 고정 수호신들 */}
        {nearbyFixedGuardians && nearbyFixedGuardians.map((fg, idx) => {
          const offsetLng = (idx % 5) * 0.0003 + 0.00015
          const offsetLat = Math.floor(idx / 5) * 0.0003 + 0.00015
          return (
            <Marker
              key={`fixed-${fg.id}`}
              position={[fg.position.lat + offsetLat, fg.position.lng + offsetLng]}
              icon={createFixedGuardianIcon(fg.type, fg.owner)}
              eventHandlers={{
                click: () => guardian && handleFixedGuardianAttack(fg)
              }}
            />
          )
        })}
      </MapContainer>

      {/* AR 전환 버튼 (항상 표시) */}
      {guardian && userLocation && (
        <button onClick={switchToAR} style={styles.arBtn}>
          📷 AR 모드
        </button>
      )}

      {/* 탐지 버튼 */}
      {nearbyData && guardian && (
        <button
          onClick={() => setShowNearbyPanel(!showNearbyPanel)}
          style={{
            ...styles.detectBtn,
            background: showNearbyPanel ? '#ff4444' : '#00ff88'
          }}
        >
          🔍 탐지 ({nearbyData.playerCount + nearbyData.fixedCount})
        </button>
      )}

      {/* 탐지 패널 */}
      {showNearbyPanel && nearbyData && guardian && (
        <div style={styles.nearbyPanel}>
          <div style={styles.panelHeader}>
            <span>주변 탐지 결과</span>
            <button onClick={() => setShowNearbyPanel(false)} style={styles.alertClose}>✕</button>
          </div>
          <div style={styles.alertList}>
            {nearbyData.players.map(p => (
              <div
                key={p.id}
                style={styles.alertItem}
                onClick={() => {
                  initiatePlayerEncounter(p)
                  setShowNearbyPanel(false)
                }}
              >
                <span>{p.guardian?.type === 'animal' ? '🦁' : p.guardian?.type === 'robot' ? '🤖' : '✈️'}</span>
                <span>{p.username}</span>
                <span style={styles.alertAction}>전투/협력</span>
              </div>
            ))}
            {nearbyData.fixedGuardians.map(fg => (
              <div
                key={fg.id}
                style={styles.alertItem}
                onClick={() => {
                  initiateFixedGuardianAttack(fg)
                  setShowNearbyPanel(false)
                }}
              >
                <span>{fg.type === 'production' ? '⚙️' : '🛡️'}</span>
                <span>{fg.owner}의 수호신</span>
                <span style={styles.alertAction}>공격</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!visitorId && (
        <div style={styles.locationPrompt}>
          <h2>Guardian AR</h2>
          <p>위치 기반 수호신 전략 게임</p>
          <input
            type="text"
            placeholder="닉네임 입력"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            style={styles.nicknameInput}
          />
          <button
            onClick={() => {
              if (nickname.trim()) {
                setVisitorId(nickname.trim())
                setShowLogin(false)
              }
            }}
            style={styles.locationBtn}
            disabled={!nickname.trim()}
          >
            시작하기
          </button>
        </div>
      )}

      {visitorId && !userLocation && !locationRequested && (
        <div style={styles.locationPrompt}>
          <h2>환영합니다, {visitorId}!</h2>
          <p>위치 권한이 필요합니다</p>
          <button onClick={requestLocation} style={styles.locationBtn}>
            위치 권한 허용하기
          </button>
        </div>
      )}

      {locationError && (
        <div style={styles.errorPanel}>
          <h3>위치 권한 필요</h3>
          <p>{locationError}</p>
          <div style={styles.instructions}>
            <p><b>iPhone 설정 방법:</b></p>
            <p>설정 → Chrome → 위치 → 허용</p>
          </div>
          <button onClick={requestLocation} style={styles.retryBtn}>
            다시 시도
          </button>
        </div>
      )}

      {/* 파츠 버튼 */}
      {guardian && (
        <button onClick={() => setShowParts(true)} style={styles.partsBtn}>
          ⚙️ 파츠
        </button>
      )}

      {/* 리더보드 버튼 */}
      <button onClick={() => setShowLeaderboard(true)} style={styles.leaderboardBtn}>
        🏆
      </button>

      {/* 인접 고정 수호신 Collect 버튼 (50m 이내 + 누적 있을 때만 표시) */}
      {collectibleGuardians.length > 0 && (
        <div style={styles.collectBar}>
          {collectibleGuardians.map(g => (
            <button
              key={g.id}
              onClick={() => collectFromGuardian(g.id)}
              style={{
                ...styles.collectBtn,
                background: g.isFull ? 'linear-gradient(135deg,#ff6600,#cc3300)' : 'linear-gradient(135deg,#ffcc00,#ff8800)'
              }}
            >
              📦 수령 {g.storedCount}/{g.capacity}{g.isFull ? ' (가득참!)' : ''}
            </button>
          ))}
        </div>
      )}

      {/* 멀리 있는 내 고정 수호신 storage 알림 (간이) */}
      {(fixedGuardianStorage || []).filter(g => g.storedCount > 0 && !collectibleGuardians.some(c => c.id === g.id)).length > 0 && (
        <div style={styles.storageHint}>
          📦 저장소 {(fixedGuardianStorage || []).reduce((s, g) => s + g.storedCount, 0)}개 누적 중 — 영역 방문 시 수령
        </div>
      )}

      {/* 토스트 알림 (개행 지원) */}
      {toast && (
        <div style={{
          ...styles.toast,
          background: toast.type === 'success' ? 'rgba(0,180,80,0.95)' : 'rgba(30,30,60,0.95)',
          borderColor: toast.type === 'success' ? '#00ff88' : '#4488ff',
          whiteSpace: 'pre-line'
        }}>
          {toast.message}
        </div>
      )}

      <GuardianPanel />
      <TerritoryControls />
      <BattleModal />
      <PWAInstall />

      {showParts && <PartsPanel onClose={() => setShowParts(false)} />}
      {showLeaderboard && <Leaderboard onClose={() => setShowLeaderboard(false)} />}
    </div>
  )
}

const styles = {
  locationPrompt: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(0,0,0,0.9)',
    padding: 32,
    borderRadius: 16,
    color: 'white',
    textAlign: 'center',
    zIndex: 2000
  },
  nicknameInput: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: 'none',
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center'
  },
  locationBtn: {
    marginTop: 16,
    background: '#00ff88',
    color: 'black',
    border: 'none',
    padding: '16px 32px',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
    width: '100%'
  },
  errorPanel: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(0,0,0,0.95)',
    color: 'white',
    padding: 24,
    borderRadius: 16,
    textAlign: 'center',
    zIndex: 2000,
    maxWidth: 300
  },
  instructions: {
    background: '#333',
    padding: 12,
    borderRadius: 8,
    margin: '16px 0',
    fontSize: 14
  },
  retryBtn: {
    background: '#00ff88',
    color: 'black',
    border: 'none',
    padding: '12px 24px',
    borderRadius: 8,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  arBtn: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    padding: '14px 20px',
    borderRadius: 50,
    border: 'none',
    background: 'linear-gradient(135deg, #00bfff, #0040ff)',
    color: 'white',
    fontWeight: 'bold',
    fontSize: 15,
    cursor: 'pointer',
    zIndex: 1500,
    boxShadow: '0 4px 20px rgba(0,64,255,0.5)'
  },
  detectBtn: {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 24px',
    borderRadius: 25,
    border: 'none',
    color: 'black',
    fontWeight: 'bold',
    fontSize: 16,
    cursor: 'pointer',
    zIndex: 1500,
    boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
  },
  nearbyPanel: {
    position: 'absolute',
    top: 70,
    left: 20,
    right: 20,
    background: 'rgba(0,0,0,0.95)',
    borderRadius: 12,
    padding: 16,
    color: 'white',
    zIndex: 1500,
    maxHeight: '60vh',
    overflowY: 'auto'
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontWeight: 'bold',
    marginBottom: 12,
    fontSize: 16
  },
  alertHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 'bold',
    marginBottom: 8
  },
  alertClose: {
    marginLeft: 'auto',
    background: 'transparent',
    border: 'none',
    color: 'white',
    fontSize: 18,
    cursor: 'pointer'
  },
  alertList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  },
  alertItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(0,0,0,0.3)',
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'pointer'
  },
  alertAction: {
    marginLeft: 'auto',
    background: '#ffd700',
    color: 'black',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 'bold'
  },
  partsBtn: {
    position: 'absolute',
    bottom: 160,
    right: 20,
    padding: '12px 16px',
    borderRadius: 50,
    border: 'none',
    background: 'rgba(30,30,60,0.9)',
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
    cursor: 'pointer',
    zIndex: 1500,
    boxShadow: '0 4px 15px rgba(0,0,0,0.4)'
  },
  leaderboardBtn: {
    position: 'absolute',
    bottom: 220,
    right: 20,
    width: 46,
    height: 46,
    borderRadius: 50,
    border: 'none',
    background: 'rgba(30,30,60,0.9)',
    color: 'white',
    fontSize: 22,
    cursor: 'pointer',
    zIndex: 1500,
    boxShadow: '0 4px 15px rgba(0,0,0,0.4)'
  },
  collectBar: {
    position: 'absolute',
    bottom: 280,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    zIndex: 1500
  },
  collectBtn: {
    padding: '12px 22px',
    borderRadius: 30,
    border: 'none',
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
    cursor: 'pointer',
    boxShadow: '0 4px 18px rgba(255,170,0,0.6)',
    animation: 'pulse 1.4s infinite'
  },
  storageHint: {
    position: 'absolute',
    top: 110,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '6px 14px',
    borderRadius: 20,
    background: 'rgba(40,30,10,0.9)',
    color: '#ffcc00',
    fontSize: 12,
    fontWeight: 'bold',
    zIndex: 1400,
    border: '1px solid #ffcc0044'
  },
  toast: {
    position: 'absolute',
    top: 70,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 20px',
    borderRadius: 10,
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    zIndex: 4000,
    border: '1px solid',
    maxWidth: '80%',
    textAlign: 'center',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
  }
}
