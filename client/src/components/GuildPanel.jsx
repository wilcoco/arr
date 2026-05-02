import { useState, useEffect, useRef } from 'react'
import { useGameStore } from '../stores/gameStore'

export default function GuildPanel({ onClose }) {
  const userId = useGameStore(s => s.userId)
  const showToast = useGameStore(s => s.showToast)
  const [guild, setGuild] = useState(null)
  const [members, setMembers] = useState([])
  const [list, setList] = useState([])
  const [messages, setMessages] = useState([])
  const [tab, setTab] = useState('home')
  const [chatInput, setChatInput] = useState('')
  const [createName, setCreateName] = useState('')
  const apiBase = import.meta.env.VITE_API_URL || ''
  const chatRef = useRef(null)

  const loadMy = async () => {
    const r = await fetch(`${apiBase}/api/guilds/my/${userId}`)
    const d = await r.json()
    setGuild(d.guild)
    setMembers(d.members || [])
  }
  const loadList = async () => {
    const r = await fetch(`${apiBase}/api/guilds/list`)
    const d = await r.json()
    setList(d.guilds || [])
  }
  const loadChat = async () => {
    const r = await fetch(`${apiBase}/api/guilds/chat/${userId}`)
    const d = await r.json()
    setMessages(d.messages || [])
    setTimeout(() => chatRef.current?.scrollTo(0, 999999), 100)
  }

  useEffect(() => {
    if (!userId) return
    loadMy()
    loadList()
  }, [userId])

  useEffect(() => {
    if (tab === 'chat' && guild) {
      loadChat()
      const id = setInterval(loadChat, 5000)
      return () => clearInterval(id)
    }
  }, [tab, guild])

  const create = async () => {
    if (!createName) return
    const r = await fetch(`${apiBase}/api/guilds/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name: createName })
    })
    const d = await r.json()
    if (d.success) { showToast(`🏰 길드 "${createName}" 생성 (-200E)`, 'success'); loadMy() }
    else showToast(d.error || '생성 실패', 'error')
  }

  const join = async (gId) => {
    const r = await fetch(`${apiBase}/api/guilds/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, guildId: gId })
    })
    const d = await r.json()
    if (d.success) { showToast('🤝 길드 가입 성공', 'success'); loadMy() }
    else showToast(d.error || '가입 실패', 'error')
  }

  const leave = async () => {
    if (!confirm('정말 길드를 떠나시겠습니까?')) return
    const r = await fetch(`${apiBase}/api/guilds/leave`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    })
    if ((await r.json()).success) { showToast('길드 탈퇴', 'info'); loadMy() }
  }

  const sendMsg = async () => {
    if (!chatInput.trim()) return
    await fetch(`${apiBase}/api/guilds/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, message: chatInput })
    })
    setChatInput('')
    loadChat()
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={{ fontWeight: 'bold', fontSize: 16 }}>🏰 길드</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {!guild && (
          <>
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 13, color: '#aaa', marginBottom: 6 }}>새 길드 생성 (200 에너지)</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={createName} onChange={e => setCreateName(e.target.value)}
                       placeholder="길드 이름" style={styles.input} maxLength={30}/>
                <button onClick={create} style={styles.actionBtn}>생성</button>
              </div>
            </div>
            <div style={{ borderTop: '1px solid #222', padding: '8px 12px', fontSize: 13, color: '#aaa' }}>가입 가능 길드</div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {list.length === 0 && <div style={styles.empty}>가입 가능한 길드 없음</div>}
              {list.map(g => (
                <div key={g.id} style={styles.guildRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{g.name}</div>
                    <div style={{ fontSize: 10, color: '#888' }}>{g.member_count}/{g.max_members}명</div>
                  </div>
                  <button onClick={() => join(g.id)} style={styles.actionBtn}>가입</button>
                </div>
              ))}
            </div>
          </>
        )}

        {guild && (
          <>
            <div style={styles.tabs}>
              {['home', 'members', 'chat'].map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  ...styles.tab,
                  background: tab === t ? '#00ff88' : '#222',
                  color: tab === t ? 'black' : '#aaa'
                }}>{t === 'home' ? '🏰 홈' : t === 'members' ? `👥 멤버 (${members.length})` : '💬 채팅'}</button>
              ))}
            </div>

            {tab === 'home' && (
              <div style={{ padding: 16 }}>
                <h2 style={{ marginBottom: 12 }}>{guild.name}</h2>
                <div style={styles.infoRow}><span>멤버</span><span>{guild.member_count}/{guild.max_members}</span></div>
                <div style={styles.infoRow}><span>공유 에너지</span><span style={{ color: '#ffd700' }}>{guild.shared_energy || 0}</span></div>
                <button onClick={leave} style={{ ...styles.actionBtn, background: '#aa3333', marginTop: 16, width: '100%' }}>길드 떠나기</button>
              </div>
            )}

            {tab === 'members' && (
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {members.map(m => (
                  <div key={m.id} style={styles.memberRow}>
                    <span style={{ fontWeight: 'bold', flex: 1 }}>{m.username}</span>
                    <span style={{ fontSize: 11, color: '#ffd700' }}>Lv.{m.level}</span>
                    <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>승 {m.battle_wins}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'chat' && (
              <>
                <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                  {messages.length === 0 && <div style={styles.empty}>메시지 없음</div>}
                  {messages.map(m => (
                    <div key={m.id} style={styles.msgRow}>
                      <div style={{ fontSize: 11, color: '#ffd700', fontWeight: 'bold' }}>{m.username}</div>
                      <div style={{ fontSize: 13, marginTop: 2 }}>{m.message}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #222' }}>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                         onKeyDown={e => e.key === 'Enter' && sendMsg()}
                         placeholder="메시지" style={styles.input} maxLength={200}/>
                  <button onClick={sendMsg} style={styles.actionBtn}>전송</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  modal: { width: '100%', maxWidth: 480, height: '85vh', background: '#111', color: 'white', borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid #222' },
  closeBtn: { marginLeft: 'auto', background: 'transparent', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 4, padding: 8, borderBottom: '1px solid #222' },
  tab: { flex: 1, padding: '8px 0', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 'bold', cursor: 'pointer' },
  input: { flex: 1, background: '#1a1a1a', border: '1px solid #333', color: 'white', padding: '8px 10px', borderRadius: 6 },
  actionBtn: { background: '#00ff88', color: 'black', border: 'none', padding: '8px 14px', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' },
  empty: { textAlign: 'center', color: '#555', padding: 32, fontSize: 13 },
  guildRow: { display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #1a1a1a' },
  memberRow: { display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #1a1a1a' },
  infoRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #222', fontSize: 13 },
  msgRow: { padding: '8px 10px', background: '#1a1a1a', borderRadius: 8, marginBottom: 6 }
}
