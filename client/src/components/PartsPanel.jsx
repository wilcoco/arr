import { useState, useEffect } from 'react'
import { useGameStore } from '../stores/gameStore'

const SLOT_LABELS = { head: '헤드', body: '바디', arms: '암즈', legs: '레그', core: '코어' }
const SLOT_ICONS  = { head: '🪖', body: '🛡️', arms: '⚔️', legs: '👟', core: '⚙️' }
const TIER_STARS  = (t) => '★'.repeat(t) + '☆'.repeat(5 - t)
const TIER_COLOR  = ['', '#aaa', '#4fc', '#a78bfa', '#f59e0b', '#f43f5e']
const COMBINE_RATES = { 1: 70, 2: 55, 3: 40, 4: 25 }

export default function PartsPanel({ onClose }) {
  const { parts, fetchParts, equipPart, unequipPart, combineParts, userId } = useGameStore()
  const [selected, setSelected]       = useState([])
  const [combineResult, setCombineResult] = useState(null)
  const [filter, setFilter]           = useState('all')
  const [busy, setBusy]               = useState(false)

  useEffect(() => { fetchParts() }, [])

  const slots = ['head', 'body', 'arms', 'legs', 'core']
  const filtered = filter === 'all' ? parts : parts.filter(p => p.slot === filter)

  const toggleSelect = (id) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 3 ? [...prev, id] : prev
    )
  }

  const handleEquip = async (part) => {
    setBusy(true)
    if (part.equipped) await unequipPart(part.id)
    else               await equipPart(part.id)
    setBusy(false)
  }

  const handleCombine = async () => {
    if (selected.length !== 3) return
    setBusy(true)
    const data = await combineParts(selected)
    setCombineResult(data)
    setSelected([])
    setBusy(false)
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        {/* 헤더 */}
        <div style={styles.header}>
          <span style={{ fontWeight: 'bold', fontSize: 16 }}>⚙️ 파츠 인벤토리</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {/* 슬롯 필터 */}
        <div style={styles.filterRow}>
          <button
            onClick={() => setFilter('all')}
            style={{ ...styles.filterBtn, background: filter === 'all' ? '#00ff88' : '#222', color: filter === 'all' ? 'black' : 'white' }}
          >전체</button>
          {slots.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{ ...styles.filterBtn, background: filter === s ? '#00ff88' : '#222', color: filter === s ? 'black' : 'white' }}
            >{SLOT_ICONS[s]}</button>
          ))}
        </div>

        {/* 합성 안내 */}
        <div style={styles.combineHint}>
          {(() => {
            // 선택된 파츠 티어 확인
            const selTiers = [...new Set(parts.filter(p => selected.includes(p.id)).map(p => p.tier))]
            const tier = selTiers.length === 1 ? selTiers[0] : null
            const rate = tier ? COMBINE_RATES[tier] : null
            return tier && rate
              ? `T${tier} → T${tier + 1} 합성 · 성공률 ${rate}% · 실패 시 T${Math.max(1, tier - 1)} 잔해 반환`
              : '파츠 3개 선택 → 상위 티어 합성 (티어별 성공률 차등)'
          })()}
          {selected.length > 0 && (
            <span style={{ color: '#ffd700', marginLeft: 8 }}>{selected.length}/3 선택됨</span>
          )}
        </div>

        {/* 합성 결과 */}
        {combineResult && (
          <div style={{
            ...styles.resultBanner,
            background: combineResult.result === 'success' ? '#1a3a2a' : '#3a2a1a'
          }}>
            {combineResult.message || (combineResult.result === 'success'
              ? `합성 성공! T${combineResult.part?.tier} 파츠 획득`
              : `합성 실패 — T${combineResult.part?.tier} 잔해 반환`)}
            <button onClick={() => setCombineResult(null)} style={styles.dismissBtn}>✕</button>
          </div>
        )}

        {/* 파츠 목록 */}
        <div style={styles.list}>
          {filtered.length === 0 && (
            <div style={{ color: '#555', textAlign: 'center', padding: 32 }}>
              파츠 없음 — 영역 보유 시 1시간마다 드랍됩니다
            </div>
          )}
          {filtered.map(part => {
            const isSelected = selected.includes(part.id)
            const bonusText = Object.entries(part.stat_bonuses || {})
              .map(([k, v]) => `${k.toUpperCase()}+${v}`)
              .join(' ')

            return (
              <div
                key={part.id}
                style={{
                  ...styles.card,
                  border: isSelected
                    ? '2px solid #ffd700'
                    : part.equipped
                    ? '2px solid #00ff88'
                    : '2px solid #333'
                }}
                onClick={() => toggleSelect(part.id)}
              >
                <div style={styles.cardLeft}>
                  <span style={{ fontSize: 20 }}>{SLOT_ICONS[part.slot]}</span>
                  <div>
                    <div style={{ fontSize: 11, color: '#888' }}>{SLOT_LABELS[part.slot]}</div>
                    <div style={{ fontSize: 12, color: TIER_COLOR[part.tier] }}>
                      {TIER_STARS(part.tier)}
                    </div>
                  </div>
                </div>
                <div style={styles.cardMid}>
                  <div style={{ fontSize: 11, color: '#0f0' }}>{bonusText || '-'}</div>
                  {part.passives?.length > 0 && (
                    <div style={{ fontSize: 10, color: '#a78bfa' }}>
                      {part.passives.join(', ')}
                    </div>
                  )}
                </div>
                <div style={styles.cardRight}>
                  {part.equipped && (
                    <span style={{ fontSize: 9, color: '#00ff88', display: 'block', marginBottom: 2 }}>장착중</span>
                  )}
                  <button
                    disabled={busy}
                    onClick={(e) => { e.stopPropagation(); handleEquip(part) }}
                    style={{
                      ...styles.equipBtn,
                      background: part.equipped ? '#553333' : '#1a3a2a',
                      color: part.equipped ? '#ff6666' : '#00ff88'
                    }}
                  >
                    {part.equipped ? '해제' : '장착'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* 합성 버튼 */}
        {selected.length === 3 && (() => {
          const selTiers = [...new Set(parts.filter(p => selected.includes(p.id)).map(p => p.tier))]
          const selSlots = [...new Set(parts.filter(p => selected.includes(p.id)).map(p => p.slot))]
          const valid = selTiers.length === 1 && selSlots.length === 1 && selTiers[0] < 5
          const rate = valid ? COMBINE_RATES[selTiers[0]] : null
          return (
            <button
              onClick={handleCombine}
              disabled={busy || !valid}
              style={{ ...styles.combineBtn, opacity: valid ? 1 : 0.4 }}
            >
              {busy ? '합성 중...' : valid ? `✨ 합성 (${rate}%)` : '같은 슬롯·티어 3개 필요'}
            </button>
          )
        })()}
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.6)',
    zIndex: 3000,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center'
  },
  panel: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '80vh',
    background: '#111',
    borderRadius: '16px 16px 0 0',
    display: 'flex',
    flexDirection: 'column',
    color: 'white'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid #222'
  },
  closeBtn: {
    background: 'transparent', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer'
  },
  filterRow: {
    display: 'flex',
    gap: 6,
    padding: '10px 16px',
    overflowX: 'auto'
  },
  filterBtn: {
    border: 'none',
    borderRadius: 20,
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  combineHint: {
    fontSize: 11,
    color: '#666',
    padding: '0 16px 8px'
  },
  resultBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: '0 16px 8px',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    color: 'white'
  },
  dismissBtn: {
    background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 14
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 16px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#1a1a1a',
    borderRadius: 10,
    padding: '10px 12px',
    cursor: 'pointer'
  },
  cardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 70
  },
  cardMid: {
    flex: 1
  },
  cardRight: {
    textAlign: 'right'
  },
  equipBtn: {
    border: 'none',
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  combineBtn: {
    margin: '8px 16px 16px',
    padding: '14px',
    background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 'bold',
    cursor: 'pointer'
  }
}
