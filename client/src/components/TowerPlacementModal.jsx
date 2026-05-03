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

// 4종 추천 빌드 프리셋 — 영역당 최대 3개. 첫 슬롯에 Lv1 기본으로 추천
const BUILD_PRESETS = [
  {
    key: 'striker',
    label: '⚔ 공격 거점',
    desc: '장거리 정밀 + 인접 회복',
    towers: ['balista', 'scifi', 'nature'],
    color: '#ff6644'
  },
  {
    key: 'fortress',
    label: '🏯 요새',
    desc: '연사 + 자가 회복',
    towers: ['assault', 'assault', 'nature'],
    color: '#88ff44'
  },
  {
    key: 'cc_trap',
    label: '🌊 CC 함정',
    desc: '묶고 광역 폭발',
    towers: ['aqua', 'ice', 'cannon'],
    color: '#44aaff'
  },
  {
    key: 'synergy',
    label: '✨ 시너지 허브',
    desc: '동맹 부스트 + 적 디버프',
    towers: ['crystal', 'nature', 'arcane'],
    color: '#ffaaff'
  }
]

export default function TowerPlacementModal({ territoryId, existingTowers = [], grant = null, onClose }) {
  const { towerClasses, fetchTowerClasses, placeTower, energy } = useGameStore()
  const [selectedClass, setSelectedClass] = useState('generic')
  const [selectedTier, setSelectedTier] = useState(grant ? 1 : 1) // foothold도 Lv1 기본
  const [placing, setPlacing] = useState(false)
  const [activePreset, setActivePreset] = useState(null)
  const isFoothold = !!grant

  useEffect(() => { if (!towerClasses) fetchTowerClasses() }, [])

  // 프리셋 선택 시: 이미 배치된 타워들과 비교하여 다음 슬롯에 추천할 클래스 자동 선택
  const applyPreset = (preset) => {
    setActivePreset(preset.key)
    const placedClasses = (existingTowers || []).map(t => t.tower_class || t.towerClass)
    const next = preset.towers.find((cls, i) => {
      const usedSoFar = preset.towers.slice(0, i).filter(c => c === cls).length
      const placedSame = placedClasses.filter(c => c === cls).length
      return placedSame <= usedSoFar
    }) || preset.towers[0]
    setSelectedClass(next)
    setSelectedTier(1)
  }

  if (!towerClasses) {
    return <div style={styles.overlay}><div style={styles.modal}>로딩...</div></div>
  }

  const cls = towerClasses[selectedClass]
  const stats = cls?.stats?.[selectedTier - 1]

  const handlePlace = async () => {
    setPlacing(true)
    // foothold은 Lv1만 (자원 보호)
    const tier = isFoothold ? 1 : selectedTier
    const r = await placeTower(territoryId, selectedClass, tier, grant?.id)
    setPlacing(false)
    if (r.success) onClose()
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={{ fontWeight: 'bold', fontSize: 16 }}>
            {isFoothold ? '🗡 발판 건설 (무료)' : '🏰 타워 배치'}
          </span>
          <span style={{ fontSize: 11, color: '#666' }}>
            {isFoothold
              ? `${grant.ownerName} 영역 · Lv1 고정`
              : `에너지 ${energy} · 슬롯 ${(existingTowers || []).length}/3`}
          </span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        {isFoothold && (
          <div style={styles.footholdBar}>
            ⚠ 적 영역 발판 — 영역이 점령되거나 격파되면 사라집니다. Lv1만 가능.
          </div>
        )}

        {/* 빌드 프리셋 — 4종 추천 조합 */}
        <div style={styles.presetRow}>
          {BUILD_PRESETS.map(p => {
            const placed = (existingTowers || []).map(t => t.tower_class || t.towerClass)
            const progress = p.towers.reduce((acc, cls, i) => {
              const need = p.towers.slice(0, i + 1).filter(c => c === cls).length
              const have = placed.filter(c => c === cls).length
              return acc + Math.min(have, need) - Math.min(have, need - 1)
            }, 0)
            return (
              <div
                key={p.key}
                onClick={() => applyPreset(p)}
                style={{
                  ...styles.presetCard,
                  border: activePreset === p.key ? `2px solid ${p.color}` : '1px solid #333',
                  background: activePreset === p.key ? `${p.color}22` : '#181818'
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 'bold', color: p.color }}>{p.label}</div>
                <div style={{ fontSize: 9, color: '#aaa', marginTop: 1 }}>{p.desc}</div>
                <div style={{ fontSize: 9, color: '#666', marginTop: 3 }}>
                  {p.towers.map(c => CLASS_LABELS_KO[c]).join(' · ')}
                </div>
                <div style={{ fontSize: 9, color: progress >= 3 ? '#00ff88' : '#888', marginTop: 2 }}>
                  진행 {progress}/3
                </div>
              </div>
            )
          })}
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

            {/* 레벨 선택 (foothold는 Lv1 고정) */}
            <div style={styles.tierRow}>
              {[1, 2, 3, 4, 5].map(t => (
                <button
                  key={t}
                  onClick={() => !isFoothold && setSelectedTier(t)}
                  disabled={isFoothold && t !== 1}
                  style={{
                    ...styles.tierBtn,
                    background: selectedTier === t ? '#ffd700' : '#222',
                    color: selectedTier === t ? 'black' : 'white',
                    opacity: isFoothold && t !== 1 ? 0.3 : 1,
                    fontWeight: 'bold',
                    cursor: isFoothold && t !== 1 ? 'not-allowed' : 'pointer'
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
                  color: isFoothold ? '#00ff88' : (energy >= stats.cost ? '#ffd700' : '#ff4444')
                }}>{isFoothold ? '무료 (발판)' : `${stats.cost} 에너지`}</span>
              </div>
            </div>

            <button
              onClick={handlePlace}
              disabled={placing || (!isFoothold && energy < stats.cost)}
              style={{
                ...styles.placeBtn,
                background: (!isFoothold && energy < stats.cost) ? '#444'
                  : isFoothold ? 'linear-gradient(135deg, #cc2200, #880000)'
                  : 'linear-gradient(135deg, #ff8800, #cc4400)',
                cursor: (!isFoothold && energy < stats.cost) ? 'not-allowed' : 'pointer'
              }}
            >
              {placing ? '배치 중...'
                : isFoothold ? '🗡 발판 설치 (무료)'
                : energy < stats.cost ? '에너지 부족'
                : `🏰 배치 (-${stats.cost})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 6000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  modal: { width: '100%', maxWidth: 500, maxHeight: '88vh', background: '#111', color: 'white', borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid #222' },
  closeBtn: { marginLeft: 'auto', background: 'transparent', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' },
  footholdBar: {
    background: 'linear-gradient(90deg, rgba(204,34,0,0.4), rgba(204,34,0,0.1))',
    color: '#ffaa88', fontSize: 11, padding: '6px 14px',
    borderBottom: '1px solid #663322'
  },
  presetRow: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, padding: '10px 12px 4px' },
  presetCard: { padding: '6px 8px', borderRadius: 6, cursor: 'pointer', textAlign: 'left' },
  classGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, padding: 12, overflowY: 'auto', flex: '0 0 auto' },
  classCard: { padding: 4, borderRadius: 6, textAlign: 'center', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  detailBox: { padding: '8px 16px 16px', borderTop: '1px solid #222', overflowY: 'auto' },
  tierRow: { display: 'flex', gap: 4, marginBottom: 10 },
  tierBtn: { flex: 1, padding: '6px 0', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' },
  statsTable: { background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8, marginBottom: 10 },
  statRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' },
  placeBtn: { width: '100%', padding: '12px', border: 'none', borderRadius: 10, color: 'white', fontWeight: 'bold', fontSize: 15 }
}
