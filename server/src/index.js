require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// Routes
app.use('/api/guardian', guardianRoutes);
app.use('/api/territory', territoryRoutes);
app.use('/api/battle', battleRoutes);
app.use('/api/alliance', allianceRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
