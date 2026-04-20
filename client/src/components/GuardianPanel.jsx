import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'

const GUARDIAN_TYPES = [
  { id: 'animal', name: '동물형', icon: '🦁', desc: '속도, 회복력 특화' },
  { id: 'robot', name: '로봇형', icon: '🤖', desc: '전투력, 방어력 특화' },
  { id: 'aircraft', name: '비행체형', icon: '✈️', desc: '사거리, 영역력 특화' }
]

export default function GuardianPanel() {
  const { guardian, createGuardian } = useGameStore()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedType, setSelectedType] = useState(null)

  if (guardian) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={{ fontSize: 24 }}>
            {guardian.type === 'animal' ? '🦁' :
             guardian.type === 'robot' ? '🤖' : '✈️'}
          </span>
          <span>내 수호신</span>
        </div>
        <div style={styles.stats}>
          <div>ATK: {guardian.stats.atk}</div>
          <div>DEF: {guardian.stats.def}</div>
          <div>HP: {guardian.stats.hp}</div>
          <div>ABS: {guardian.stats.abs}</div>
          <div>PRD: {guardian.stats.prd}</div>
        </div>
      </div>
    )
  }

  if (!showCreate) {
    return (
      <div style={styles.panel}>
        <button
          onClick={() => setShowCreate(true)}
          style={styles.createBtn}
        >
          수호신 생성하기
        </button>
      </div>
    )
  }

  return (
    <div style={styles.createPanel}>
      <h3 style={{ marginBottom: 16 }}>수호신 타입 선택</h3>
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
            <div style={{ fontWeight: 'bold' }}>{type.name}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{type.desc}</div>
          </div>
        ))}
      </div>
      {selectedType && (
        <button
          onClick={() => {
            createGuardian(selectedType, {})
            setShowCreate(false)
          }}
          style={styles.confirmBtn}
        >
          생성 완료
        </button>
      )}
    </div>
  )
}

const styles = {
  panel: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    background: 'rgba(0,0,0,0.8)',
    padding: 16,
    borderRadius: 12,
    color: 'white',
    minWidth: 150,
    zIndex: 1000
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12
  },
  stats: {
    fontSize: 12,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4
  },
  createBtn: {
    background: '#00ff88',
    color: 'black',
    border: 'none',
    padding: '12px 24px',
    borderRadius: 8,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  createPanel: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    background: 'rgba(0,0,0,0.9)',
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
    padding: 16,
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
    cursor: 'pointer'
  }
}
