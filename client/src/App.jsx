import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useGameStore } from './stores/gameStore'
import GuardianPanel from './components/GuardianPanel'
import TerritoryControls from './components/TerritoryControls'
import BattleModal from './components/BattleModal'

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
    expandingTerritory,
    setUserLocation,
    setVisitorId,
    loadUserData,
    updateLocation
  } = useGameStore()

  // 초기 데이터 로드 (visitorId가 있을 때만)
  useEffect(() => {
    if (visitorId) {
      loadUserData()
    }
  }, [visitorId])

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

        {/* 다른 플레이어들 */}
        {nearbyPlayers && nearbyPlayers.map(player => (
          <Marker
            key={player.id}
            position={[player.location.lat, player.location.lng]}
            icon={createOtherPlayerIcon(player.guardian?.type, player.username)}
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
