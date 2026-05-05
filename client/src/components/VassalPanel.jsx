import { useEffect, useState } from 'react'
import { useGameStore } from '../stores/gameStore'

// 속국 패널 — 들어온 제안(lord) + 활성 계약(양측) + 새 제안(intruder)
export default function VassalPanel({ onClose }) {
  const {
    vassalIncoming, vassalActive, fetchVassalIncoming, fetchVassalActive,
    acceptVassal, rejectVassal, dissolveVassal,
    proposeVassal, userId, userLocation,
    nearbyTerritories, towerClasses, fetchTowerClasses, level, selectedTowerClass
  } = useGameStore()

  const [tab, setTab] = useState('incoming')
  const [proposeRadius, setProposeRadius] = useState(100)
  const [proposeTribute, setProposeTribute] = useState(30)
  const [proposeClass, setProposeClass] = useState('generic')
  const [selectedHostTerritory, setSelectedHostTerritory] = useState(null)

  useEffect(() => {
    fetchVassalIncoming()
    fetchVassalActive()
    if (!towerClasses) fetchTowerClasses()
  }, [])

  const maxRadius = level?.maxRadiusM || 500

  // 현재 위치가 안에 들어가 있는 남의 영역들 (협력 제안 대상)
  const candidateHosts = (nearbyTerritories || []).filter(t => {
    if (!userLocation || t.userId === userId) return false
    const dLat = (t.center?.lat - userLocation.latitude) * 111000
    const dLng = (t.center?.lng - userLocation.longitude) * 88700
    return Math.sqrt(dLat * dLat + dLng * dLng) < (t.radius || 0)
  })

  const handlePropose = async () => {
    if (!selectedHostTerritory || !userLocation) return
    const result = await proposeVassal(
      selectedHostTerritory.id,
      userLocation.latitude, userLocation.longitude,
      proposeRadius, proposeClass, proposeTribute
    )
    if (result?.success) setTab('active')
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0 }}>🤝 속국 계약</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.tabs}>
          <TabBtn active={tab === 'incoming'} onClick={() => setTab('incoming')}>
            받은 제안 {vassalIncoming?.length ? `(${vassalIncoming.length})` : ''}
          </TabBtn>
          <TabBtn active={tab === 'active'} onClick={() => setTab('active')}>
            활성 계약 {vassalActive?.length ? `(${vassalActive.length})` : ''}
          </TabBtn>
          <TabBtn active={tab === 'propose'} onClick={() => setTab('propose')}>
            제안 보내기
          </TabBtn>
        </div>

        {tab === 'incoming' && (
          <div style={styles.list}>
            {(!vassalIncoming || vassalIncoming.length === 0) ? (
              <div style={styles.empty}>받은 제안이 없습니다</div>
            ) : vassalIncoming.map(p => (
              <div key={p.contractId} style={styles.card}>
                <div><b>{p.vassalName}</b> 가 영역 안에 정착 요청</div>
                <div style={styles.meta}>
                  반경 {p.proposedRadiusM}m · {p.proposedTowerClass} ·
                  조공 <b style={{ color: '#ffd700' }}>{p.tributeToLordPct}%</b>
                </div>
                <div style={styles.actions}>
                  <button onClick={() => acceptVassal(p.contractId)} style={styles.acceptBtn}>수락</button>
                  <button onClick={() => rejectVassal(p.contractId)} style={styles.rejectBtn}>거절</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'active' && (
          <div style={styles.list}>
            {(!vassalActive || vassalActive.length === 0) ? (
              <div style={styles.empty}>활성 계약이 없습니다</div>
            ) : vassalActive.map(c => (
              <div key={c.contractId} style={styles.card}>
                <div>
                  {c.role === 'vassal'
                    ? <>👇 나는 <b>{c.lordName}</b>의 속국</>
                    : <>👆 <b>{c.vassalName}</b>가 내 속국</>}
                </div>
                <div style={styles.meta}>
                  조공률 {c.tributeToLordPct}% ·
                  누적 <b style={{ color: '#ffd700' }}>{c.tributeTotal || 0} E</b>
                  {c.role === 'vassal' ? ' 지불' : ' 수령'}
                </div>
                <button onClick={() => dissolveVassal(c.contractId)} style={styles.rejectBtn}>해제</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'propose' && (
          <div style={{ padding: 12 }}>
            {candidateHosts.length === 0 ? (
              <div style={styles.empty}>
                협력 제안할 영역이 없습니다.<br/>
                <span style={{ fontSize: 11 }}>다른 플레이어 영역 안에 들어가야 합니다.</span>
              </div>
            ) : (
              <>
                <div style={styles.label}>대상 영역:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                  {candidateHosts.map(t => (
                    <button key={t.id}
                      onClick={() => setSelectedHostTerritory(t)}
                      style={{
                        ...styles.hostBtn,
                        background: selectedHostTerritory?.id === t.id ? '#00ff88' : '#222',
                        color: selectedHostTerritory?.id === t.id ? 'black' : 'white'
                      }}>
                      {t.username || '?'} 영역 (반경 {t.radius}m)
                    </button>
                  ))}
                </div>

                <div style={styles.label}>내 영역 반경: {proposeRadius}m / cap {maxRadius}m</div>
                <input type="range" min="50" max={Math.min(maxRadius, selectedHostTerritory?.radius || maxRadius)}
                  value={proposeRadius} onChange={e => setProposeRadius(Number(e.target.value))}
                  style={styles.slider} />

                <div style={styles.label}>
                  조공률: <b style={{
                    color: proposeTribute < 20 ? '#ff8888' : proposeTribute > 60 ? '#ffd700' : '#00ff88'
                  }}>{proposeTribute}%</b>
                  <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>
                    {proposeTribute < 20 && '— 거절 가능성↑'}
                    {proposeTribute >= 20 && proposeTribute <= 40 && '— 표준 (권장)'}
                    {proposeTribute > 40 && proposeTribute <= 60 && '— 후한 편'}
                    {proposeTribute > 60 && '— 매우 후함, 영주 우대'}
                  </span>
                </div>
                <input type="range" min="0" max="100"
                  value={proposeTribute} onChange={e => setProposeTribute(Number(e.target.value))}
                  style={styles.slider} />
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>
                  내 시간당 생산의 {proposeTribute}%가 영주에게 자동 이전됩니다.
                  대가로 영주의 보호(같은 영역 내 적 자동 협공)와 안정 점유.
                </div>

                <div style={styles.label}>타워 클래스:</div>
                <select value={proposeClass} onChange={e => setProposeClass(e.target.value)}
                  style={styles.select}>
                  {Object.keys(towerClasses || { generic: {} }).map(k => (
                    <option key={k} value={k}>{towerClasses?.[k]?.label || k}</option>
                  ))}
                </select>

                <button onClick={handlePropose}
                  disabled={!selectedHostTerritory}
                  style={{
                    ...styles.acceptBtn, width: '100%', marginTop: 12,
                    opacity: selectedHostTerritory ? 1 : 0.4
                  }}>
                  제안 보내기
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        flex: 1, padding: '10px', border: 'none',
        background: active ? '#00ff88' : '#222',
        color: active ? 'black' : 'white',
        cursor: 'pointer', fontWeight: 'bold', fontSize: 13
      }}>{children}</button>
  )
}

const styles = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.7)', zIndex: 2000,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  panel: {
    background: '#1a1a1a', color: 'white', borderRadius: 12,
    width: '90%', maxWidth: 480, maxHeight: '80vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden'
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid #333'
  },
  closeBtn: {
    background: 'none', border: 'none', color: 'white',
    fontSize: 20, cursor: 'pointer'
  },
  tabs: { display: 'flex', borderBottom: '1px solid #333' },
  list: { padding: 12, overflowY: 'auto', flex: 1 },
  empty: { textAlign: 'center', color: '#888', padding: 20 },
  card: {
    background: '#222', padding: 12, borderRadius: 8,
    marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6
  },
  meta: { fontSize: 12, color: '#aaa' },
  actions: { display: 'flex', gap: 6 },
  acceptBtn: {
    flex: 1, background: '#00ff88', color: 'black',
    border: 'none', padding: 10, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer'
  },
  rejectBtn: {
    flex: 1, background: '#ff4444', color: 'white',
    border: 'none', padding: 10, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer'
  },
  label: { marginBottom: 4, fontSize: 13, color: '#ccc' },
  slider: { width: '100%', marginBottom: 8 },
  hostBtn: {
    padding: '8px 12px', border: '1px solid #444', borderRadius: 6,
    cursor: 'pointer', textAlign: 'left'
  },
  select: {
    width: '100%', padding: '8px', background: '#222', color: 'white',
    border: '1px solid #444', borderRadius: 6
  }
}
