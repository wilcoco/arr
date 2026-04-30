// 수호신 베이스 SVG — 캐릭터 3종 (animal / robot / aircraft)
// 모든 그래픽은 인라인 SVG로 외부 에셋 의존 없음.
// 추후 /public/assets/characters/{type}.png 가 존재하면 PNG로 폴백 가능.

const TYPE_COLORS = {
  animal:   { primary: '#8B5A2B', secondary: '#D2A77F', accent: '#F4D5A5' },
  robot:    { primary: '#4A90E2', secondary: '#7CB7F0', accent: '#C2DFFA' },
  aircraft: { primary: '#7C5CFA', secondary: '#A48EFF', accent: '#D7CCFF' }
}

export function GuardianBase({ type = 'animal', size = 64, animated = true, glow = false }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.animal
  const filterId = `glow-${type}`

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`grad-${type}`}>
          <stop offset="0%"  stopColor={c.accent} />
          <stop offset="60%" stopColor={c.secondary} />
          <stop offset="100%" stopColor={c.primary} />
        </radialGradient>
        {glow && (
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        )}
      </defs>

      {/* 그림자 */}
      <ellipse cx="32" cy="58" rx="18" ry="3" fill="#000" opacity="0.25"/>

      {/* 타입별 본체 */}
      {type === 'animal' && (
        <g filter={glow ? `url(#${filterId})` : undefined}>
          {/* 다리 4개 */}
          <rect x="14" y="40" width="6" height="14" rx="2" fill={c.primary}/>
          <rect x="22" y="40" width="6" height="14" rx="2" fill={c.primary}/>
          <rect x="36" y="40" width="6" height="14" rx="2" fill={c.primary}/>
          <rect x="44" y="40" width="6" height="14" rx="2" fill={c.primary}/>
          {/* 몸통 */}
          <ellipse cx="32" cy="36" rx="22" ry="14" fill={`url(#grad-${type})`}/>
          {/* 머리 */}
          <circle cx="48" cy="22" r="11" fill={c.secondary}/>
          {/* 귀 */}
          <polygon points="44,12 47,18 41,18" fill={c.primary}/>
          <polygon points="52,12 55,18 49,18" fill={c.primary}/>
          {/* 눈 */}
          <circle cx="46" cy="22" r="1.7" fill="#111"/>
          <circle cx="51" cy="22" r="1.7" fill="#111"/>
          {/* 꼬리 */}
          <path d="M10,32 Q4,28 4,22" stroke={c.primary} strokeWidth="4" fill="none" strokeLinecap="round">
            {animated && <animate attributeName="d" values="M10,32 Q4,28 4,22; M10,32 Q4,30 6,18; M10,32 Q4,28 4,22" dur="2s" repeatCount="indefinite"/>}
          </path>
        </g>
      )}

      {type === 'robot' && (
        <g filter={glow ? `url(#${filterId})` : undefined}>
          {/* 다리 (사각 기둥) */}
          <rect x="20" y="42" width="8" height="14" fill={c.primary}/>
          <rect x="36" y="42" width="8" height="14" fill={c.primary}/>
          {/* 몸통 (사각) */}
          <rect x="14" y="22" width="36" height="24" rx="3" fill={`url(#grad-${type})`}/>
          {/* 가슴 패널 */}
          <rect x="22" y="28" width="20" height="12" rx="2" fill={c.primary}/>
          <circle cx="32" cy="34" r="3" fill={c.accent}>
            {animated && <animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite"/>}
          </circle>
          {/* 머리 (정사각) */}
          <rect x="22" y="8" width="20" height="14" rx="2" fill={c.secondary}/>
          {/* 안테나 */}
          <line x1="32" y1="2" x2="32" y2="8" stroke={c.primary} strokeWidth="2"/>
          <circle cx="32" cy="2" r="2" fill="#ff4444">
            {animated && <animate attributeName="r" values="1.5;2.5;1.5" dur="1s" repeatCount="indefinite"/>}
          </circle>
          {/* 눈 (LED) */}
          <rect x="26" y="13" width="3" height="3" fill="#00ff88"/>
          <rect x="35" y="13" width="3" height="3" fill="#00ff88"/>
          {/* 팔 */}
          <rect x="6"  y="24" width="8" height="16" rx="2" fill={c.primary}/>
          <rect x="50" y="24" width="8" height="16" rx="2" fill={c.primary}/>
        </g>
      )}

      {type === 'aircraft' && (
        <g filter={glow ? `url(#${filterId})` : undefined}>
          {/* 날개 */}
          <polygon points="2,38 32,32 2,46" fill={c.secondary}/>
          <polygon points="62,38 32,32 62,46" fill={c.secondary}/>
          {/* 동체 (유선형) */}
          <ellipse cx="32" cy="38" rx="28" ry="9" fill={`url(#grad-${type})`}/>
          {/* 코어 */}
          <circle cx="32" cy="38" r="5" fill={c.accent}>
            {animated && <animate attributeName="r" values="4;6;4" dur="1.5s" repeatCount="indefinite"/>}
          </circle>
          {/* 후미 노즐 */}
          <rect x="2" y="36" width="6" height="4" fill="#ff8800">
            {animated && <animate attributeName="width" values="4;8;4" dur="0.5s" repeatCount="indefinite"/>}
          </rect>
          {/* 캐노피 */}
          <ellipse cx="42" cy="36" rx="6" ry="4" fill="#88ddff" opacity="0.6"/>
          {/* 꼬리날개 */}
          <polygon points="18,30 24,32 24,38 18,40" fill={c.primary}/>
        </g>
      )}
    </svg>
  )
}

// PNG 자산 폴백 (있으면 PNG, 없으면 SVG)
export function GuardianImage({ type, size = 64, ...props }) {
  const pngUrl = `/assets/characters/${type}.png`
  // <img> 로딩 실패 시 SVG로 폴백
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-block' }}>
      <img
        src={pngUrl}
        width={size}
        height={size}
        onError={(e) => { e.currentTarget.style.display = 'none' }}
        style={{ position: 'absolute', inset: 0 }}
        alt={type}
      />
      <div style={{ position: 'absolute', inset: 0 }}>
        <GuardianBase type={type} size={size} {...props} />
      </div>
    </div>
  )
}

export default GuardianBase
