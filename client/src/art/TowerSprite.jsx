// 13종 타워 스프라이트 — PNG 우선, SVG 폴백
// Piloto Studio TowerDefenseStarterPack 매핑

import { useState } from 'react'

const TIER_COLORS = ['', '#9CA3AF', '#34D399', '#A78BFA', '#F59E0B', '#EF4444']

// 13종 별 색상 키
const CLASS_TINT = {
  generic:  '#7c8a9a',
  balista:  '#a07050',
  cannon:   '#5a4a40',
  assault:  '#666',
  scifi:    '#4488ff',
  fire:     '#ff6600',
  ice:      '#7cdfff',
  aqua:     '#0088ff',
  electric: '#ffd700',
  nature:   '#22cc44',
  venom:    '#88dd44',
  arcane:   '#aa55ff',
  crystal:  '#ff44dd'
}

const CLASS_GLYPH = {
  generic: '⛯', balista: '🏹', cannon: '💣', assault: '⚙', scifi: '🛰',
  fire: '🔥', ice: '❄', aqua: '💧', electric: '⚡', nature: '🌿',
  venom: '☠', arcane: '✨', crystal: '💎'
}

export function TowerSpriteSvg({ towerClass = 'arrow', tier = 1, size = 56 }) {
  const color = TIER_COLORS[Math.min(5, Math.max(1, tier))] || '#9CA3AF'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`tg-${towerClass}-${tier}`}>
          <stop offset="0%"  stopColor={color}/>
          <stop offset="100%" stopColor={color} stopOpacity="0.4"/>
        </radialGradient>
      </defs>

      {/* 그림자 */}
      <ellipse cx="32" cy="58" rx="18" ry="3" fill="#000" opacity="0.3"/>

      {towerClass === 'arrow' && (
        <g>
          <rect x="22" y="40" width="20" height="14" fill={color}/>
          <polygon points="22,40 32,28 42,40" fill={color}/>
          <line x1="32" y1="20" x2="32" y2="35" stroke="#fff" strokeWidth="2"/>
          <polygon points="29,15 32,8 35,15" fill={color}/>
        </g>
      )}
      {towerClass === 'cannon' && (
        <g>
          <rect x="14" y="38" width="36" height="18" rx="2" fill={color}/>
          <ellipse cx="32" cy="38" rx="14" ry="6" fill={color}/>
          <circle cx="32" cy="32" r="8" fill={`url(#tg-${towerClass}-${tier})`}/>
          <rect x="29" y="14" width="6" height="22" rx="3" fill={color}/>
        </g>
      )}
      {towerClass === 'magic' && (
        <g>
          <rect x="22" y="38" width="20" height="18" rx="2" fill={color}/>
          <polygon points="20,38 32,18 44,38" fill={color}/>
          <circle cx="32" cy="30" r="5" fill="#fff" opacity="0.95">
            <animate attributeName="r" values="4;6;4" dur="2s" repeatCount="indefinite"/>
          </circle>
          <polygon points="32,8 35,18 32,16 29,18" fill="#ffd700"/>
        </g>
      )}
      {towerClass === 'support' && (
        <g>
          <rect x="20" y="36" width="24" height="20" rx="2" fill={color}/>
          <path d="M32,8 L42,16 L42,30 L22,30 L22,16 Z" fill={color}/>
          <circle cx="32" cy="22" r="6" fill="#fff" opacity="0.9"/>
          <text x="32" y="26" textAnchor="middle" fontSize="9" fontWeight="bold" fill={color}>S</text>
        </g>
      )}
      {towerClass === 'production' && (
        <g>
          <rect x="14" y="36" width="36" height="20" rx="3" fill={color}/>
          <rect x="20" y="22" width="24" height="14" fill={color}/>
          <circle cx="32" cy="29" r="6" fill="#fff" opacity="0.9"/>
          <circle cx="32" cy="29" r="2" fill={color}>
            <animateTransform attributeName="transform" type="rotate" from="0 32 29" to="360 32 29" dur="3s" repeatCount="indefinite"/>
          </circle>
        </g>
      )}
      {towerClass === 'revenue' && (
        <g>
          <rect x="14" y="36" width="36" height="20" rx="3" fill={color}/>
          <rect x="20" y="14" width="24" height="22" fill={color}/>
          <text x="32" y="32" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#ffd700">$</text>
        </g>
      )}

      {/* 티어 배지 */}
      <g transform="translate(50,50)">
        <circle r="8" fill="#000" opacity="0.85"/>
        <text x="0" y="3" textAnchor="middle" fontSize="10" fontWeight="bold" fill={color}>{tier}</text>
      </g>
    </svg>
  )
}

// PNG 우선 + SVG 폴백
export function TowerImage({ towerClass = 'arrow', tier = 1, size = 56 }) {
  const [pngFailed, setPngFailed] = useState(false)
  const pngUrl = `/assets/towers/${towerClass}_t${tier}.png`

  if (pngFailed) {
    return <TowerSpriteSvg towerClass={towerClass} tier={tier} size={size} />
  }

  return (
    <img
      src={pngUrl}
      width={size}
      height={size}
      alt={`${towerClass} t${tier}`}
      onError={() => setPngFailed(true)}
      style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
    />
  )
}

// 맵 마커용 HTML (Leaflet divIcon) — 13종
export function towerMarkerHtml(towerClass, tier, isOwn) {
  const pngUrl = `/assets/towers/${towerClass}_t${tier}.png`
  const glow = isOwn ? '#ffd700' : '#4488ff'
  const tint = CLASS_TINT[towerClass] || '#888'
  const glyph = CLASS_GLYPH[towerClass] || '⛯'
  return `
    <div style="text-align:center;filter:drop-shadow(0 0 6px ${glow});">
      <img src="${pngUrl}" width="40" height="40"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block';"
           style="display:block;object-fit:contain;"/>
      <div style="display:none;width:40px;height:40px;background:${tint};border-radius:50%;color:white;font-size:22px;line-height:40px;border:2px solid ${glow};">${glyph}</div>
    </div>`
}

export { CLASS_TINT, CLASS_GLYPH }
export default TowerImage
