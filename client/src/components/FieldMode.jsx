import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../stores/gameStore'
import TowerPlacementModal from './TowerPlacementModal'

// 거리/방위 계산 — 미터 + 도(0=북, 시계방향)
function distMeters(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const sa = Math.sin(dLat/2)**2 +
             Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2
  return 2 * R * Math.asin(Math.sqrt(sa))
}
function bearing(a, b) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat))
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
            Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// 야전 모드 — 카메라 배경 + HUD 컨트롤 + AR 보너스 활성
export default function FieldMode({ onClose }) {
  const {
    userLocation,
    nearbyFixedGuardians,
    nearbyPlayers,
    territories,
    initiateFixedGuardianAttack,
    initiatePlayerEncounter,
    startTerritoryExpand,
    setArMode,
    slotGrants,
    showToast
  } = useGameStore()

  const videoRef = useRef(null)
  const [heading, setHeading] = useState(0) // 디바이스 방향(deg)
  const [cameraOn, setCameraOn] = useState(true)
  const [activeTab, setActiveTab] = useState('threat') // threat | grant
  // AR 내부 타워 배치
  const [arPlacement, setArPlacement] = useState(null) // { territoryId, grant }
  const [showTerritoryPicker, setShowTerritoryPicker] = useState(false)
  const myFixedGuardians = useGameStore(s => s.myFixedGuardians)

  // AR 모드 플래그 켜기 / 끄기
  useEffect(() => {
    setArMode(true)
    return () => setArMode(false)
  }, [])

  // 후면 카메라 활성화
  useEffect(() => {
    if (!cameraOn) return
    let stream
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false
        })
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch (e) {
        console.warn('camera unavailable', e)
        setCameraOn(false)
      }
    })()
    return () => { if (stream) stream.getTracks().forEach(t => t.stop()) }
  }, [cameraOn])

  // 디바이스 방향 (compass)
  useEffect(() => {
    const onOrient = (e) => {
      const h = (e.webkitCompassHeading != null) ? e.webkitCompassHeading
              : (e.alpha != null) ? (360 - e.alpha) : 0
      setHeading(h)
    }
    window.addEventListener('deviceorientation', onOrient, true)
    // iOS 13+ 권한 요청
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().catch(() => {})
    }
    return () => window.removeEventListener('deviceorientation', onOrient, true)
  }, [])

  // 가까운 위협(적 타워/플레이어) 정렬
  const me = userLocation ? { lat: userLocation.latitude, lng: userLocation.longitude } : null
  const threats = me ? [
    ...(nearbyFixedGuardians || []).map(fg => ({
      kind: 'tower', id: fg.id, label: `${fg.owner} L${fg.tier}`,
      lat: fg.position?.lat, lng: fg.position?.lng,
      onTap: () => initiateFixedGuardianAttack(fg),
      icon: '🏰', color: '#ff6644'
    })),
    ...(nearbyPlayers || []).map(p => ({
      kind: 'player', id: p.id, label: p.username,
      lat: p.location?.lat, lng: p.location?.lng,
      onTap: () => initiatePlayerEncounter(p),
      icon: '👤', color: '#ffaa44'
    }))
  ].filter(t => t.lat != null)
    .map(t => ({ ...t, dist: distMeters(me, { lat: t.lat, lng: t.lng }) }))
    .sort((a, b) => a.dist - b.dist) : []

  const nearestThreat = threats[0]

  // 발판 grant 가까운 순
  const myLoc = me
  const grants = (slotGrants || []).map(g => ({
    ...g, dist: myLoc ? distMeters(myLoc, g.position) : 9999
  })).sort((a, b) => a.dist - b.dist)

  // 배치 — 영역 1개면 즉시 열기, 여러개면 picker
  const placeNearest = () => {
    if (!me || !territories?.length) {
      showToast('영역이 없습니다 — 먼저 확장하세요', 'error')
      return
    }
    if (territories.length === 1) {
      setArPlacement({ territoryId: territories[0].id, grant: null })
    } else {
      setShowTerritoryPicker(true)
    }
  }

  const pickTerritory = (t) => {
    setArPlacement({ territoryId: t.id, grant: null })
    setShowTerritoryPicker(false)
  }

  const useGrant = (g) => {
    setArPlacement({ territoryId: g.territoryId, grant: g })
  }

  const expandHere = () => {
    startTerritoryExpand()
    showToast('🏗 영역 확장 — 슬라이더로 반경 조정 후 확정', 'info')
    onClose()
  }

  const arrowAngle = nearestThreat && me
    ? (bearing(me, { lat: nearestThreat.lat, lng: nearestThreat.lng }) - heading + 360) % 360
    : null

  return (
    <div style={styles.overlay}>
      {/* 카메라 배경 */}
      {cameraOn && (
        <video
          ref={videoRef}
          autoPlay playsInline muted
          style={styles.video}
        />
      )}
      {!cameraOn && <div style={styles.fallbackBg}>📷 카메라 사용 불가 — 야전 모드 HUD만 표시</div>}

      {/* HUD 상단 */}
      <div style={styles.hudTop}>
        <button onClick={onClose} style={styles.backBtn}>← 맵으로</button>
        <div style={styles.hudBadge}>
          <span>🎯 야전</span>
          <span style={{ marginLeft: 8, color: '#ff6644', fontWeight: 'bold' }}>ATK ×1.20</span>
        </div>
        <button onClick={onClose} style={styles.closeBtn}>✕ 종료</button>
      </div>

      {/* 컴패스 + 가장 가까운 위협 */}
      {nearestThreat ? (
        <div style={styles.compassBox}>
          <div style={styles.compassRing}>
            <div style={{
              ...styles.compassArrow,
              transform: `rotate(${arrowAngle}deg)`
            }}>▲</div>
            <div style={styles.compassN}>N</div>
          </div>
          <div style={styles.threatLabel}>
            <span style={{ fontSize: 30, marginRight: 8 }}>{nearestThreat.icon}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 'bold' }}>{nearestThreat.label}</div>
              <div style={{ fontSize: 11, color: '#aaa' }}>
                {Math.round(nearestThreat.dist)}m · {nearestThreat.kind === 'tower' ? '타워' : '플레이어'}
              </div>
            </div>
          </div>
          <button onClick={nearestThreat.onTap} style={styles.attackBtn}>
            ⚔ 공격 (×1.20)
          </button>
        </div>
      ) : (
        <div style={styles.emptyBox}>
          <div style={{ fontSize: 13, color: '#888' }}>주변에 위협 없음</div>
        </div>
      )}

      {/* 위협 리스트 (스크롤) */}
      {threats.length > 1 && (
        <div style={styles.threatList}>
          {threats.slice(1, 6).map(t => (
            <div key={t.id} onClick={t.onTap} style={styles.threatItem}>
              <span>{t.icon}</span>
              <span style={{ flex: 1, fontSize: 12 }}>{t.label}</span>
              <span style={{ fontSize: 11, color: '#aaa' }}>{Math.round(t.dist)}m</span>
            </div>
          ))}
        </div>
      )}

      {/* 발판 grant 배너 */}
      {grants.length > 0 && (
        <div style={styles.grantList}>
          <div style={{ fontSize: 11, color: '#ffaa66', marginBottom: 4 }}>🗡 발판 ({grants.length}개)</div>
          {grants.slice(0, 2).map(g => {
            const min = Math.floor(g.secondsRemaining / 60)
            const sec = g.secondsRemaining % 60
            return (
              <div key={g.id} onClick={() => useGrant(g)} style={styles.grantItem}>
                <span style={{ flex: 1 }}>{g.ownerName} 영역 · {Math.round(g.dist)}m</span>
                <span style={{ color: '#ffd700' }}>{min}:{String(sec).padStart(2, '0')}</span>
                <span style={{ color: '#00ff88', marginLeft: 6 }}>건설</span>
              </div>
            )
          })}
        </div>
      )}

      {/* 액션 바 */}
      <div style={styles.actionBar}>
        <button onClick={expandHere} style={styles.actionBtn}>
          <div style={{ fontSize: 22 }}>🏗</div>
          <div style={{ fontSize: 11 }}>영역 확장</div>
        </button>
        <button onClick={placeNearest} style={styles.actionBtn}>
          <div style={{ fontSize: 22 }}>🏰</div>
          <div style={{ fontSize: 11 }}>타워 배치</div>
        </button>
        <button onClick={() => setCameraOn(!cameraOn)} style={styles.actionBtn}>
          <div style={{ fontSize: 22 }}>{cameraOn ? '📷' : '🚫'}</div>
          <div style={{ fontSize: 11 }}>{cameraOn ? '카메라 OFF' : '카메라 ON'}</div>
        </button>
      </div>

      {/* 영역 선택 — 여러 영역 있을 때 */}
      {showTerritoryPicker && (
        <div style={styles.pickerOverlay} onClick={() => setShowTerritoryPicker(false)}>
          <div style={styles.pickerBox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>어느 영역에 배치?</div>
            {territories.map(t => {
              const d = me ? distMeters(me, t.center) : 0
              const towerCount = (myFixedGuardians || []).filter(fg => fg.territoryId === t.id).length
              return (
                <div key={t.id} onClick={() => pickTerritory(t)} style={styles.pickerItem}>
                  <span style={{ flex: 1 }}>반경 {Math.round(t.radius)}m · {Math.round(d)}m 거리</span>
                  <span style={{ color: towerCount >= 3 ? '#ff4444' : '#00ff88' }}>
                    {towerCount}/3
                  </span>
                </div>
              )
            })}
            <button onClick={() => setShowTerritoryPicker(false)} style={styles.pickerCancel}>
              취소
            </button>
          </div>
        </div>
      )}

      {/* AR 내부 타워 배치 모달 — z-index 6000으로 카메라 위에 */}
      {arPlacement && (
        <TowerPlacementModal
          territoryId={arPlacement.territoryId}
          existingTowers={(myFixedGuardians || []).filter(fg => fg.territoryId === arPlacement.territoryId)}
          grant={arPlacement.grant}
          onClose={() => setArPlacement(null)}
        />
      )}
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: '#000', zIndex: 5000,
    color: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden'
  },
  video: {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    objectFit: 'cover', zIndex: 0
  },
  fallbackBg: {
    position: 'absolute', inset: 0,
    background: 'linear-gradient(180deg, #001a33, #000)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#666', fontSize: 14
  },
  hudTop: {
    position: 'relative', zIndex: 10, display: 'flex',
    justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px',
    background: 'linear-gradient(180deg, rgba(0,0,0,0.8), transparent)'
  },
  hudBadge: {
    background: 'rgba(0,0,0,0.6)', padding: '6px 12px', borderRadius: 20,
    border: '1px solid #333', fontSize: 13
  },
  closeBtn: {
    background: '#ff4444', color: 'white', border: '2px solid white',
    padding: '12px 20px', borderRadius: 24, fontSize: 16,
    cursor: 'pointer', fontWeight: 'bold',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
  },
  backBtn: {
    background: 'rgba(0,0,0,0.7)', color: 'white', border: '1px solid #888',
    padding: '12px 18px', borderRadius: 24, fontSize: 15,
    cursor: 'pointer', fontWeight: 'bold'
  },
  compassBox: {
    position: 'relative', zIndex: 10, margin: '24px 16px 0',
    background: 'rgba(0,0,0,0.65)', borderRadius: 14,
    padding: 14, border: '1px solid #444',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
  },
  compassRing: {
    width: 110, height: 110, borderRadius: '50%',
    border: '3px solid #00ff88', position: 'relative',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 0 20px rgba(0,255,136,0.4)'
  },
  compassArrow: {
    fontSize: 36, color: '#ff6644', transformOrigin: 'center',
    filter: 'drop-shadow(0 0 8px #ff0044)'
  },
  compassN: {
    position: 'absolute', top: -8, fontSize: 11,
    color: '#00ff88', fontWeight: 'bold',
    background: '#000', padding: '0 4px', borderRadius: 3
  },
  threatLabel: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  attackBtn: {
    width: '100%', background: 'linear-gradient(180deg,#ff4444,#cc0000)',
    color: 'white', border: 'none', padding: '14px', borderRadius: 10,
    fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(255,0,0,0.5)'
  },
  emptyBox: {
    position: 'relative', zIndex: 10, margin: '40px 16px',
    padding: 20, textAlign: 'center',
    background: 'rgba(0,0,0,0.6)', borderRadius: 12, border: '1px solid #333'
  },
  threatList: {
    position: 'relative', zIndex: 10, margin: '12px 16px 0',
    background: 'rgba(0,0,0,0.55)', borderRadius: 10,
    padding: 8, maxHeight: 150, overflowY: 'auto', border: '1px solid #333'
  },
  threatItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 8px', cursor: 'pointer', borderRadius: 6
  },
  grantList: {
    position: 'relative', zIndex: 10, margin: '10px 16px 0',
    background: 'rgba(204,34,0,0.3)', borderRadius: 10,
    padding: 8, border: '1px solid #cc4400'
  },
  grantItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 8px', cursor: 'pointer', borderRadius: 6,
    fontSize: 11, background: 'rgba(0,0,0,0.4)', marginTop: 4
  },
  actionBar: {
    position: 'relative', zIndex: 10, marginTop: 'auto',
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
    padding: 16,
    background: 'linear-gradient(0deg, rgba(0,0,0,0.85), transparent)'
  },
  actionBtn: {
    background: 'rgba(0,0,0,0.7)', color: 'white',
    border: '1px solid #555', borderRadius: 10,
    padding: '10px 4px', cursor: 'pointer'
  },
  pickerOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 7000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
  },
  pickerBox: {
    background: '#111', color: 'white', border: '1px solid #444',
    borderRadius: 12, padding: 16, width: '100%', maxWidth: 360
  },
  pickerItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
    background: '#1a1a1a', marginBottom: 6, fontSize: 13
  },
  pickerCancel: {
    background: 'transparent', color: '#888', border: '1px solid #333',
    padding: '8px', borderRadius: 8, cursor: 'pointer', width: '100%',
    fontSize: 12, marginTop: 4
  }
}
