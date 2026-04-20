import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useGameStore } from './stores/gameStore'
import GuardianPanel from './components/GuardianPanel'
import TerritoryControls from './components/TerritoryControls'
import BattleModal from './components/BattleModal'

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

// Leaflet 기본 마커 아이콘 수정 (webpack 이슈 해결)
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// 플레이어 위치 아이콘
const playerIcon = L.divIcon({
  className: 'player-marker',
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#00ff88;border:3px solid white;box-shadow:0 0 10px #00ff88;"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
})

// 수호신 아이콘 생성 (내 수호신 - 금색)
const createGuardianIcon = (type) => L.divIcon({
  className: 'guardian-marker',
  html: `<div style="font-size:32px;filter:drop-shadow(0 0 8px gold);">${
    type === 'animal' ? '🦁' : type === 'robot' ? '🤖' : '✈️'
  }</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32]
})

// 다른 플레이어 아이콘 생성 (빨간색 테두리)
const createOtherPlayerIcon = (type, username) => L.divIcon({
  className: 'other-player-marker',
  html: `<div style="text-align:center;">
    <div style="font-size:28px;filter:drop-shadow(0 0 6px #ff4444);">${
      type === 'animal' ? '🦁' : type === 'robot' ? '🤖' : type === 'aircraft' ? '✈️' : '👤'
    }</div>
    <div style="font-size:10px;color:white;background:#ff4444;padding:2px 6px;border-radius:4px;margin-top:-5px;">${username}</div>
  </div>`,
  iconSize: [50, 50],
  iconAnchor: [25, 40]
})

// 고정 수호신 아이콘 (방어형: 파란색, 생산형: 노란색)
const createFixedGuardianIcon = (type, owner) => L.divIcon({
  className: 'fixed-guardian-marker',
  html: `<div style="text-align:center;">
    <div style="font-size:24px;filter:drop-shadow(0 0 6px ${type === 'production' ? '#ffd700' : '#4488ff'});">${
      type === 'production' ? '⚙️' : '🛡️'
    }</div>
    <div style="font-size:9px;color:white;background:${type === 'production' ? '#ffd700' : '#4488ff'};padding:1px 4px;border-radius:3px;color:black;">${owner}</div>
  </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 35]
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

  const {
    visitorId,
    userLocation,
    guardian,
    territories,
    nearbyTerritories,
    nearbyPlayers,
    nearbyFixedGuardians,
    expandingTerritory,
    setUserLocation,
    setVisitorId,
    loadUserData,
    updateLocation,
    initiatePlayerEncounter,
    initiateFixedGuardianAttack
  } = useGameStore()

  // 초기 데이터 로드 (visitorId가 있을 때만)
  useEffect(() => {
    if (visitorId) {
      loadUserData()
    }
  }, [visitorId])

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
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapContainer
        center={mapCenter}
        zoom={15}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

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

        {/* 다른 플레이어들 (겹침 방지 배열) - 클릭하면 전투/협력 선택 */}
        {spreadPlayers.map(player => (
          <Marker
            key={player.id}
            position={[player.spreadPosition.lat, player.spreadPosition.lng]}
            icon={createOtherPlayerIcon(player.guardian?.type, player.username)}
            eventHandlers={{
              click: () => {
                if (guardian) {
                  initiatePlayerEncounter(player)
                } else {
                  alert('먼저 수호신을 생성하세요!')
                }
              }
            }}
          />
        ))}

        {/* 다른 플레이어의 고정 수호신들 (겹침 방지 배열) - 클릭하면 공격 선택 */}
        {spreadFixedGuardians.map(fg => (
          <Marker
            key={`fixed-${fg.id}`}
            position={[fg.spreadPosition.lat, fg.spreadPosition.lng]}
            icon={createFixedGuardianIcon(fg.type, fg.owner)}
            eventHandlers={{
              click: () => {
                if (guardian) {
                  initiateFixedGuardianAttack(fg)
                } else {
                  alert('먼저 수호신을 생성하세요!')
                }
              }
            }}
          />
        ))}
      </MapContainer>

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

      <GuardianPanel />
      <TerritoryControls />
      <BattleModal />
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
  }
}
