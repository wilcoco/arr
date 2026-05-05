import { useState, useEffect } from 'react'
import { useGameStore } from '../stores/gameStore'

// β 모델 — 영역 = 타워 1:1. "확장"은 사실상 새 타워 건설.
//   - 슬라이더 max는 사용자 레벨 cap (level.maxRadiusM, 없으면 안전한 500)
//   - 13종 타워 클래스 중 선택. 클래스 메타는 /api/towers/classes로 한번 페치.
export default function TerritoryControls() {
  const {
    guardian,
    territories,
    userLocation,
    expandingTerritory,
    startTerritoryExpand,
    updateTerritoryRadius,
    confirmTerritory,
    placeFixedGuardian,
    selectedTowerClass,
    setSelectedTowerClass,
    towerClasses,
    fetchTowerClasses,
    level
  } = useGameStore()

  const [showPlaceModal, setShowPlaceModal] = useState(false)

  useEffect(() => { if (!towerClasses) fetchTowerClasses() }, [])

  if (!guardian) return null

  const maxRadius = level?.maxRadiusM || 500
  const classKeys = towerClasses ? Object.keys(towerClasses) : ['generic']

  const handlePlaceGuardian = async () => {
    if (!userLocation) { alert('위치 정보 없음'); return }
    const result = await placeFixedGuardian(
      territories[0]?.id || null,
      userLocation.latitude,
      userLocation.longitude,
      null,  // β 모델에서 stats 분배 개념 없음
      'defense'
    )
    if (result?.success) {
      setShowPlaceModal(false)
    } else if (result?.error) {
      alert(result.error)
    }
  }

  if (showPlaceModal) {
    return (
      <div style={styles.modalPanel}>
        <h4 style={{ marginBottom: 16, textAlign: 'center' }}>새 타워 건설</h4>
        <div style={{ marginBottom: 12, fontSize: 13, color: '#aaa' }}>
          현재 위치 ({userLocation?.latitude?.toFixed(5)}, {userLocation?.longitude?.toFixed(5)})에<br/>
          반경 100m {selectedTowerClass} 타워를 건설합니다.
        </div>
        <ClassPicker classKeys={classKeys} towerClasses={towerClasses}
                     selected={selectedTowerClass} onPick={setSelectedTowerClass} />
        <div style={styles.buttons}>
          <button onClick={handlePlaceGuardian} style={styles.confirmBtn}>건설</button>
          <button onClick={() => setShowPlaceModal(false)} style={styles.cancelBtn}>취소</button>
        </div>
      </div>
    )
  }

  if (expandingTerritory) {
    const cls = towerClasses?.[selectedTowerClass]
    return (
      <div style={styles.panel}>
        <h4 style={{ marginBottom: 12 }}>새 영역(타워) 건설</h4>
        <div style={styles.radiusDisplay}>
          반경: {expandingTerritory.radius}m / cap {maxRadius}m
        </div>
        <input
          type="range" min="50" max={maxRadius}
          value={expandingTerritory.radius}
          onChange={(e) => updateTerritoryRadius(Number(e.target.value))}
          style={styles.slider}
        />
        <ClassPicker classKeys={classKeys} towerClasses={towerClasses}
                     selected={selectedTowerClass} onPick={setSelectedTowerClass} />
        {cls && (
          <div style={styles.classInfo}>
            {cls.label} · ATK {cls.baseDmg} · HP {cls.baseHp} · 사거리 {cls.range}m
            {cls.desc && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{cls.desc}</div>}
          </div>
        )}
        <div style={styles.buttons}>
          <button onClick={() => confirmTerritory()} style={styles.confirmBtn}>건설</button>
          <button
            onClick={() => useGameStore.setState({ expandingTerritory: null })}
            style={styles.cancelBtn}
          >취소</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.panel}>
      <button onClick={startTerritoryExpand} style={styles.expandBtn}>
        영역(타워) 건설
      </button>
      <button onClick={() => setShowPlaceModal(true)} style={styles.placeBtn}>
        현 위치에 즉시 건설
      </button>
      {level && (
        <div style={styles.levelHint}>
          Lv{level.level} {level.title || ''} · 영역 {territories.length}/{level.maxTowerCount || '?'}
        </div>
      )}
    </div>
  )
}

function ClassPicker({ classKeys, towerClasses, selected, onPick }) {
  if (!towerClasses) return <div style={{ color: '#888', fontSize: 12 }}>클래스 로딩 중...</div>
  return (
    <div style={styles.classGrid}>
      {classKeys.map(k => {
        const c = towerClasses[k]
        const active = selected === k
        return (
          <button key={k} onClick={() => onPick(k)}
            style={{
              ...styles.classBtn,
              background: active ? '#00ff88' : '#222',
              color: active ? 'black' : 'white',
              borderColor: active ? '#00ff88' : '#444'
            }}
            title={c?.desc || ''}>
            <div style={{ fontSize: 11 }}>{c?.label || k}</div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>{c?.cost || '?'}E</div>
          </button>
        )
      })}
    </div>
  )
}

const styles = {
  panel: {
    position: 'absolute', bottom: 20, right: 20,
    background: 'rgba(0,0,0,0.8)', padding: 16, borderRadius: 12,
    color: 'white', display: 'flex', flexDirection: 'column', gap: 8,
    zIndex: 1000, minWidth: 240, maxWidth: 320
  },
  modalPanel: {
    position: 'absolute', bottom: 20, left: 20, right: 20,
    background: 'rgba(0,0,0,0.95)', padding: 20, borderRadius: 12,
    color: 'white', zIndex: 1000
  },
  radiusDisplay: { textAlign: 'center', fontSize: 16, fontWeight: 'bold', color: '#00ff88' },
  slider: { width: '100%', margin: '12px 0' },
  buttons: { display: 'flex', gap: 8, marginTop: 12 },
  expandBtn: {
    background: '#00ff88', color: 'black', border: 'none',
    padding: '12px 24px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer'
  },
  placeBtn: {
    background: '#4488ff', color: 'white', border: 'none',
    padding: '10px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', fontSize: 13
  },
  confirmBtn: {
    flex: 1, background: '#00ff88', color: 'black', border: 'none',
    padding: '12px', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer'
  },
  cancelBtn: {
    flex: 1, background: '#ff4444', color: 'white', border: 'none',
    padding: '12px', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer'
  },
  levelHint: { textAlign: 'center', fontSize: 11, color: '#aaa', marginTop: 4 },
  classGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 8, marginBottom: 8
  },
  classBtn: {
    padding: '6px 4px', border: '1px solid #444', borderRadius: 4,
    cursor: 'pointer', fontSize: 11, lineHeight: 1.2, textAlign: 'center'
  },
  classInfo: {
    background: 'rgba(255,255,255,0.05)', padding: '8px 10px', borderRadius: 6,
    fontSize: 12, marginTop: 4
  }
}
