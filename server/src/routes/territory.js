const express = require('express');
const router = express.Router();

// 영역 확장
router.post('/expand', async (req, res) => {
  const { userId, lat, lng, radius } = req.body;
  // TODO: PostGIS로 영역 생성
  res.json({
    success: true,
    territory: {
      id: 'territory_' + Date.now(),
      userId,
      center: { lat, lng },
      radius,
      createdAt: new Date().toISOString()
    }
  });
});

// 고정 수호신 배치
router.post('/place-guardian', async (req, res) => {
  const { territoryId, guardianId, lat, lng, stats } = req.body;
  // TODO: 고정 수호신 배치 로직
  res.json({
    success: true,
    fixedGuardian: {
      id: 'fixed_' + Date.now(),
      territoryId,
      position: { lat, lng },
      stats
    }
  });
});

// 주변 영역 조회 (침입 감지용)
router.get('/nearby', async (req, res) => {
  const { lat, lng, radius } = req.query;
  // TODO: PostGIS 쿼리로 주변 영역 조회
  // SELECT * FROM territories
  // WHERE ST_DWithin(geom, ST_MakePoint(lng, lat)::geography, radius)
  res.json({ territories: [] });
});

// 내 영역 목록
router.get('/my/:userId', async (req, res) => {
  const { userId } = req.params;
  // TODO: DB에서 조회
  res.json({ territories: [] });
});

// 영역 침입 체크
router.post('/check-intrusion', async (req, res) => {
  const { userId, lat, lng } = req.body;
  // TODO: 다른 플레이어 영역 침입 여부 체크
  res.json({
    intruded: false,
    territory: null
  });
});

module.exports = router;
