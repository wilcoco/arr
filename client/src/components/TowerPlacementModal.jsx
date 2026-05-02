import { useState, useEffect } from 'react'
import { useGameStore } from '../stores/gameStore'
import { TowerSpriteSvg, CLASS_TINT } from '../art/TowerSprite'

const CLASS_LABELS_KO = {
  generic: '제네릭', balista: '발리스타', cannon: '대포', assault: '돌격', scifi: 'SF',
  fire: '화염', ice: '얼음', aqua: '아쿠아', electric: '전기', nature: '자연',
  venom: '독', arcane: '비전', crystal: '크리스탈'
}

const CLASS_DESC_KO = {
  generic: '시작용 균형',
  balista: '장거리 정찰형, 첫 발 +50%',
  cannon: '광역 폭격 30m',
  assault: '연사 속도 우위',
  scifi: '정밀 관통 사격',
  fire: '5초간 화상 도트',
  ice: '적 -30% 10초',
  aqua: '적 영역 5분 취약화',
  electric: '체인 추가 데미지',
  nature: '인접 타워 회복',
  venom: '30초 누적 독 도트',
  arcane: '영역 내 적 합성률 -10%',
  crystal: '동맹 시너지 +10%'
}

export default function TowerPlacementModal({ territoryId, onClose }) {
  const { towerClasses, fetchTowerClasses, placeTower, energy } = useGameStore()
  const [selectedClass, setSelectedClass] = useState('generic')
  const [selectedTier, setSelectedTier] = useState(1)
  const [placing, setPlacing] = useState(false)

  useEffect(() => { if (!towerClasses) fetchTowerClasses() }, [])

  if (!towerClasses) {
    return <div style={styles.overlay}><div style={styles.modal}>로딩...</div></div>
  }

  const cls = towerClasses[selectedClass]
  const stats = cls?.stats?.[selectedTier - 1]

  const handlePlace = async () => {
    setPlacing(true)
    const r = await placeTower(territoryId, selectedClass, selectedTier)
    setPlacing(false)
    if (r.success) onClose()
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={{ fontWeight: 'bold', fontSize: 16 }}>🏰 타워 배치</span>
          <span style={{ fontSize: 11, color: '#666' }}>에너지 {energy}</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {/* 13종 클래스 그리드 */}
        <div style={styles.classGrid}>
          {Object.keys(towerClasses).map(cKey => (
            <div
              key={cKey}
              onClick={() => setSelectedClass(cKey)}
              style={{
                ...styles.classCard,
                border: selectedClass === cKey ? `2px solid ${CLASS_TINT[cKey] || '#888'}` : '2px solid #333',
                background: selectedClass === cKey ? 'rgba(255,255,255,0.08)' : '#1a1a1a'
              }}
            >
              <TowerSpriteSvg towerClass={cKey} tier={1} size={40} />
              <div style={{ fontSize: 10, marginTop: 2 }}>{CLASS_LABELS_KO[cKey] || cKey}</div>
            </div>
          ))}
        </div>

        {/* 선택된 클래스 상세 */}
        {cls && stats && (
          <div style={styles.detailBox}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <TowerSpriteSvg towerClass={selectedClass} tier={selectedTier} size={56} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', fontSize: 15 }}>{CLASS_LABELS_KO[selectedClass]}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{CLASS_DESC_KO[selectedClass]}</div>
              </div>
            </div>

            {/* 레벨 선택 */}
            <div style={styles.tierRow}>
              {[1, 2, 3, 4, 5].map(t => (
                <button
                  key={t}
                  onClick={() => setSelectedTier(t)}
                  style={{
                    ...styles.tierBtn,
                    background: selectedTier === t ? '#ffd700' : '#222',
                    color: selectedTier === t ? 'black' : 'white',
                    fontWeight: 'bold'
                  }}
                >Lv{t}</button>
              ))}
            </div>

            {/* 스탯 표 */}
            <div style={styles.statsTable}>
              <div style={styles.statRow}>
                <span>데미지</span><span style={{ color: '#ff6644' }}>{stats.damage}</span>
              </div>
              <div style={styles.statRow}>
                <span>HP</span><span style={{ color: '#00ff88' }}>{stats.hp}</span>
              </div>
              <div style={styles.statRow}>
                <span>사거리</span><span>{stats.range}m</span>
              </div>
              <div style={styles.statRow}>
                <span>발사 속도</span><span>{stats.fireRateMs > 0 ? `${(stats.fireRateMs / 1000).toFixed(1)}s` : '-'}</span>
              </div>
              <div style={{ ...styles.statRow, borderTop: '1px solid #333', paddingTop: 6, marginTop: 4 }}>
                <span style={{ fontWeight: 'bold' }}>비용</span>
                <span style={{
                  fontWeight: 'bold',
                  color: energy >= stats.cost ? '#ffd700' : '#ff4444'
                }}>{stats.cost} 에너지</span>
              </div>
            </div>

            <button
              onClick={handlePlace}
              disabled={placing || energy < stats.cost}
              style={{
                ...styles.placeBtn,
                background: energy < stats.cost ? '#444' : 'linear-gradient(135deg, #ff8800, #cc4400)',
                cursor: energy < stats.cost ? 'not-allowed' : 'pointer'
              }}
            >
              {placing ? '배치 중...' : energy < stats.cost ? '에너지 부족' : `🏰 배치 (-${stats.cost})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  modal: { width: '100%', maxWidth: 500, maxHeight: '88vh', background: '#111', color: 'white', borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid #222' },
  closeBtn: { marginLeft: 'auto', background: 'transparent', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' },
  classGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, padding: 12, overflowY: 'auto', flex: '0 0 auto' },
  classCard: { padding: 4, borderRadius: 6, textAlign: 'center', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  detailBox: { padding: '8px 16px 16px', borderTop: '1px solid #222', overflowY: 'auto' },
  tierRow: { display: 'flex', gap: 4, marginBottom: 10 },
  tierBtn: { flex: 1, padding: '6px 0', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' },
  statsTable: { background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8, marginBottom: 10 },
  statRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' },
  placeBtn: { width: '100%', padding: '12px', border: 'none', borderRadius: 10, color: 'white', fontWeight: 'bold', fontSize: 15 }
}
