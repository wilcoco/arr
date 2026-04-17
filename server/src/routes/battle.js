const express = require('express');
const router = express.Router();

// 전투/동맹 선택 요청
router.post('/request', async (req, res) => {
  const { attackerId, defenderId, territoryId, choice } = req.body;
  // choice: 'battle' or 'alliance'
  // TODO: 양쪽 플레이어에게 알림 전송 (FCM)
  res.json({
    success: true,
    battleId: 'battle_' + Date.now(),
    status: 'pending',
    expiresAt: new Date(Date.now() + 60000).toISOString() // 1분 내 응답
  });
});

// 상대방 선택 응답
router.post('/respond', async (req, res) => {
  const { battleId, userId, choice } = req.body;
  // TODO: 양쪽 선택 확인 후 전투/동맹 결정
  res.json({
    success: true,
    result: 'battle' // or 'alliance'
  });
});

// 전투 실행 (서버에서 계산)
router.post('/execute', async (req, res) => {
  const { battleId } = req.body;
  // TODO: 전투 로직 실행
  const result = executeBattle(battleId);
  res.json(result);
});

// 궁극기 발동
router.post('/ultimate', async (req, res) => {
  const { battleId, userId } = req.body;
  // TODO: 궁극기 효과 적용
  res.json({
    success: true,
    effect: 'damage_boost',
    value: 1.5
  });
});

// 전투 결과 조회
router.get('/:battleId', async (req, res) => {
  const { battleId } = req.params;
  // TODO: DB에서 전투 결과 조회
  res.json({ battle: null });
});

// 전투 계산 함수
function executeBattle(battleId) {
  // TODO: 실제 DB에서 양쪽 스탯 조회 후 계산
  const attackerPower = 100 * (1 + Math.random() * 0.2);
  const defenderPower = 80 * (1 + Math.random() * 0.2);

  const winner = attackerPower > defenderPower ? 'attacker' : 'defender';

  return {
    battleId,
    winner,
    attackerPower: Math.round(attackerPower),
    defenderPower: Math.round(defenderPower),
    absorbed: winner === 'attacker' ? { atk: 5, def: 3 } : null,
    completedAt: new Date().toISOString()
  };
}

module.exports = router;
