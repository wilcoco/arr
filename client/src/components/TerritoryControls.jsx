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
  // Lv별 해금된 클래스만 노출 (신규 유저 클래스 마비 방지). level.unlockedClasses는 서버에서 옴.
  const unlocked = level?.unlockedClasses || ['generic']
  const classKeys = towerClasses
    ? Object.keys(towerClasses).filter(k => unlocked.includes(k))
    : ['generic']

  // 방어계수 (levelTable.defenseCoef와 동일 공식): min(1.0, 100/r)
  const defenseCoef = expandingTerritory
    ? Math.min(1.0, 100 / Math.max(1, expandingTerritory.radius))
    : 1.0
  // 유지비 (levelTable.upkeepPerHour): 2×(r/100)^1.5
  const upkeepPerHour = expandingTerritory
    ? Math.max(1, Math.round(2 * Math.pow(expandingTerritory.radius / 100, 1.5)))
    : 0
  // 배치 비용: 30×√r + classCost
  const placementCost = expandingTerritory && towerClasses?.[selectedTowerClass]
    ? Math.round(30 * Math.sqrt(Math.max(50, expandingTerritory.radius))) + (towerClasses[selectedTowerClass].cost || 0)
    : 0
  const guardianPrd = guardian?.stats?.prd || 0
  const hourlyNet = Math.floor(guardianPrd * 0.5) - upkeepPerHour

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
    const defGauge = Math.round(defenseCoef * 5)  // 0~5 칸
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

        {/* 방어계수 게이지 — 큰 영역은 약함 */}
        <div style={styles.metric}>
          <span>방어력</span>
          <span style={styles.gauge}>
            {[1,2,3,4,5].map(i => (
              <span key={i} style={{
                ...styles.gaugeBar,
                background: i <= defGauge ? '#00ff88' : '#333'
              }}/>
            ))}
          </span>
          <span style={styles.metricVal}>×{defenseCoef.toFixed(2)}</span>
        </div>

        {/* 유지비/생산 수지 — 적자면 빨간색 */}
        <div style={styles.metric}>
          <span>시간당</span>
          <span style={{
            ...styles.metricVal, marginLeft: 'auto',
            color: hourlyNet >= 0 ? '#00ff88' : '#ff6666'
          }}>
            +{Math.floor(guardianPrd * 0.5)} − {upkeepPerHour} = {hourlyNet >= 0 ? '+' : ''}{hourlyNet} E
          </span>
        </div>
        {hourlyNet < 0 && (
          <div style={styles.warn}>
            ⚠ 적자 영역 — 자원 고갈 시 12h 후 약화, 48h 후 소멸. 수익형 보스/전투로 보충 필요.
          </div>
        )}

        <ClassPicker classKeys={classKeys} towerClasses={towerClasses}
                     selected={selectedTowerClass} onPick={setSelectedTowerClass} />

        {/* 잠긴 클래스 힌트 */}
        {classKeys.length < 13 && (
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
            🔒 {13 - classKeys.length}종 잠김 (Lv 올리면 해금)
          </div>
        )}

        {cls && (
          <div style={styles.classInfo}>
            {cls.label} · ATK {cls.baseDmg} · HP {cls.baseHp} · 사거리 {cls.range}m
            {cls.desc && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{cls.desc}</div>}
          </div>
        )}

        <div style={styles.costBar}>
          건설 비용: <b style={{ color: '#ffd700' }}>{placementCost} E</b>
        </div>

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
  },
  metric: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, marginBottom: 4
  },
  metricVal: { marginLeft: 'auto', fontWeight: 'bold' },
  gauge: { display: 'inline-flex', gap: 2 },
  gaugeBar: { width: 12, height: 8, borderRadius: 2 },
  warn: {
    background: 'rgba(255, 102, 102, 0.15)', color: '#ffaaaa',
    padding: '6px 8px', borderRadius: 6, fontSize: 11, marginBottom: 6
  },
  costBar: {
    textAlign: 'center', padding: '6px', marginTop: 6,
    background: 'rgba(255,255,255,0.05)', borderRadius: 4, fontSize: 13
  }
}
