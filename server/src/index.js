require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const migrate = require('./migrate');
const db = require('./db');

const guardianRoutes = require('./routes/guardian');
const territoryRoutes = require('./routes/territory');
const battleRoutes = require('./routes/battle');
const allianceRoutes = require('./routes/alliance');
const partsRoutes = require('./routes/parts');
const { generatePartStats } = require('./routes/parts');
const activityRoutes = require('./routes/activity');
const fixedGuardianRoutes = require('./routes/fixedGuardian');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 서버 시작 시 마이그레이션 실행
migrate().catch(console.error);

// ─── 경제 시스템: 1시간마다 실행 ─────────────────────────────────
function maintenanceCost(radius) {
  if (radius <= 50)  return 1
  if (radius <= 100) return 3
  if (radius <= 200) return 8
  if (radius <= 300) return 15
  return 30
}

async function runEconomyTick() {
  console.log('[Economy] tick started', new Date().toISOString())
  try {
    // 1. 모든 유저의 에너지 생산 (본체 PRD × 0.5)
    await db.query(`
      UPDATE users u
      SET energy_currency = LEAST(9999, u.energy_currency + FLOOR(COALESCE(g.prd, 0) * 0.5))
      FROM guardians g
      WHERE g.user_id = u.id
    `)

    // 2. 영역 유지비 차감 (유저별 전체 영역 유지비 합산)
    await db.query(`
      UPDATE users u
      SET energy_currency = GREATEST(0, u.energy_currency - sub.total_cost)
      FROM (
        SELECT user_id,
          SUM(CASE
            WHEN radius <= 50  THEN 1
            WHEN radius <= 100 THEN 3
            WHEN radius <= 200 THEN 8
            WHEN radius <= 300 THEN 15
            ELSE 30
          END) AS total_cost
        FROM territories
        GROUP BY user_id
      ) sub
      WHERE u.id = sub.user_id
    `)

    // 3. 에너지 0인 영역에 경고 시작 (아직 warning_at 없는 것만)
    await db.query(`
      UPDATE territories t
      SET warning_at = NOW()
      FROM users u
      WHERE t.user_id = u.id
        AND u.energy_currency = 0
        AND t.warning_at IS NULL
    `)

    // 4. 경고 12시간 초과 → 약화 시작
    await db.query(`
      UPDATE territories
      SET weakened_at = NOW()
      WHERE warning_at IS NOT NULL
        AND weakened_at IS NULL
        AND NOW() - warning_at > INTERVAL '12 hours'
    `)

    // 5. 경고 48시간 초과 → 영역 소멸 (고정 수호신도 삭제)
    const expired = await db.query(`
      SELECT id FROM territories
      WHERE warning_at IS NOT NULL
        AND NOW() - warning_at > INTERVAL '48 hours'
    `)
    for (const row of expired.rows) {
      await db.query('DELETE FROM fixed_guardians WHERE territory_id = $1', [row.id])
      await db.query('DELETE FROM territories WHERE id = $1', [row.id])
    }

    // 6. 에너지가 회복된 영역 경고 해제
    await db.query(`
      UPDATE territories t
      SET warning_at = NULL, weakened_at = NULL
      FROM users u
      WHERE t.user_id = u.id
        AND u.energy_currency > 0
        AND t.warning_at IS NOT NULL
    `)

    // 7. regenerate 패시브: 장착 중인 파츠에 regenerate 있는 수호신 HP 5% 회복
    await db.query(`
      UPDATE guardians g
      SET hp = LEAST(${2000}, g.hp + GREATEST(1, FLOOR(g.hp * 0.05)))
      WHERE g.user_id IN (
        SELECT DISTINCT p.user_id FROM parts p
        WHERE p.equipped = true
          AND p.passives ? 'regenerate'
      )
    `)

    // 8. 영역별 파츠 드랍 (하이브리드: 고정수호신 있으면 storage 누적, 없으면 직접 지급)
    const terrForParts = await db.query(`
      SELECT t.id, t.user_id, t.radius, g.type as guardian_type,
             fg.id AS fg_id, fg.storage_capacity,
             COALESCE((SELECT COUNT(*) FROM fixed_guardian_storage s WHERE s.fixed_guardian_id = fg.id), 0) AS stored_count
      FROM territories t
      LEFT JOIN guardians g ON g.user_id = t.user_id
      LEFT JOIN fixed_guardians fg ON fg.territory_id = t.id
    `)
    const slots = ['head', 'body', 'arms', 'legs', 'core']
    let partsDropped = 0
    let partsToStorage = 0
    let energyAuto = 0
    for (const t of terrForParts.rows) {
      let dropChance = 0, maxTier = 1, energyPerTick = 0
      if (t.radius <= 50)       { dropChance = 0.15; maxTier = 1; energyPerTick = 1 }
      else if (t.radius <= 100) { dropChance = 0.12; maxTier = 2; energyPerTick = 3 }
      else                      { dropChance = 0.08; maxTier = 2; energyPerTick = 8 }

      // 에너지는 항상 자동 지급 (소액)
      if (t.user_id && energyPerTick > 0) {
        await db.query('UPDATE users SET energy_currency = energy_currency + $1 WHERE id = $2',
          [energyPerTick, t.user_id])
        energyAuto += energyPerTick
      }

      // 파츠 드랍 시도
      if (Math.random() < dropChance) {
        const slot = slots[Math.floor(Math.random() * slots.length)]
        const tier = (maxTier === 2 && Math.random() < 0.25) ? 2 : 1
        const gType = t.guardian_type || 'animal'
        const { stat_bonuses, passives } = generatePartStats(slot, tier, gType)

        const cap = parseInt(t.storage_capacity) || 5
        const stored = parseInt(t.stored_count) || 0

        if (t.fg_id && stored < cap) {
          // 고정 수호신 있음 + 여유 있음 → storage에 누적
          await db.query(
            `INSERT INTO fixed_guardian_storage (fixed_guardian_id, item_type, data)
             VALUES ($1, 'part', $2)`,
            [t.fg_id, JSON.stringify({ slot, tier, guardian_type: gType, stat_bonuses, passives })]
          )
          partsToStorage++
        } else if (!t.fg_id) {
          // 고정 수호신 없음 → 종전대로 직접 지급
          await db.query(
            `INSERT INTO parts (user_id, slot, tier, guardian_type, stat_bonuses, passives)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [t.user_id, slot, tier, gType, JSON.stringify(stat_bonuses), JSON.stringify(passives)]
          )
          partsDropped++
        }
        // else: storage가 가득 참 → 생산 정지 (skip)

        await db.query(
          `INSERT INTO activity_events (user_id, event_type, data) VALUES ($1, 'part_drop', $2)`,
          [t.user_id, JSON.stringify({ slot, tier, territoryId: t.id, toStorage: !!t.fg_id })]
        ).catch(() => {})
      }
    }

    // 9. 만료된 pending 전투/동맹 정리
    const expiredBattles = await db.query(
      `UPDATE battles SET status='expired'
       WHERE status='pending' AND expires_at < NOW() RETURNING id`
    )
    const expiredAlliances = await db.query(
      `UPDATE alliance_requests SET status='expired'
       WHERE status='pending' AND expires_at < NOW() RETURNING id`
    )

    console.log(`[Economy] tick complete — ${expired.rows.length} terr expired, ${partsDropped} direct parts, ${partsToStorage} storage parts, ${energyAuto} energy auto, ${expiredBattles.rows.length} battles + ${expiredAlliances.rows.length} alliances expired`)
  } catch (err) {
    console.error('[Economy] tick error:', err.message)
  }
}

// 서버 시작 1분 후 첫 tick, 이후 1시간마다
setTimeout(() => {
  runEconomyTick()
  setInterval(runEconomyTick, 60 * 60 * 1000)
}, 60 * 1000)

// 1분마다 pending 요청 만료 체크 (전투 60초, 동맹 5분 보장)
setInterval(async () => {
  try {
    await db.query(`UPDATE battles SET status='expired' WHERE status='pending' AND expires_at < NOW()`)
    await db.query(`UPDATE alliance_requests SET status='expired' WHERE status='pending' AND expires_at < NOW()`)
  } catch (e) { /* 무시 */ }
}, 60 * 1000)

// API Routes
app.use('/api/guardian', guardianRoutes);
app.use('/api/territory', territoryRoutes);
app.use('/api/battle', battleRoutes);
app.use('/api/alliance', allianceRoutes);
app.use('/api/parts', partsRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/fixed-guardian', fixedGuardianRoutes);

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
