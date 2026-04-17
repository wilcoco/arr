import { useGameStore } from '../stores/gameStore'

export default function BattleModal() {
  const {
    battleModalOpen,
    currentBattle,
    closeBattleModal,
    respondToBattle,
    useUltimate
  } = useGameStore()

  if (!battleModalOpen || !currentBattle) return null

  const handleChoice = async (choice) => {
    const result = await respondToBattle(choice)
    if (result.result === 'alliance') {
      alert('동맹이 체결되었습니다!')
      closeBattleModal()
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>영역 침입 감지!</h2>

        {currentBattle.status === 'pending' && (
          <>
            <p style={styles.desc}>
              상대방이 당신의 영역에 진입했습니다.
              전투 또는 동맹을 선택하세요.
            </p>
            <div style={styles.choices}>
              <button
                onClick={() => handleChoice('battle')}
                style={styles.battleBtn}
              >
                전투
              </button>
              <button
                onClick={() => handleChoice('alliance')}
                style={styles.allianceBtn}
              >
                동맹 제안
              </button>
            </div>
          </>
        )}

        {currentBattle.status === 'in_progress' && (
          <>
            <div style={styles.battleArea}>
              <div style={styles.fighter}>
                <div style={{ fontSize: 48 }}>🦁</div>
                <div>나</div>
                <div style={styles.hp}>HP: {currentBattle.myHp || 100}</div>
              </div>
              <div style={styles.vs}>VS</div>
              <div style={styles.fighter}>
                <div style={{ fontSize: 48 }}>🤖</div>
                <div>상대</div>
                <div style={styles.hp}>HP: {currentBattle.enemyHp || 100}</div>
              </div>
            </div>
            <button
              onClick={useUltimate}
              style={styles.ultimateBtn}
              disabled={!currentBattle.ultimateReady}
            >
              궁극기 발동!
            </button>
          </>
        )}

        {currentBattle.status === 'completed' && (
          <>
            <div style={styles.result}>
              {currentBattle.winner === 'me' ? (
                <>
                  <div style={{ fontSize: 48 }}>🎉</div>
                  <div>승리!</div>
                  <div style={styles.reward}>
                    흡수한 능력치: ATK +{currentBattle.absorbed?.atk || 0}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 48 }}>💀</div>
                  <div>패배...</div>
                  <div style={styles.penalty}>
                    영역을 빼앗겼습니다
                  </div>
                </>
              )}
            </div>
            <button onClick={closeBattleModal} style={styles.closeBtn}>
              확인
            </button>
          </>
        )}
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
    background: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    background: '#1a1a2e',
    padding: 32,
    borderRadius: 16,
    color: 'white',
    maxWidth: 400,
    width: '90%',
    textAlign: 'center'
  },
  title: {
    color: '#ff4444',
    marginBottom: 16
  },
  desc: {
    marginBottom: 24,
    color: '#ccc'
  },
  choices: {
    display: 'flex',
    gap: 16
  },
  battleBtn: {
    flex: 1,
    background: '#ff4444',
    color: 'white',
    border: 'none',
    padding: '16px',
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  allianceBtn: {
    flex: 1,
    background: '#4488ff',
    color: 'white',
    border: 'none',
    padding: '16px',
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  battleArea: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    margin: '24px 0'
  },
  fighter: {
    textAlign: 'center'
  },
  vs: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ff4444'
  },
  hp: {
    color: '#00ff88',
    marginTop: 8
  },
  ultimateBtn: {
    width: '100%',
    background: 'linear-gradient(45deg, #ff6b6b, #ffd93d)',
    color: 'black',
    border: 'none',
    padding: '16px',
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  result: {
    margin: '24px 0'
  },
  reward: {
    color: '#00ff88',
    marginTop: 12
  },
  penalty: {
    color: '#ff4444',
    marginTop: 12
  },
  closeBtn: {
    background: '#333',
    color: 'white',
    border: 'none',
    padding: '12px 32px',
    borderRadius: 8,
    cursor: 'pointer'
  }
}
