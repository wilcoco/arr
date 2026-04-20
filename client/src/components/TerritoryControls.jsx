import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'

export default function TerritoryControls() {
  const {
    guardian,
    territories,
    userLocation,
    expandingTerritory,
    startTerritoryExpand,
    updateTerritoryRadius,
    confirmTerritory,
    placeFixedGuardian
  } = useGameStore()

  const [showPlaceModal, setShowPlaceModal] = useState(false)
  const [placeStats, setPlaceStats] = useState({ atk: 5, def: 5, hp: 20 })
  const [guardianType, setGuardianType] = useState('defense')

  if (!guardian) return null

  // 고정 수호신 배치 처리
  const handlePlaceGuardian = async () => {
    if (territories.length === 0) {
      alert('먼저 영역을 확장하세요!')
      return
    }

    const result = await placeFixedGuardian(
      territories[0].id,
      userLocation.latitude,
      userLocation.longitude,
      placeStats,
      guardianType
    )

    if (result?.success) {
      alert('고정 수호신 배치 완료!')
      setShowPlaceModal(false)
    } else {
      alert(result?.error || '배치 실패')
    }
  }

  if (showPlaceModal) {
    return (
      <div style={styles.modalPanel}>
        <h4 style={{ marginBottom: 16, textAlign: 'center' }}>고정 수호신 배치</h4>

        <div style={styles.statContainer}>
          <div style={styles.statItem}>
            <div style={styles.statLabel}>ATK</div>
            <input
              type="range"
              min="1"
              max={guardian.stats?.atk || 10}
              value={placeStats.atk}
              onChange={(e) => setPlaceStats({...placeStats, atk: Number(e.target.value)})}
              style={styles.statSlider}
            />
            <div style={styles.statValue}>{placeStats.atk}</div>
          </div>

          <div style={styles.statItem}>
            <div style={styles.statLabel}>DEF</div>
            <input
              type="range"
              min="1"
              max={guardian.stats?.def || 10}
              value={placeStats.def}
              onChange={(e) => setPlaceStats({...placeStats, def: Number(e.target.value)})}
              style={styles.statSlider}
            />
            <div style={styles.statValue}>{placeStats.def}</div>
          </div>

          <div style={styles.statItem}>
            <div style={styles.statLabel}>HP</div>
            <input
              type="range"
              min="1"
              max={guardian.stats?.hp || 50}
              value={placeStats.hp}
              onChange={(e) => setPlaceStats({...placeStats, hp: Number(e.target.value)})}
              style={styles.statSlider}
            />
            <div style={styles.statValue}>{placeStats.hp}</div>
          </div>
        </div>

        <div style={styles.typeSelect}>
          <button
            onClick={() => setGuardianType('defense')}
            style={{
              ...styles.typeBtn,
              background: guardianType === 'defense' ? '#00ff88' : '#333',
              color: guardianType === 'defense' ? 'black' : 'white'
            }}
          >
            🛡️ 방어형
          </button>
          <button
            onClick={() => setGuardianType('production')}
            style={{
              ...styles.typeBtn,
              background: guardianType === 'production' ? '#ffd700' : '#333',
              color: guardianType === 'production' ? 'black' : 'white'
            }}
          >
            💰 생산형
          </button>
        </div>

        <div style={styles.buttons}>
          <button onClick={handlePlaceGuardian} style={styles.confirmBtn}>
            배치
          </button>
          <button onClick={() => setShowPlaceModal(false)} style={styles.cancelBtn}>
            취소
          </button>
        </div>
      </div>
    )
  }

  if (expandingTerritory) {
    return (
      <div style={styles.panel}>
        <h4 style={{ marginBottom: 12 }}>영역 확장 중...</h4>
        <div style={styles.radiusDisplay}>
          반경: {expandingTerritory.radius}m
        </div>
        <input
          type="range"
          min="10"
          max="500"
          value={expandingTerritory.radius}
          onChange={(e) => updateTerritoryRadius(Number(e.target.value))}
          style={styles.slider}
        />
        <div style={styles.buttons}>
          <button onClick={confirmTerritory} style={styles.confirmBtn}>
            확정
          </button>
          <button
            onClick={() => useGameStore.setState({ expandingTerritory: null })}
            style={styles.cancelBtn}
          >
            취소
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.panel}>
      <button onClick={startTerritoryExpand} style={styles.expandBtn}>
        영역 확장
      </button>
      <button onClick={() => setShowPlaceModal(true)} style={styles.placeBtn}>
        고정 수호신 배치
      </button>
    </div>
  )
}

const styles = {
  panel: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    background: 'rgba(0,0,0,0.8)',
    padding: 16,
    borderRadius: 12,
    color: 'white',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    zIndex: 1000,
    minWidth: 160
  },
  modalPanel: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    background: 'rgba(0,0,0,0.95)',
    padding: 20,
    borderRadius: 12,
    color: 'white',
    zIndex: 1000
  },
  radiusDisplay: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00ff88'
  },
  slider: {
    width: '100%',
    margin: '12px 0'
  },
  buttons: {
    display: 'flex',
    gap: 8,
    marginTop: 12
  },
  expandBtn: {
    background: '#00ff88',
    color: 'black',
    border: 'none',
    padding: '12px 24px',
    borderRadius: 8,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  placeBtn: {
    background: '#4488ff',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: 8,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  confirmBtn: {
    flex: 1,
    background: '#00ff88',
    color: 'black',
    border: 'none',
    padding: '12px',
    borderRadius: 6,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  cancelBtn: {
    flex: 1,
    background: '#ff4444',
    color: 'white',
    border: 'none',
    padding: '12px',
    borderRadius: 6,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  statContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    marginBottom: 16
  },
  statItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12
  },
  statLabel: {
    width: 40,
    fontWeight: 'bold',
    color: '#00ff88'
  },
  statSlider: {
    flex: 1,
    height: 8
  },
  statValue: {
    width: 30,
    textAlign: 'right',
    fontWeight: 'bold'
  },
  typeSelect: {
    display: 'flex',
    gap: 12,
    marginBottom: 8
  },
  typeBtn: {
    flex: 1,
    padding: '12px',
    border: 'none',
    borderRadius: 8,
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: 14
  }
}
