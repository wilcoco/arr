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
    await respondToBattle(choice)
  }

  // 영역 침입 감지됨
  if (currentBattle.status === 'intrusion_detected') {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <h2 style={styles.title}>영역 발견!</h2>
          <p style={styles.desc}>
            <b>{currentBattle.territory?.username}</b>님의 영역에 진입했습니다.
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
          <button onClick={closeBattleModal} style={styles.cancelBtn}>
            무시하고 지나가기
          </button>
        </div>
      </div>
    )
  }

  // 전투 완료
  if (currentBattle.status === 'completed' && currentBattle.result) {
    const result = currentBattle.result
    const isWinner = result.winner === 'attacker' // 내가 공격자

    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>
            {isWinner ? '🎉' : '💀'}
          </div>
          <h2 style={{ color: isWinner ? '#00ff88' : '#ff4444' }}>
            {isWinner ? '승리!' : '패배...'}
          </h2>

          <div style={styles.resultStats}>
            <div>내 전투력: {result.attackerPower}</div>
            <div>상대 전투력: {result.defenderPower}</div>
          </div>

          {isWinner && result.absorbed && (
            <div style={styles.reward}>
              <p>흡수한 능력치:</p>
              <p>ATK +{result.absorbed.atk} / DEF +{result.absorbed.def} / HP +{result.absorbed.hp}</p>
              <p style={{ color: '#ffd700' }}>+ 에너지 10 획득!</p>
            </div>
          )}

          {!isWinner && (
            <div style={styles.penalty}>
              <p>영역을 빼앗겼습니다</p>
              <p>고정 수호신이 파괴되었습니다</p>
            </div>
          )}

          <button onClick={closeBattleModal} style={styles.closeBtn}>
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
    background: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3000
  },
  modal: {
    background: '#1a1a2e',
    padding: 32,
    borderRadius: 16,
    color: 'white',
    maxWidth: 350,
    width: '90%',
    textAlign: 'center'
  },
  title: {
    color: '#ffd700',
    marginBottom: 16
  },
  desc: {
    marginBottom: 24,
    color: '#ccc'
  },
  choices: {
    display: 'flex',
    gap: 16,
    marginBottom: 16
  },
  battleBtn: {
    flex: 1,
    background: '#ff4444',
    color: 'white',
    border: 'none',
    padding: '16px',
    borderRadius: 8,
    fontSize: 16,
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
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  cancelBtn: {
    background: 'transparent',
    color: '#888',
    border: '1px solid #444',
    padding: '10px 20px',
    borderRadius: 8,
    cursor: 'pointer',
    width: '100%'
  },
  resultStats: {
    background: '#333',
    padding: 16,
    borderRadius: 8,
    margin: '16px 0'
  },
  reward: {
    color: '#00ff88',
    margin: '16px 0'
  },
  penalty: {
    color: '#ff4444',
    margin: '16px 0'
  },
  closeBtn: {
    background: '#00ff88',
    color: 'black',
    border: 'none',
    padding: '12px 32px',
    borderRadius: 8,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 16
  }
}
