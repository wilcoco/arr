const express = require('express');
const router = express.Router();

// 동맹 체결
router.post('/create', async (req, res) => {
  const { userId1, userId2 } = req.body;
  // TODO: DB에 동맹 관계 저장
  res.json({
    success: true,
    alliance: {
      id: 'alliance_' + Date.now(),
      members: [userId1, userId2],
      createdAt: new Date().toISOString(),
      active: true
    }
  });
});

// 배신 (동맹 해제)
router.post('/betray', async (req, res) => {
  const { allianceId, betrayerId } = req.body;
  // TODO: 동맹 해제 처리
  res.json({
    success: true,
    message: 'Alliance dissolved. Joint defense disabled.'
  });
});

// 내 동맹 목록
router.get('/my/:userId', async (req, res) => {
  const { userId } = req.params;
  // TODO: DB에서 조회
  res.json({ alliances: [] });
});

// 공동 방어 체크 (인접 영역 동맹 확인)
router.post('/check-joint-defense', async (req, res) => {
  const { territoryId, attackerId } = req.body;
  // TODO: 인접 동맹 영역 확인
  res.json({
    hasJointDefense: false,
    allies: []
  });
});

module.exports = router;
