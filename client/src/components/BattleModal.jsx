import { useState, useEffect } from 'react'
import { useGameStore } from '../stores/gameStore'

export default function BattleModal() {
  const {
    battleModalOpen,
    currentBattle,
    closeBattleModal,
    respondToBattle
  } = useGameStore()

  const [battlePhase, setBattlePhase] = useState('choice')
  const [animationStep, setAnimationStep] = useState(0)
  const [displayedDamage, setDisplayedDamage] = useState({ attacker: 0, defender: 0 })

  useEffect(() => {
    if (currentBattle?.status === 'animating' && currentBattle.result) {
      runBattleAnimation(currentBattle.result)
    }
  }, [currentBattle?.status])

  const runBattleAnimation = async (result) => {
    setBattlePhase('animating')
    const details = result.battleDetails

    // 단계별 애니메이션
    for (let i = 1; i <= 5; i++) {
      await new Promise(r => setTimeout(r, 600))
      setAnimationStep(i)

      // 데미지 점점 증가
      const progress = i / 5
      setDisplayedDamage({
        attacker: Math.round(result.attackerPower * progress),
        defender: Math.round(result.defenderPower * progress)
      })
    }

    await new Promise(r => setTimeout(r, 500))
    setBattlePhase('result')
  }

  if (!battleModalOpen || !currentBattle) return null

  const handleChoice = async (choice) => {
    if (choice === 'battle') {
      setBattlePhase('waiting')
    }
    await respondToBattle(choice)
  }

  // 영역 침입 감지됨 - 선택 화면
  if (currentBattle.status === 'intrusion_detected' && battlePhase === 'choice') {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.alertIcon}>⚔️</div>
          <h2 style={styles.title}>영역 발견!</h2>
          <p style={styles.desc}>
            <b style={{ color: '#ffd700' }}>{currentBattle.territory?.username}</b>님의 영역에 진입했습니다.
          </p>

          <div style={styles.territoryInfo}>
            <div>영역 반경: {currentBattle.territory?.radius}m</div>
          </div>

          <div style={styles.choices}>
            <button onClick={() => handleChoice('battle')} style={styles.battleBtn}>
              <span style={{ fontSize: 24 }}>⚔️</span>
              <span>전투</span>
            </button>
            <button onClick={() => handleChoice('alliance')} style={styles.allianceBtn}>
              <span style={{ fontSize: 24 }}>🤝</span>
              <span>동맹 제안</span>
            </button>
          </div>

          <button onClick={closeBattleModal} style={styles.cancelBtn}>
            무시하고 지나가기
          </button>
        </div>
      </div>
    )
  }

  // 플레이어 직접 조우
  if (currentBattle.status === 'player_encounter' && battlePhase === 'choice') {
    const player = currentBattle.targetPlayer
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.alertIcon}>
            {player.guardian?.type === 'animal' ? '🦁' :
             player.guardian?.type === 'robot' ? '🤖' :
             player.guardian?.type === 'aircraft' ? '✈️' : '👤'}
          </div>
          <h2 style={styles.title}>플레이어 발견!</h2>
          <p style={styles.desc}>
            <b style={{ color: '#ff4444' }}>{player.username}</b>
          </p>

          {player.guardian && (
            <div style={styles.targetStats}>
              <div>ATK: {player.guardian.stats?.atk || '?'}</div>
              <div>DEF: {player.guardian.stats?.def || '?'}</div>
              <div>HP: {player.guardian.stats?.hp || '?'}</div>
            </div>
          )}

          <div style={styles.choices}>
            <button onClick={() => handleChoice('battle')} style={styles.battleBtn}>
              <span style={{ fontSize: 24 }}>⚔️</span>
              <span>전투</span>
            </button>
            <button onClick={() => handleChoice('alliance')} style={styles.allianceBtn}>
              <span style={{ fontSize: 24 }}>🤝</span>
              <span>동맹 제안</span>
            </button>
          </div>

          <button onClick={closeBattleModal} style={styles.cancelBtn}>
            무시하기
          </button>
        </div>
      </div>
    )
  }

  // 고정 수호신 직접 공격
  if (currentBattle.status === 'fixed_guardian_attack' && battlePhase === 'choice') {
    const fg = currentBattle.targetFixedGuardian
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.alertIcon}>
            {fg.type === 'production' ? '⚙️' : '🛡️'}
          </div>
          <h2 style={styles.title}>고정 수호신 발견!</h2>
          <p style={styles.desc}>
            <b style={{ color: '#4488ff' }}>{fg.owner}</b>의 {fg.type === 'production' ? '생산형' : '방어형'} 수호신
          </p>

          <div style={styles.targetStats}>
            <div>ATK: {fg.stats?.atk || 0}</div>
            <div>DEF: {fg.stats?.def || 0}</div>
            <div>HP: {fg.stats?.hp || 0}</div>
          </div>

          <div style={styles.choices}>
            <button onClick={() => handleChoice('battle')} style={styles.battleBtn}>
              <span style={{ fontSize: 24 }}>⚔️</span>
              <span>공격</span>
            </button>
          </div>

          <button onClick={closeBattleModal} style={styles.cancelBtn}>
            무시하기
          </button>
        </div>
      </div>
    )
  }

  // 전투 애니메이션
  if (battlePhase === 'animating' && currentBattle.result) {
    const result = currentBattle.result
    const details = result.battleDetails || {}

    return (
      <div style={styles.overlay}>
        <div style={styles.battleModal}>
          <h2 style={styles.battleTitle}>전투 중!</h2>

          <div style={styles.battleField}>
            {/* 공격자 */}
            <div style={styles.fighter}>
              <div style={{
                ...styles.guardianIcon,
                animation: animationStep % 2 === 1 ? 'shake 0.3s' : 'none'
              }}>
                {details.attacker?.type === 'animal' ? '🦁' :
                 details.attacker?.type === 'robot' ? '🤖' : '✈️'}
              </div>
              <div style={styles.fighterName}>{details.attacker?.name}</div>
              <div style={styles.powerBar}>
                <div style={{
                  ...styles.powerFill,
                  width: `${Math.min(100, (displayedDamage.attacker / (result.defenderPower || 100)) * 100)}%`,
                  background: '#ff4444'
                }} />
              </div>
              <div style={styles.powerText}>ATK: {displayedDamage.attacker}</div>
            </div>

            {/* VS */}
            <div style={styles.vsText}>VS</div>

            {/* 방어자 */}
            <div style={styles.fighter}>
              <div style={styles.defenderGroup}>
                <div style={{
                  ...styles.guardianIcon,
                  animation: animationStep % 2 === 0 ? 'shake 0.3s' : 'none'
                }}>
                  {details.defender?.type === 'animal' ? '🦁' :
                   details.defender?.type === 'robot' ? '🤖' : '✈️'}
                </div>
                {/* 고정 수호신들 */}
                {details.fixedGuardians?.map((fg, i) => (
                  <div key={i} style={styles.fixedIcon}>
                    {fg.type === 'production' ? '⚙️' : '🛡️'}
                  </div>
                ))}
                {/* 동맹 수호신들 */}
                {details.allyDefenders?.map((ad, i) => (
                  <div key={`ally-${i}`} style={styles.allyIcon}>
                    🛡️
                    <span style={styles.allyLabel}>{ad.owner}</span>
                  </div>
                ))}
              </div>
              <div style={styles.fighterName}>
                {details.defender?.name}
                {details.isJointDefense && <span style={styles.jointTag}>공동방어</span>}
              </div>
              <div style={styles.powerBar}>
                <div style={{
                  ...styles.powerFill,
                  width: `${Math.min(100, (displayedDamage.defender / (result.attackerPower || 100)) * 100)}%`,
                  background: '#4488ff'
                }} />
              </div>
              <div style={styles.powerText}>DEF: {displayedDamage.defender}</div>
            </div>
          </div>

          <div style={styles.hitEffects}>
            {[...Array(animationStep)].map((_, i) => (
              <span key={i} style={styles.hitStar}>💥</span>
            ))}
          </div>
        </div>

        <style>{`
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
          }
        `}</style>
      </div>
    )
  }

  // 전투 완료 - 결과
  if (currentBattle.status === 'completed' || battlePhase === 'result') {
    const result = currentBattle.result
    if (!result) return null

    const isWinner = result.winner === 'attacker'
    const details = result.battleDetails || {}

    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>
            {isWinner ? '🎉' : '💀'}
          </div>
          <h2 style={{ color: isWinner ? '#00ff88' : '#ff4444', fontSize: 28 }}>
            {isWinner ? '승리!' : '패배...'}
          </h2>

          <div style={styles.resultStats}>
            <div style={styles.statRow}>
              <span>내 공격력</span>
              <span style={{ color: '#ff4444', fontWeight: 'bold' }}>{result.attackerPower}</span>
            </div>
            <div style={styles.statRow}>
              <span>상대 방어력</span>
              <span style={{ color: '#4488ff', fontWeight: 'bold' }}>{result.defenderPower}</span>
            </div>
            {details.isJointDefense && (
              <div style={styles.jointDefenseInfo}>
                동맹 공동방어 발동! ({details.allyDefenders?.length}명)
              </div>
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
              <p style={{ color: '#ffd700', marginTop: 8 }}>+ 에너지 10 획득!</p>
            </div>
          )}

          {!isWinner && (
            <div style={styles.penalty}>
              {details.isFixedGuardianBattle ? (
                <p>공격 실패! HP가 감소했습니다.</p>
              ) : (
                <>
                  <p>영역을 빼앗겼습니다</p>
                  <p>고정 수호신이 파괴되었습니다</p>
                </>
              )}
            </div>
          )}

          {isWinner && details.isFixedGuardianBattle && (
            <div style={{ color: '#ffd700', marginBottom: 12 }}>
              고정 수호신을 파괴했습니다!
            </div>
          )}

          <button onClick={() => {
            setBattlePhase('choice')
            setAnimationStep(0)
            closeBattleModal()
          }} style={styles.closeBtn}>
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
        <div style={styles.loadingSpinner}>⏳</div>
        <h2>대기 중...</h2>
        <p>상대방의 응답을 기다리고 있습니다.</p>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3000
  },
  modal: {
    background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
    padding: 32,
    borderRadius: 20,
    color: 'white',
    maxWidth: 380,
    width: '90%',
    textAlign: 'center',
    border: '2px solid #333'
  },
  battleModal: {
    background: 'linear-gradient(180deg, #2a1a1a 0%, #1a1a2e 100%)',
    padding: 24,
    borderRadius: 20,
    color: 'white',
    maxWidth: 400,
    width: '95%',
    textAlign: 'center',
    border: '2px solid #ff4444'
  },
  alertIcon: {
    fontSize: 48,
    marginBottom: 8
  },
  title: {
    color: '#ffd700',
    marginBottom: 12,
    fontSize: 24
  },
  battleTitle: {
    color: '#ff4444',
    marginBottom: 16,
    fontSize: 22
  },
  desc: {
    marginBottom: 20,
    color: '#ccc',
    fontSize: 15
  },
  territoryInfo: {
    background: 'rgba(255,255,255,0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 14
  },
  targetStats: {
    display: 'flex',
    justifyContent: 'space-around',
    background: 'rgba(255,255,255,0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 14,
    fontWeight: 'bold'
  },
  choices: {
    display: 'flex',
    gap: 12,
    marginBottom: 16
  },
  battleBtn: {
    flex: 1,
    background: 'linear-gradient(180deg, #ff4444 0%, #cc0000 100%)',
    color: 'white',
    border: 'none',
    padding: '16px 8px',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4
  },
  allianceBtn: {
    flex: 1,
    background: 'linear-gradient(180deg, #4488ff 0%, #2255cc 100%)',
    color: 'white',
    border: 'none',
    padding: '16px 8px',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4
  },
  cancelBtn: {
    background: 'transparent',
    color: '#666',
    border: '1px solid #333',
    padding: '10px 20px',
    borderRadius: 8,
    cursor: 'pointer',
    width: '100%',
    fontSize: 14
  },
  battleField: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 10px',
    marginBottom: 16
  },
  fighter: {
    flex: 1,
    textAlign: 'center'
  },
  guardianIcon: {
    fontSize: 48,
    marginBottom: 8
  },
  defenderGroup: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 8
  },
  fixedIcon: {
    fontSize: 28,
    filter: 'drop-shadow(0 0 4px #4488ff)'
  },
  allyIcon: {
    fontSize: 28,
    position: 'relative',
    filter: 'drop-shadow(0 0 4px #00ff88)'
  },
  allyLabel: {
    position: 'absolute',
    bottom: -12,
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: 8,
    background: '#00ff88',
    color: 'black',
    padding: '1px 4px',
    borderRadius: 4,
    whiteSpace: 'nowrap'
  },
  fighterName: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8
  },
  jointTag: {
    display: 'inline-block',
    background: '#00ff88',
    color: 'black',
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
    marginLeft: 6
  },
  vsText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffd700',
    padding: '0 10px'
  },
  powerBar: {
    height: 8,
    background: '#333',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 4
  },
  powerFill: {
    height: '100%',
    transition: 'width 0.3s ease'
  },
  powerText: {
    fontSize: 12,
    color: '#aaa'
  },
  hitEffects: {
    fontSize: 24,
    height: 30
  },
  hitStar: {
    margin: '0 4px'
  },
  resultStats: {
    background: 'rgba(0,0,0,0.3)',
    padding: 16,
    borderRadius: 12,
    margin: '16px 0'
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 8,
    fontSize: 15
  },
  jointDefenseInfo: {
    color: '#00ff88',
    fontSize: 13,
    marginTop: 8,
    padding: 8,
    background: 'rgba(0,255,136,0.1)',
    borderRadius: 6
  },
  reward: {
    background: 'rgba(0,255,136,0.1)',
    border: '1px solid #00ff88',
    padding: 16,
    borderRadius: 12,
    margin: '16px 0'
  },
  absorbedStats: {
    display: 'flex',
    justifyContent: 'space-around',
    marginTop: 8,
    color: '#00ff88',
    fontWeight: 'bold'
  },
  penalty: {
    background: 'rgba(255,68,68,0.1)',
    border: '1px solid #ff4444',
    color: '#ff4444',
    padding: 16,
    borderRadius: 12,
    margin: '16px 0'
  },
  closeBtn: {
    background: 'linear-gradient(180deg, #00ff88 0%, #00cc66 100%)',
    color: 'black',
    border: 'none',
    padding: '14px 40px',
    borderRadius: 10,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 8,
    fontSize: 16
  },
  loadingSpinner: {
    fontSize: 48,
    marginBottom: 16,
    animation: 'spin 1s linear infinite'
  }
}
