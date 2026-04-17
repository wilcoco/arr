const express = require('express');
const router = express.Router();

// 수호신 생성
router.post('/create', async (req, res) => {
  const { userId, type, parts } = req.body;
  // TODO: DB에 수호신 생성
  res.json({
    success: true,
    guardian: {
      id: 'guardian_' + Date.now(),
      userId,
      type,
      parts,
      stats: calculateStats(type, parts)
    }
  });
});

// 수호신 조회
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;
  // TODO: DB에서 조회
  res.json({ guardian: null });
});

// 능력치 분배 (고정/생산 수호신 배치)
router.post('/distribute', async (req, res) => {
  const { guardianId, targetType, stats } = req.body;
  // TODO: 능력치 분배 로직
  res.json({ success: true });
});

// 능력치 계산 함수
function calculateStats(type, parts) {
  const baseStats = {
    animal: { atk: 10, def: 8, hp: 100, abs: 15, prd: 10, spd: 15 },
    robot: { atk: 15, def: 15, hp: 120, abs: 10, prd: 8, spd: 8 },
    aircraft: { atk: 12, def: 8, hp: 80, abs: 12, prd: 12, spd: 12, rng: 20, ter: 15 }
  };

  return baseStats[type] || baseStats.animal;
}

module.exports = router;
