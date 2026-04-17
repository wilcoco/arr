import { useGameStore } from '../stores/gameStore'

export default function TerritoryControls() {
  const {
    guardian,
    expandingTerritory,
    startTerritoryExpand,
    updateTerritoryRadius,
    confirmTerritory
  } = useGameStore()

  if (!guardian) return null

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
      <button style={styles.placeBtn}>
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
    gap: 8
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
    gap: 8
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
    padding: '10px',
    borderRadius: 6,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  cancelBtn: {
    flex: 1,
    background: '#ff4444',
    color: 'white',
    border: 'none',
    padding: '10px',
    borderRadius: 6,
    fontWeight: 'bold',
    cursor: 'pointer'
  }
}
