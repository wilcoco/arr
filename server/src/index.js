require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const migrate = require('./migrate');

const guardianRoutes = require('./routes/guardian');
const territoryRoutes = require('./routes/territory');
const battleRoutes = require('./routes/battle');
const allianceRoutes = require('./routes/alliance');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 서버 시작 시 마이그레이션 실행
migrate().catch(console.error);

// API Routes
app.use('/api/guardian', guardianRoutes);
app.use('/api/territory', territoryRoutes);
app.use('/api/battle', battleRoutes);
app.use('/api/alliance', allianceRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 클라이언트 정적 파일 서빙 (프로덕션)
const clientPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientPath));

// SPA 라우팅 - 모든 요청을 index.html로
app.get('*', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
