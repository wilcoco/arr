import { useState, useEffect, useRef } from 'react'
import { useGameStore } from '../stores/gameStore'
import { GuardianBase } from '../art/GuardianSvg'

export default function BattleModal() {
  const {
    battleModalOpen,
    currentBattle,
    closeBattleModal,
    respondToBattle,
    arMode,
    setArMode,
    guardian,
    fetchBattlePreview
  } = useGameStore()

  const [battlePhase, setBattlePhase]     = useState('choice')
  const [pathSelected, setPathSelected]   = useState(null) // 'A' (직접 침투) | 'B' (공성) | null
  // 새 전투 시작 시 경로 선택 초기화
  useEffect(() => {
    if (currentBattle?.status === 'intrusion_detected') setPathSelected(null)
  }, [currentBattle?.territory?.id])
  const [animationStep, setAnimationStep] = useState(0)
  const [ultActivated, setUltActivated]   = useState(false)
  const [preview, setPreview]             = useState(null)

  // 턴제 시뮬레이션 상태
  const [turns, setTurns]                 = useState([])
  const [currentTurnIdx, setCurrentTurnIdx] = useState(-1)
  const [hpView, setHpView]               = useState({ atk: 100, def: 100, atkMax: 100, defMax: 100 })
  const [damagePopup, setDamagePopup]     = useState(null)  // {side, value, crit}
  const [shakeSide, setShakeSide]         = useState(null)
  const [flashScreen, setFlashScreen]     = useState(false)

  // 궁극기 QTE 윈도우 (3턴 시점에 2초)
  const [ultWindowOpen, setUltWindowOpen] = useState(false)
  const [ultUsedDuringBattle, setUltUsedDuringBattle] = useState(false)
  const ultUsedRef = useRef(false)

  useEffect(() => {
    if (currentBattle?.status === 'animating' && currentBattle.result) {
      runBattleAnimation(currentBattle.result)
    }
  }, [currentBattle?.status])

  // 전투 프리뷰 자동 로드 (choice 단계에서 대상이 바뀌면)
  useEffect(() => {
    if (battlePhase !== 'choice' || !currentBattle) { setPreview(null); return }

    let targetId, territoryId = null
    if (currentBattle.status === 'intrusion_detected') {
      targetId = currentBattle.territory?.userId
      territoryId = currentBattle.territory?.id
    } else if (currentBattle.status === 'player_encounter') {
      targetId = currentBattle.targetPlayer?.id
    } else {
      return
    }
    if (!targetId) return

    fetchBattlePreview(targetId, territoryId).then(p => setPreview(p))
  }, [currentBattle?.territory?.id, currentBattle?.targetPlayer?.id, battlePhase, arMode])

  const BattlePreview = () => {
    if (!preview) return null
    const { winChance, attackerPower, defenderPower, vulnerable, typeAdvantage, attackerType, defenderType } = preview
    const verdict =
      winChance >= 70 ? { text: '압도적 유리', color: '#00ff88' } :
      winChance >= 50 ? { text: '유리',       color: '#4fc' } :
      winChance >= 30 ? { text: '불리',       color: '#f59e0b' } :
                        { text: '매우 불리', color: '#f43f5e' }
    return (
      <div style={styles.preview}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#aaa' }}>예상 승률</span>
          <span style={{ fontSize: 18, fontWeight: 'bold', color: verdict.color }}>
            {winChance}% · {verdict.text}
          </span>
        </div>
        <div style={styles.previewBar}>
          <div style={{ ...styles.previewFill, width: `${winChance}%`, background: verdict.color }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginTop: 4 }}>
          <span>내 파워 {attackerPower}</span>
          <span>상대 파워 {defenderPower}</span>
        </div>
        {(vulnerable || typeAdvantage !== 1) && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {vulnerable && <span style={styles.badge}>💥 취약 영역</span>}
            {typeAdvantage > 1 && <span style={{ ...styles.badge, background: '#1a3a2a', color: '#00ff88' }}>
              {attackerType} ⚡ {defenderType} +15%
            </span>}
            {typeAdvantage < 1 && <span style={{ ...styles.badge, background: '#3a1a1a', color: '#ff6666' }}>
              {attackerType} 🛡 {defenderType} -13%
            </span>}
          </div>
        )}
      </div>
    )
  }

  // 결과로부터 턴 시퀀스를 시뮬레이션 — 서버 결과와 일치시키되 시각화용
  const buildTurns = (result) => {
    const details = result.battleDetails || {}
    const myAtk   = details.attacker?.stats?.atk || 30
    const myHp    = details.attacker?.stats?.hp  || 100
    const enAtk   = details.defender?.stats?.atk || 20
    const enHp    = details.defender?.stats?.hp  || 100
    const iWon    = result.winner === 'attacker'

    const totalTurns = 6
    const myWinTurns = iWon ? Math.ceil(totalTurns / 2) + 1 : Math.floor(totalTurns / 2)
    const enWinTurns = totalTurns - myWinTurns

    // 턴별 데미지 (대략적, 결과의 power 합계에 맞춤)
    const myPerTurn = Math.max(1, Math.round((enHp / Math.max(1, myWinTurns)) * 0.9))
    const enPerTurn = Math.max(1, Math.round((myHp / Math.max(1, enWinTurns + 1)) * 0.7))

    const arr = []
    for (let i = 0; i < totalTurns; i++) {
      const isMy = i % 2 === 0
      const crit = Math.random() < 0.18
      const dmg = (isMy ? myPerTurn : enPerTurn) * (crit ? 1.6 : 1.0)
      arr.push({ side: isMy ? 'atk' : 'def', dmg: Math.round(dmg), crit })
    }
    return { turns: arr, myHp, enHp }
  }

  const runBattleAnimation = async (result) => {
    setBattlePhase('animating')
    setUltUsedDuringBattle(false)
    ultUsedRef.current = false

    const sim = buildTurns(result)
    setTurns(sim.turns)
    setHpView({ atk: sim.myHp, def: sim.enHp, atkMax: sim.myHp, defMax: sim.enHp })

    for (let i = 0; i < sim.turns.length; i++) {
      // 3번째 턴 직전: 궁극기 충전 상태면 QTE 윈도우 오픈 (2초)
      if (i === 2 && (guardian?.stats?.ultCharge ?? guardian?.stats?.ult_charge ?? 0) >= 100 && !ultUsedRef.current) {
        setUltWindowOpen(true)
        await new Promise(r => setTimeout(r, 2000))
        setUltWindowOpen(false)
      }

      setCurrentTurnIdx(i)
      const t = sim.turns[i]
      let dmg = t.dmg

      // 궁극기 사용된 턴이면 내 공격 ×1.5
      if (ultUsedRef.current && t.side === 'atk' && i === 2) {
        dmg = Math.round(dmg * 1.5)
      }

      // 공격 사이드 살짝 앞으로 (visual)
      setShakeSide(t.side === 'atk' ? 'def' : 'atk')
      await new Promise(r => setTimeout(r, 150))

      // 데미지 팝업 + HP 감소
      setDamagePopup({ side: t.side === 'atk' ? 'def' : 'atk', value: dmg, crit: t.crit })
      setHpView(prev => {
        const next = { ...prev }
        if (t.side === 'atk') next.def = Math.max(0, prev.def - dmg)
        else                  next.atk = Math.max(0, prev.atk - dmg)
        return next
      })

      // 크리티컬이면 화면 플래시
      if (t.crit) {
        setFlashScreen(true)
        setTimeout(() => setFlashScreen(false), 100)
      }

      await new Promise(r => setTimeout(r, 600))
      setShakeSide(null)
      setDamagePopup(null)
    }

    await new Promise(r => setTimeout(r, 600))
    setBattlePhase('result')
    setCurrentTurnIdx(-1)
  }

  // 궁극기 QTE 발동
  const triggerUltimateInBattle = () => {
    if (!ultWindowOpen || ultUsedRef.current) return
    ultUsedRef.current = true
    setUltUsedDuringBattle(true)
    setUltWindowOpen(false)
    // 화면 플래시 + 진동 효과
    setFlashScreen(true)
    setTimeout(() => setFlashScreen(false), 200)
  }

  if (!battleModalOpen || !currentBattle) return null

  const hasUlt = (guardian?.stats?.ultCharge || 0) >= 100

  const handleChoice = async (choice) => {
    if (choice === 'battle' || choice === 'attack') {
      setBattlePhase('waiting')
    }
    // ultActivated: 사전 토글이 ON이거나 전투 중 QTE로 발동되면 true (전투 중 발동은 버튼 후 후처리)
    await respondToBattle(choice, ultActivated)
    setUltActivated(false)
  }

  // ─── 공통: AR 모드 + 궁극기 토글 ────────────────────────────────
  const BattleOptions = () => (
    <div style={styles.battleOptions}>
      <button
        onClick={() => setArMode(!arMode)}
        style={{ ...styles.optionBtn, background: arMode ? '#0040ff' : '#222', color: 'white' }}
      >
        📷 AR {arMode ? 'ON (+20%)' : 'OFF'}
      </button>
      <button
        onClick={() => setUltActivated(!ultActivated)}
        disabled={!hasUlt}
        style={{
          ...styles.optionBtn,
          background: ultActivated ? '#b45309' : '#222',
          color: hasUlt ? (ultActivated ? '#ffd700' : '#aaa') : '#444',
          cursor: hasUlt ? 'pointer' : 'not-allowed'
        }}
      >
        ⚡ 궁극기 {ultActivated ? 'ON (+50%)' : `OFF (${guardian?.stats?.ultCharge || 0}/100)`}
      </button>
    </div>
  )

  // ─── 영역 침입: 경로 선택 (A 직접 침투 vs B 공성) ───────────────
  if (currentBattle.status === 'intrusion_detected' && battlePhase === 'choice' && !pathSelected) {
    const t = currentBattle.territory
    const onPickB = () => {
      // 공성 경로: 이 자리에서 인접 영역 확장 시작
      useGameStore.getState().startTerritoryExpand()
      useGameStore.getState().showToast('⚒ 공성 경로 — 여기서 영역 확장 후 사거리 안에 타워 건설하세요', 'info')
      closeBattleModal()
    }
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.alertIcon}>⚔️</div>
          <h2 style={styles.title}>적 영역 진입</h2>
          <p style={styles.desc}>
            <b style={{ color: '#ffd700' }}>{t?.username}</b>의 영역 ({t?.radius}m)
          </p>
          <div style={{ fontSize: 12, color: '#aaa', textAlign: 'center', margin: '6px 0 14px' }}>
            점령 경로를 선택하세요
          </div>

          {/* 경로 A — 직접 침투 */}
          <button onClick={() => setPathSelected('A')} style={styles.pathBtnA}>
            <div style={styles.pathHeader}>
              <span style={{ fontSize: 22 }}>🗡</span>
              <span style={{ fontSize: 14, fontWeight: 'bold', color: '#ff6644' }}>A · 직접 침투</span>
              <span style={styles.pathBadgeFast}>빠름</span>
            </div>
            <div style={styles.pathDesc}>
              본체로 타워와 1:1 — 격파 시 그 자리에 무료 타워 건설
            </div>
            <div style={styles.pathMeta}>위험: 본체 HP 손실 · 5분 쿨다운 · AR 보너스 ×1.20</div>
          </button>

          {/* 경로 B — 공성 */}
          <button onClick={onPickB} style={styles.pathBtnB}>
            <div style={styles.pathHeader}>
              <span style={{ fontSize: 22 }}>🏰</span>
              <span style={{ fontSize: 14, fontWeight: 'bold', color: '#aa44ff' }}>B · 공성</span>
              <span style={styles.pathBadgeSafe}>안전</span>
            </div>
            <div style={styles.pathDesc}>
              인접 영역 확장 + 타워로 자동 교전 — 6h grace 후 영역 통째로
            </div>
            <div style={styles.pathMeta}>비동기 · 본체 노출 없음 · 영역+타워 비용 부담</div>
          </button>

          <button onClick={closeBattleModal} style={styles.cancelBtn}>무시하고 지나가기</button>
        </div>
      </div>
    )
  }

  // ─── 영역 침입: 경로 A 선택 후 — 기존 전투 UI ─────────────────
  if (currentBattle.status === 'intrusion_detected' && battlePhase === 'choice' && pathSelected === 'A') {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <button onClick={() => setPathSelected(null)} style={styles.backBtn}>‹ 경로 선택</button>
          <div style={styles.alertIcon}>🗡</div>
          <h2 style={styles.title}>직접 침투</h2>
          <p style={styles.desc}>
            <b style={{ color: '#ffd700' }}>{currentBattle.territory?.username}</b>의 영역 ({currentBattle.territory?.radius}m)
          </p>
          <BattlePreview />
          <BattleOptions />
          <div style={styles.choices}>
            <button onClick={() => handleChoice('attack')} style={styles.battleBtn}>
              <span style={{ fontSize: 24 }}>⚔️</span>
              <span>전투</span>
            </button>
            <button onClick={() => handleChoice('alliance')} style={styles.allianceBtn}>
              <span style={{ fontSize: 24 }}>🤝</span>
              <span>동맹 제안</span>
            </button>
          </div>
          <button onClick={closeBattleModal} style={styles.cancelBtn}>무시하고 지나가기</button>
        </div>
      </div>
    )
  }

  // ─── 플레이어 직접 조우 ───────────────────────────────────────
  if (currentBattle.status === 'player_encounter' && battlePhase === 'choice') {
    const player = currentBattle.targetPlayer
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.alertIcon}>
            {player.guardian?.type === 'animal' ? '🦁' :
             player.guardian?.type === 'robot'  ? '🤖' :
             player.guardian?.type === 'aircraft' ? '✈️' : '👤'}
          </div>
          <h2 style={styles.title}>플레이어 발견!</h2>
          <p style={styles.desc}><b style={{ color: '#ff4444' }}>{player.username}</b></p>
          {player.guardian && (
            <div style={styles.targetStats}>
              <div>ATK: {player.guardian.stats?.atk || '?'}</div>
              <div>DEF: {player.guardian.stats?.def || '?'}</div>
              <div>HP: {player.guardian.stats?.hp || '?'}</div>
            </div>
          )}
          <BattlePreview />
          <BattleOptions />
          <div style={styles.choices}>
            <button onClick={() => handleChoice('battle')} style={styles.battleBtn}>
              <span style={{ fontSize: 24 }}>⚔️</span><span>전투</span>
            </button>
            <button onClick={() => handleChoice('alliance')} style={styles.allianceBtn}>
              <span style={{ fontSize: 24 }}>🤝</span><span>동맹 제안</span>
            </button>
          </div>
          <button onClick={closeBattleModal} style={styles.cancelBtn}>무시하기</button>
        </div>
      </div>
    )
  }

  // ─── 고정 수호신 공격 ─────────────────────────────────────────
  if (currentBattle.status === 'fixed_guardian_attack' && battlePhase === 'choice') {
    const fg = currentBattle.targetFixedGuardian
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.alertIcon}>{fg.type === 'production' ? '⚙️' : '🛡️'}</div>
          <h2 style={styles.title}>고정 수호신 발견!</h2>
          <p style={styles.desc}>
            <b style={{ color: '#4488ff' }}>{fg.owner}</b>의 {fg.type === 'production' ? '생산형' : '방어형'} 수호신
          </p>
          <div style={styles.targetStats}>
            <div>ATK: {fg.stats?.atk || 0}</div>
            <div>DEF: {fg.stats?.def || 0}</div>
            <div>HP: {fg.stats?.hp || 0}</div>
          </div>
          <BattlePreview />
          <BattleOptions />
          <div style={styles.choices}>
            <button onClick={() => handleChoice('battle')} style={styles.battleBtn}>
              <span style={{ fontSize: 24 }}>⚔️</span><span>공격</span>
            </button>
          </div>
          <button onClick={closeBattleModal} style={styles.cancelBtn}>무시하기</button>
        </div>
      </div>
    )
  }

  // ─── 전투 애니메이션 (턴제 + QTE 궁극기) ──────────────────────
  if (battlePhase === 'animating' && currentBattle.result) {
    const result  = currentBattle.result
    const details = result.battleDetails || {}
    const atkPct  = (hpView.atk / (hpView.atkMax || 1)) * 100
    const defPct  = (hpView.def / (hpView.defMax || 1)) * 100

    return (
      <div style={styles.overlay}>
        {flashScreen && <div style={styles.flashOverlay} />}
        <div style={styles.battleModal}>
          <h2 style={styles.battleTitle}>
            ⚔ 턴 {currentTurnIdx + 1}/{turns.length}
            {arMode && <span style={{ color: '#00bfff', fontSize: 13, marginLeft: 8 }}>AR +20%</span>}
            {ultUsedDuringBattle && <span style={{ color: '#ffd700', fontSize: 13, marginLeft: 8 }}>⚡ ULTIMATE</span>}
          </h2>

          <div style={styles.battleField}>
            {/* 좌측 — 내 수호신 */}
            <div style={{ ...styles.fighter, transform: shakeSide === 'atk' ? 'translateX(-8px)' : 'none', transition: 'transform 0.15s' }}>
              <div style={styles.guardianIcon}>
                <GuardianBase type={details.attacker?.type || 'animal'} size={56} glow={ultUsedDuringBattle} />
              </div>
              <div style={styles.fighterName}>{details.attacker?.name || '나'}</div>
              <div style={styles.hpBar}>
                <div style={{ ...styles.hpFill, width: `${atkPct}%`, background: atkPct > 50 ? '#00ff88' : atkPct > 25 ? '#ffaa00' : '#ff4444' }} />
              </div>
              <div style={styles.hpText}>{hpView.atk} / {hpView.atkMax}</div>
              {damagePopup?.side === 'atk' && (
                <div style={{ ...styles.dmgPopup, color: damagePopup.crit ? '#ffd700' : '#ff4444', fontSize: damagePopup.crit ? 32 : 24 }}>
                  -{damagePopup.value}{damagePopup.crit ? '!' : ''}
                </div>
              )}
            </div>

            <div style={styles.vsText}>VS</div>

            {/* 우측 — 적 */}
            <div style={{ ...styles.fighter, transform: shakeSide === 'def' ? 'translateX(8px)' : 'none', transition: 'transform 0.15s' }}>
              <div style={styles.defenderGroup}>
                <div style={styles.guardianIcon}>
                  <GuardianBase type={details.defender?.type || 'animal'} size={56} />
                </div>
                {details.fixedGuardians?.map((fg, i) => <div key={i} style={styles.fixedIcon}>{fg.type === 'production' ? '⚙️' : '🛡️'}</div>)}
                {details.allyDefenders?.map((ad, i) => <div key={`ally-${i}`} style={styles.allyIcon}>🛡️</div>)}
              </div>
              <div style={styles.fighterName}>
                {details.defender?.name || '상대'}
                {details.isJointDefense && <span style={styles.jointTag}>공동방어</span>}
              </div>
              <div style={styles.hpBar}>
                <div style={{ ...styles.hpFill, width: `${defPct}%`, background: defPct > 50 ? '#00ff88' : defPct > 25 ? '#ffaa00' : '#ff4444' }} />
              </div>
              <div style={styles.hpText}>{hpView.def} / {hpView.defMax}</div>
              {damagePopup?.side === 'def' && (
                <div style={{ ...styles.dmgPopup, color: damagePopup.crit ? '#ffd700' : '#ff4444', fontSize: damagePopup.crit ? 32 : 24 }}>
                  -{damagePopup.value}{damagePopup.crit ? '!' : ''}
                </div>
              )}
            </div>
          </div>

          {/* QTE 궁극기 윈도우 (2초) */}
          {ultWindowOpen && (
            <button onClick={triggerUltimateInBattle} style={styles.qteButton}>
              ⚡ TAP TO ULTIMATE!
              <div style={styles.qteTimer} />
            </button>
          )}

          {/* 차후 카드 시스템 슬롯 — 옵션 C 확장 시 여기에 카드 3장 렌더 */}
          {/* <div style={styles.cardSlot}>...</div> */}
        </div>
        <style>{`
          @keyframes pulse-qte { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
          @keyframes pop-up { 0%{transform:translate(-50%,-10px);opacity:0} 30%{opacity:1} 100%{transform:translate(-50%,-50px);opacity:0} }
          @keyframes qte-timer { from{width:100%} to{width:0%} }
        `}</style>
      </div>
    )
  }

  // ─── 전투 결과 ────────────────────────────────────────────────
  if (currentBattle.status === 'completed' || battlePhase === 'result') {
    const result  = currentBattle.result
    if (!result) return null
    const isWinner = result.winner === 'attacker'
    const details  = result.battleDetails || {}

    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={{ fontSize: 64, marginBottom: 8 }}>{isWinner ? '🎉' : '💀'}</div>
          <h2 style={{ color: isWinner ? '#00ff88' : '#ff4444', fontSize: 28 }}>
            {isWinner ? '승리!' : '패배...'}
          </h2>

          {/* 사망 알림 */}
          {result.defenderDied && (
            <div style={styles.specialBanner} className="death-banner">
              ☠️ 상대방 격파! 초심자 레이어로 강등됩니다
            </div>
          )}

          {/* 졸업 알림 */}
          {result.graduated && (
            <div style={{ ...styles.specialBanner, background: 'rgba(255,215,0,0.15)', border: '1px solid #ffd700' }}>
              🏆 베테랑으로 승격되었습니다!
            </div>
          )}

          <div style={styles.resultStats}>
            <div style={styles.statRow}>
              <span>내 공격력</span>
              <span style={{ color: '#ff4444', fontWeight: 'bold' }}>{result.attackerPower}</span>
            </div>
            <div style={styles.statRow}>
              <span>상대 방어력</span>
              <span style={{ color: '#4488ff', fontWeight: 'bold' }}>{result.defenderPower}</span>
            </div>
            {arMode && (
              <div style={styles.statRow}>
                <span style={{ color: '#00bfff' }}>AR 보너스</span>
                <span style={{ color: '#00bfff' }}>×1.2 적용됨</span>
              </div>
            )}
            {details.isJointDefense && (
              <div style={styles.jointDefenseInfo}>동맹 공동방어 발동! ({details.allyDefenders?.length}명)</div>
            )}
          </div>

          {isWinner && result.absorbed && (
            <div style={styles.reward}>
              <h4>흡수한 능력치</h4>
              <div style={styles.absorbedStats}>
                <span>ATK +{result.absorbed.atk}</span>
                <span>DEF +{result.absorbed.def}</span>
                <span>HP +{result.absorbed.hp}</span>
              </div>
              <p style={{ color: '#ffd700', marginTop: 8 }}>+ 에너지 획득!</p>
            </div>
          )}

          {!isWinner && (
            <div style={styles.penalty}>
              {details.isFixedGuardianBattle
                ? <p>공격 실패! HP가 감소했습니다.</p>
                : <><p>영역을 빼앗겼습니다</p><p>고정 수호신이 파괴되었습니다</p></>}
            </div>
          )}

          <button onClick={() => { setBattlePhase('choice'); setAnimationStep(0); closeBattleModal() }} style={styles.closeBtn}>
            확인
          </button>
        </div>
      </div>
    )
  }

  // 대기 중
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
        <h2>대기 중...</h2>
        <p>상대방의 응답을 기다리고 있습니다.</p>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.9)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 3000
  },
  modal: {
    background: 'linear-gradient(180deg,#1a1a2e,#16213e)',
    padding: 28,
    borderRadius: 20,
    color: 'white',
    maxWidth: 380,
    width: '92%',
    textAlign: 'center',
    border: '2px solid #333',
    maxHeight: '90vh',
    overflowY: 'auto'
  },
  battleModal: {
    background: 'linear-gradient(180deg,#2a1a1a,#1a1a2e)',
    padding: 24, borderRadius: 20, color: 'white',
    maxWidth: 400, width: '95%', textAlign: 'center',
    border: '2px solid #ff4444'
  },
  alertIcon: { fontSize: 48, marginBottom: 8 },
  title: { color: '#ffd700', marginBottom: 12, fontSize: 22 },
  battleTitle: { color: '#ff4444', marginBottom: 16, fontSize: 20 },
  desc: { marginBottom: 16, color: '#ccc', fontSize: 14 },
  territoryInfo: {
    background: 'rgba(255,255,255,0.08)', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13
  },
  targetStats: {
    display: 'flex', justifyContent: 'space-around',
    background: 'rgba(255,255,255,0.08)', padding: 10, borderRadius: 8,
    marginBottom: 12, fontSize: 13, fontWeight: 'bold'
  },
  preview: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid #333',
    borderRadius: 10, padding: '10px 12px', marginBottom: 12
  },
  previewBar: {
    height: 8, background: '#222', borderRadius: 4, overflow: 'hidden', marginTop: 8
  },
  previewFill: { height: '100%', borderRadius: 4, transition: 'width 0.3s' },
  badge: {
    background: '#2a1a3a', color: '#a78bfa', fontSize: 10, padding: '2px 6px', borderRadius: 3
  },
  battleOptions: {
    display: 'flex', gap: 8, marginBottom: 14
  },
  optionBtn: {
    flex: 1, border: '1px solid #444', borderRadius: 8,
    padding: '8px 4px', fontSize: 12, fontWeight: 'bold', cursor: 'pointer'
  },
  choices: { display: 'flex', gap: 12, marginBottom: 14 },
  battleBtn: {
    flex: 1, background: 'linear-gradient(180deg,#ff4444,#cc0000)',
    color: 'white', border: 'none', padding: '14px 8px', borderRadius: 12,
    fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4
  },
  allianceBtn: {
    flex: 1, background: 'linear-gradient(180deg,#4488ff,#2255cc)',
    color: 'white', border: 'none', padding: '14px 8px', borderRadius: 12,
    fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4
  },
  cancelBtn: {
    background: 'transparent', color: '#666', border: '1px solid #333',
    padding: '10px 20px', borderRadius: 8, cursor: 'pointer', width: '100%', fontSize: 13
  },
  pathBtnA: {
    width: '100%', textAlign: 'left', cursor: 'pointer',
    background: 'linear-gradient(135deg, rgba(255,102,68,0.18), rgba(204,68,0,0.10))',
    border: '2px solid #ff6644', borderRadius: 12,
    padding: '12px 14px', marginBottom: 10, color: 'white'
  },
  pathBtnB: {
    width: '100%', textAlign: 'left', cursor: 'pointer',
    background: 'linear-gradient(135deg, rgba(170,68,255,0.18), rgba(102,0,153,0.10))',
    border: '2px solid #aa44ff', borderRadius: 12,
    padding: '12px 14px', marginBottom: 14, color: 'white'
  },
  pathHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  pathDesc: { fontSize: 12, color: '#ddd', lineHeight: 1.4 },
  pathMeta: { fontSize: 10, color: '#888', marginTop: 4 },
  pathBadgeFast: {
    marginLeft: 'auto', fontSize: 10, padding: '2px 6px', borderRadius: 4,
    background: '#ff6644', color: 'black', fontWeight: 'bold'
  },
  pathBadgeSafe: {
    marginLeft: 'auto', fontSize: 10, padding: '2px 6px', borderRadius: 4,
    background: '#aa44ff', color: 'black', fontWeight: 'bold'
  },
  backBtn: {
    background: 'transparent', color: '#888', border: 'none', cursor: 'pointer',
    fontSize: 12, alignSelf: 'flex-start', marginBottom: 4, padding: 4
  },
  battleField: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 8px', marginBottom: 12, position: 'relative'
  },
  fighter: { flex: 1, textAlign: 'center', position: 'relative' },
  hpBar: { height: 10, background: '#222', borderRadius: 5, overflow: 'hidden', marginBottom: 4, border: '1px solid #444' },
  hpFill: { height: '100%', transition: 'width 0.4s ease, background 0.3s' },
  hpText: { fontSize: 11, color: '#aaa', fontWeight: 'bold' },
  dmgPopup: {
    position: 'absolute', top: 30, left: '50%',
    fontWeight: 'bold', textShadow: '0 0 8px rgba(0,0,0,0.9)',
    pointerEvents: 'none', animation: 'pop-up 0.7s forwards', zIndex: 10
  },
  flashOverlay: {
    position: 'fixed', inset: 0, background: 'white', opacity: 0.4,
    pointerEvents: 'none', zIndex: 9999
  },
  qteButton: {
    width: '100%', padding: '14px 16px', marginTop: 8,
    background: 'linear-gradient(135deg, #ffd700, #ff8800)',
    color: 'black', border: 'none', borderRadius: 12,
    fontSize: 18, fontWeight: 'bold', cursor: 'pointer',
    boxShadow: '0 0 24px rgba(255,200,0,0.7)',
    animation: 'pulse-qte 0.4s infinite',
    position: 'relative', overflow: 'hidden'
  },
  qteTimer: {
    position: 'absolute', bottom: 0, left: 0, height: 4,
    background: 'rgba(0,0,0,0.6)', animation: 'qte-timer 2s linear forwards'
  },
  guardianIcon: { fontSize: 44, marginBottom: 6 },
  defenderGroup: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginBottom: 6 },
  fixedIcon: { fontSize: 26, filter: 'drop-shadow(0 0 4px #4488ff)' },
  allyIcon:  { fontSize: 26, filter: 'drop-shadow(0 0 4px #00ff88)' },
  fighterName: { fontSize: 13, fontWeight: 'bold', marginBottom: 6 },
  jointTag: {
    display: 'inline-block', background: '#00ff88', color: 'black',
    fontSize: 10, padding: '1px 4px', borderRadius: 3, marginLeft: 4
  },
  vsText: { fontSize: 22, fontWeight: 'bold', color: '#ffd700', padding: '0 8px' },
  powerBar: { height: 8, background: '#333', borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
  powerFill: { height: '100%', transition: 'width 0.3s ease' },
  powerText: { fontSize: 12, color: '#aaa' },
  hitEffects: { fontSize: 22, height: 28 },
  hitStar: { margin: '0 3px' },
  specialBanner: {
    background: 'rgba(255,68,68,0.12)', border: '1px solid #ff4444',
    color: '#ff8888', padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 13
  },
  resultStats: {
    background: 'rgba(0,0,0,0.3)', padding: 14, borderRadius: 10, margin: '12px 0'
  },
  statRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 },
  jointDefenseInfo: {
    color: '#00ff88', fontSize: 12, marginTop: 6, padding: 6,
    background: 'rgba(0,255,136,0.08)', borderRadius: 5
  },
  reward: {
    background: 'rgba(0,255,136,0.08)', border: '1px solid #00ff88',
    padding: 14, borderRadius: 10, margin: '12px 0'
  },
  absorbedStats: {
    display: 'flex', justifyContent: 'space-around', marginTop: 6,
    color: '#00ff88', fontWeight: 'bold', fontSize: 13
  },
  penalty: {
    background: 'rgba(255,68,68,0.08)', border: '1px solid #ff4444',
    color: '#ff4444', padding: 14, borderRadius: 10, margin: '12px 0', fontSize: 13
  },
  closeBtn: {
    background: 'linear-gradient(180deg,#00ff88,#00cc66)', color: 'black',
    border: 'none', padding: '12px 36px', borderRadius: 10,
    fontWeight: 'bold', cursor: 'pointer', marginTop: 6, fontSize: 15
  }
}
