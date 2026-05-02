// 파츠 SVG — 5 슬롯 × 5 티어
// 티어별 색상 (rarity)
export const TIER_COLORS = [
  null,
  '#9CA3AF',  // T1 회색 (Common)
  '#34D399',  // T2 초록 (Uncommon)
  '#A78BFA',  // T3 보라 (Rare)
  '#F59E0B',  // T4 주황 (Epic)
  '#EF4444'   // T5 빨강 (Legendary)
]

// 슬롯별 SVG 그래픽 (간단 픽토그램)
export function PartIcon({ slot, tier = 1, size = 48, glow = false }) {
  const color = TIER_COLORS[Math.min(5, Math.max(1, tier))] || '#9CA3AF'
  const filterId = `pglow-${slot}-${tier}`

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {glow && (
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        )}
        <linearGradient id={`pgrad-${slot}-${tier}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="1"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.5"/>
        </linearGradient>
      </defs>

      {/* 배경 원 (rarity 표시) */}
      <circle cx="24" cy="24" r="22" fill={color} opacity="0.15"/>
      <circle cx="24" cy="24" r="22" fill="none" stroke={color} strokeWidth="2"/>

      <g filter={glow ? `url(#${filterId})` : undefined} fill={`url(#pgrad-${slot}-${tier})`} stroke={color} strokeWidth="1.5">
        {slot === 'head' && (
          <>
            {/* 헬멧 */}
            <path d="M12,28 Q12,12 24,12 Q36,12 36,28 L36,32 L12,32 Z" />
            <rect x="14" y="22" width="20" height="4" fill={color} opacity="0.6"/>
            {/* 정수리 결정 */}
            <polygon points="24,6 28,12 20,12" />
          </>
        )}
        {slot === 'body' && (
          <>
            {/* 흉갑 */}
            <path d="M12,14 L36,14 L34,38 L14,38 Z" />
            {/* 가슴 결정 */}
            <polygon points="24,18 28,24 24,30 20,24" fill={color}/>
          </>
        )}
        {slot === 'arms' && (
          <>
            {/* 양 어깨/건틀릿 */}
            <rect x="6"  y="14" width="10" height="18" rx="2" />
            <rect x="32" y="14" width="10" height="18" rx="2" />
            {/* 무기 (검) */}
            <line x1="24" y1="6" x2="24" y2="40" stroke={color} strokeWidth="3" strokeLinecap="round"/>
            <rect x="20" y="36" width="8" height="4" fill={color}/>
          </>
        )}
        {slot === 'legs' && (
          <>
            {/* 부츠 */}
            <rect x="10" y="18" width="10" height="22" rx="2" />
            <rect x="28" y="18" width="10" height="22" rx="2" />
            {/* 무릎 보호대 */}
            <circle cx="15" cy="22" r="3" fill={color}/>
            <circle cx="33" cy="22" r="3" fill={color}/>
          </>
        )}
        {slot === 'core' && (
          <>
            {/* 중앙 코어 (다이아몬드) */}
            <polygon points="24,8 38,24 24,40 10,24" />
            {/* 내부 빛 */}
            <polygon points="24,16 32,24 24,32 16,24" fill={color} opacity="0.6"/>
            <circle cx="24" cy="24" r="3" fill="white"/>
          </>
        )}
      </g>

      {/* 티어 배지 (★) */}
      <g transform="translate(38,38)">
        <circle r="7" fill="#000" opacity="0.7"/>
        <text x="0" y="3" textAnchor="middle" fontSize="9" fontWeight="bold" fill={color}>{tier}</text>
      </g>
    </svg>
  )
}

import { GuardianBase } from './GuardianSvg'

// 캐릭터 + 파츠 합성 렌더 (장착 파츠를 캐릭터 위에 오버레이)
export function CharacterWithParts({ type, equippedParts = [], size = 96, glow = false, animated = true }) {
  const slotPositions = {
    head: { x: 0.65, y: 0.05, scale: 0.30 },
    body: { x: 0.50, y: 0.45, scale: 0.32 },
    arms: { x: 0.10, y: 0.50, scale: 0.25 },
    legs: { x: 0.45, y: 0.75, scale: 0.25 },
    core: { x: 0.50, y: 0.55, scale: 0.20 }
  }

  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-block' }}>
      <GuardianBase type={type} size={size} animated={animated} glow={glow} />
      {equippedParts.map((p, i) => {
        const pos = slotPositions[p.slot]
        if (!pos) return null
        const sz = size * pos.scale
        return (
          <div key={p.id || i}
            style={{
              position: 'absolute',
              left: `${pos.x * 100}%`, top: `${pos.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              filter: `drop-shadow(0 0 ${p.tier}px ${TIER_COLORS[p.tier] || '#888'})`
            }}>
            <PartIcon slot={p.slot} tier={p.tier} size={sz} />
          </div>
        )
      })}
    </div>
  )
}

export default PartIcon
