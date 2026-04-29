import { useEffect } from 'react'
import { useGameStore } from '../stores/gameStore'

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }

export default function Leaderboard({ onClose }) {
  const { leaderboard, fetchLeaderboard, userId, leaderboardMode, leaderboardSeason } = useGameStore()

  useEffect(() => { fetchLeaderboard() }, [])

  const myRank = leaderboard.find(r => r.userId === userId)

  const modeLabel = {
    'area':     '면적 기준',
    'current':  `시즌 ${leaderboardSeason?.name || ''}`,
    'all-time': '역대 누적'
  }[leaderboardMode] || '면적 기준'

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        {/* 헤더 */}
        <div style={styles.header}>
          <span style={{ fontWeight: 'bold', fontSize: 16 }}>🏆 리더보드</span>
          <span style={{ fontSize: 11, color: '#666' }}>{modeLabel}</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {/* 모드 탭 */}
        <div style={styles.tabs}>
          {[
            { k: 'area',     label: '📐 면적' },
            { k: 'current',  label: '⚔️ 시즌' },
            { k: 'all-time', label: '🏆 누적' }
          ].map(t => (
            <button
              key={t.k}
              onClick={() => fetchLeaderboard(t.k)}
              style={{
                ...styles.tab,
                background: leaderboardMode === t.k ? '#00ff88' : '#222',
                color:      leaderboardMode === t.k ? 'black'   : '#aaa'
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* 내 순위 하이라이트 */}
        {myRank && (
          <div style={styles.myRank}>
            <span style={{ color: '#ffd700', fontWeight: 'bold' }}>내 순위: {myRank.rank}위</span>
            <span style={{ color: '#aaa', fontSize: 12, marginLeft: 8 }}>
              영역 {myRank.territoryCount}개 · 면적 {formatArea(myRank.totalArea)}
            </span>
          </div>
        )}

        {/* 목록 */}
        <div style={styles.list}>
          {leaderboard.length === 0 && (
            <div style={{ color: '#555', textAlign: 'center', padding: 32 }}>
              아직 데이터가 없습니다
            </div>
          )}
          {leaderboard.map((row) => {
            const isMe = row.userId === userId
            return (
              <div
                key={row.userId}
                style={{
                  ...styles.row,
                  background: isMe ? 'rgba(0,255,136,0.08)' : 'transparent',
                  border: isMe ? '1px solid #00ff8844' : '1px solid #222'
                }}
              >
                {/* 순위 */}
                <div style={styles.rankCell}>
                  {RANK_MEDAL[row.rank]
                    ? <span style={{ fontSize: 20 }}>{RANK_MEDAL[row.rank]}</span>
                    : <span style={{ color: '#666', fontSize: 14, fontWeight: 'bold' }}>{row.rank}</span>}
                </div>

                {/* 유저 정보 */}
                <div style={styles.userCell}>
                  <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                    {row.username}
                    {isMe && <span style={{ color: '#00ff88', fontSize: 11, marginLeft: 6 }}>(나)</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 'bold',
                      color: row.layer === 'veteran' ? '#ffd700' : '#888',
                      background: row.layer === 'veteran' ? '#3a2800' : '#222',
                      padding: '1px 5px', borderRadius: 3
                    }}>
                      {row.layer === 'veteran' ? '베테랑' : '초심자'}
                    </span>
                    <span style={{ fontSize: 10, color: '#888' }}>
                      {leaderboardMode === 'current'
                        ? `시즌 승 ${row.seasonWins || 0}회`
                        : `승리 ${row.battleWins}회`}
                    </span>
                    {row.revenueTowers > 0 && (
                      <span style={{ fontSize: 10, color: '#ffd700' }}>🏛️ 수익탑 {row.revenueTowers}</span>
                    )}
                  </div>
                </div>

                {/* 점수 */}
                <div style={styles.scoreCell}>
                  <div style={{ fontWeight: 'bold', fontSize: 13, color: '#00ff88' }}>
                    {formatArea(row.totalArea)}
                  </div>
                  <div style={{ fontSize: 11, color: '#666' }}>
                    영역 {row.territoryCount}개
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function formatArea(m2) {
  if (!m2 || m2 === 0) return '0㎡'
  if (m2 >= 1000000) return (m2 / 1000000).toFixed(1) + 'km²'
  if (m2 >= 10000)   return (m2 / 10000).toFixed(1) + 'ha'
  return Math.round(m2) + '㎡'
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
    alignItems: 'center',
    gap: 8,
    padding: '14px 16px',
    borderBottom: '1px solid #222'
  },
  closeBtn: {
    marginLeft: 'auto',
    background: 'transparent', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer'
  },
  tabs: {
    display: 'flex',
    gap: 6,
    padding: '8px 12px',
    borderBottom: '1px solid #222'
  },
  tab: {
    flex: 1,
    border: 'none',
    borderRadius: 20,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  myRank: {
    background: 'rgba(0,255,136,0.07)',
    padding: '10px 16px',
    borderBottom: '1px solid #222'
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    padding: '10px 12px'
  },
  rankCell: {
    width: 32,
    textAlign: 'center'
  },
  userCell: {
    flex: 1
  },
  scoreCell: {
    textAlign: 'right'
  }
}
