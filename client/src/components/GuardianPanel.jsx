import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'

const GUARDIAN_TYPES = [
  { id: 'animal',   name: '동물형',  icon: '🦁', desc: '속도, 회복력 특화' },
  { id: 'robot',    name: '로봇형',  icon: '🤖', desc: '전투력, 방어력 특화' },
  { id: 'aircraft', name: '비행체형', icon: '✈️', desc: '사거리, 영역력 특화' }
]

const LAYER_CONFIG = {
  beginner: { label: '초심자', color: '#aaa', bg: '#333' },
  veteran:  { label: '베테랑', color: '#ffd700', bg: '#3a2800' }
}

// 졸업 조건: 전투 승리 5회 + 영역 3개
const GRAD_WINS  = 5
const GRAD_TERRS = 3

export default function GuardianPanel() {
  const {
    guardian,
    layer,
    battleWins,
    territories,
    energy,
    createGuardian
  } = useGameStore()

  const [showCreate, setShowCreate] = useState(false)
  const [selectedType, setSelectedType] = useState(null)
  const [expanded, setExpanded] = useState(false)

  if (guardian) {
    const lc = LAYER_CONFIG[layer] || LAYER_CONFIG.beginner
    const isBeginner = layer === 'beginner'
    const terrCount = territories.length
    const winsProgress  = Math.min(battleWins, GRAD_WINS)
    const terrsProgress = Math.min(terrCount,  GRAD_TERRS)
    const s = guardian.effectiveStats || guardian.stats
    const b = guardian.stats

    return (
      <div style={styles.panel}>
        {/* 레이어 배지 + 수호신 아이콘 */}
        <div style={styles.header} onClick={() => setExpanded(e => !e)}>
          <span style={{ fontSize: 22 }}>
            {guardian.type === 'animal' ? '🦁' : guardian.type === 'robot' ? '🤖' : '✈️'}
          </span>
          <span style={{ flex: 1, fontWeight: 'bold', fontSize: 13 }}>내 수호신</span>
          <span style={{ ...styles.layerBadge, color: lc.color, background: lc.bg }}>
            {lc.label}
          </span>
          <span style={{ fontSize: 10, color: '#888', marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
        </div>

        {/* 에너지 */}
        <div style={styles.energyRow}>
          <span style={{ fontSize: 11, color: '#aaa' }}>⚡ 에너지</span>
          <span style={{ fontSize: 11, color: '#00ff88', fontWeight: 'bold' }}>{energy}</span>
        </div>

        {/* 스탯 (기본 / 유효) */}
        <div style={styles.statsGrid}>
          {[
            ['ATK', b.atk, s.atk],
            ['DEF', b.def, s.def],
            ['HP',  b.hp,  s.hp],
            ['ABS', b.abs, s.abs],
            ['PRD', b.prd, s.prd],
            ['RNG', b.rng, s.rng]
          ].map(([name, base, eff]) => (
            <div key={name} style={styles.statCell}>
              <span style={{ color: '#888', fontSize: 10 }}>{name}</span>
              <span style={{ fontWeight: 'bold', fontSize: 12, color: eff > base ? '#00ff88' : 'white' }}>
                {eff}
                {eff > base && <span style={{ fontSize: 9, color: '#00ff88' }}> +{eff - base}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* 궁극기 충전 */}
        <div style={styles.ultRow}>
          <span style={{ fontSize: 10, color: '#aaa' }}>궁극기</span>
          <div style={styles.ultBar}>
            <div style={{ ...styles.ultFill, width: `${Math.min(b.ultCharge || 0, 100)}%` }} />
          </div>
          <span style={{ fontSize: 10, color: (b.ultCharge || 0) >= 100 ? '#ffd700' : '#aaa' }}>
            {b.ultCharge || 0}/100
          </span>
        </div>

        {/* 초심자 졸업 조건 (beginner만 표시) */}
        {isBeginner && expanded && (
          <div style={styles.gradSection}>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 6 }}>졸업 조건</div>
            <div style={styles.gradRow}>
              <span style={{ fontSize: 10 }}>전투 승리</span>
              <div style={styles.progressBar}>
                <div style={{ ...styles.progressFill, width: `${(winsProgress / GRAD_WINS) * 100}%` }} />
              </div>
              <span style={{ fontSize: 10, color: winsProgress >= GRAD_WINS ? '#00ff88' : 'white' }}>
                {winsProgress}/{GRAD_WINS}
              </span>
            </div>
            <div style={styles.gradRow}>
              <span style={{ fontSize: 10 }}>영역 확보</span>
              <div style={styles.progressBar}>
                <div style={{ ...styles.progressFill, width: `${(terrsProgress / GRAD_TERRS) * 100}%` }} />
              </div>
              <span style={{ fontSize: 10, color: terrsProgress >= GRAD_TERRS ? '#00ff88' : 'white' }}>
                {terrsProgress}/{GRAD_TERRS}
              </span>
            </div>
          </div>
        )}

        {/* 장착 파츠 요약 */}
        {expanded && guardian.equippedParts?.length > 0 && (
          <div style={styles.partsRow}>
            <span style={{ fontSize: 10, color: '#aaa', marginRight: 6 }}>장착 파츠:</span>
            {guardian.equippedParts.map(p => (
              <span key={p.id} style={styles.partBadge}>
                {SLOT_ICON[p.slot]} T{p.tier}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!showCreate) {
    return (
      <div style={styles.panel}>
        <button onClick={() => setShowCreate(true)} style={styles.createBtn}>
          수호신 생성하기
        </button>
      </div>
    )
  }

  return (
    <div style={styles.createPanel}>
      <h3 style={{ marginBottom: 16, textAlign: 'center' }}>수호신 타입 선택</h3>
      <div style={styles.typeList}>
        {GUARDIAN_TYPES.map(type => (
          <div
            key={type.id}
            onClick={() => setSelectedType(type.id)}
            style={{
              ...styles.typeCard,
              border: selectedType === type.id ? '2px solid #00ff88' : '2px solid #333'
            }}
          >
            <div style={{ fontSize: 32 }}>{type.icon}</div>
            <div style={{ fontWeight: 'bold', fontSize: 13 }}>{type.name}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{type.desc}</div>
          </div>
        ))}
      </div>
      {selectedType && (
        <button
          onClick={() => { createGuardian(selectedType, {}); setShowCreate(false) }}
          style={styles.confirmBtn}
        >
          생성 완료
        </button>
      )}
      <button onClick={() => setShowCreate(false)} style={styles.cancelBtn}>취소</button>
    </div>
  )
}

const SLOT_ICON = { head: '🪖', body: '🛡️', arms: '⚔️', legs: '👟', core: '⚙️' }

const styles = {
  panel: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    background: 'rgba(0,0,0,0.85)',
    padding: '12px 14px',
    borderRadius: 12,
    color: 'white',
    minWidth: 170,
    maxWidth: 200,
    zIndex: 1000,
    backdropFilter: 'blur(4px)'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    cursor: 'pointer'
  },
  layerBadge: {
    fontSize: 10,
    fontWeight: 'bold',
    padding: '2px 6px',
    borderRadius: 4
  },
  energyRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 4,
    marginBottom: 8
  },
  statCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    padding: '3px 0'
  },
  ultRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4
  },
  ultBar: {
    flex: 1,
    height: 6,
    background: '#333',
    borderRadius: 3,
    overflow: 'hidden'
  },
  ultFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #ffd700, #ff8800)',
    borderRadius: 3,
    transition: 'width 0.3s'
  },
  gradSection: {
    borderTop: '1px solid #333',
    paddingTop: 8,
    marginTop: 6
  },
  gradRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4
  },
  progressBar: {
    flex: 1,
    height: 6,
    background: '#333',
    borderRadius: 3,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    background: '#00ff88',
    borderRadius: 3,
    transition: 'width 0.3s'
  },
  partsRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
    borderTop: '1px solid #333',
    paddingTop: 6
  },
  partBadge: {
    background: '#1a3a2a',
    color: '#00ff88',
    fontSize: 10,
    padding: '2px 5px',
    borderRadius: 4
  },
  createBtn: {
    background: '#00ff88',
    color: 'black',
    border: 'none',
    padding: '12px 24px',
    borderRadius: 8,
    fontWeight: 'bold',
    cursor: 'pointer',
    width: '100%'
  },
  createPanel: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    background: 'rgba(0,0,0,0.92)',
    padding: 20,
    borderRadius: 12,
    color: 'white',
    zIndex: 1000
  },
  typeList: {
    display: 'flex',
    gap: 12,
    marginBottom: 16
  },
  typeCard: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    textAlign: 'center',
    cursor: 'pointer',
    background: '#111'
  },
  confirmBtn: {
    width: '100%',
    background: '#00ff88',
    color: 'black',
    border: 'none',
    padding: '12px',
    borderRadius: 8,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginBottom: 8
  },
  cancelBtn: {
    width: '100%',
    background: 'transparent',
    color: '#888',
    border: '1px solid #444',
    padding: '8px',
    borderRadius: 8,
    cursor: 'pointer'
  }
}
