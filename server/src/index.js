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
const formationRoutes = require('./routes/formation');
const { computeFormation, ATARI_DURATION_MS, ATARI_DAMAGE_PER_HOUR } = require('./routes/formation');
const tutorialRoutes = require('./routes/tutorial');
const missionsRoutes = require('./routes/missions');
const bossesRoutes = require('./routes/bosses');
const towersRoutes = require('./routes/towers');
const vassalRoutes = require('./routes/vassal');
const guildsRoutes = require('./routes/guilds');
const { processTowerSiege, processSiegeExpiry, respawnNpcsForActive } = require('./routes/towers');
const { spawnBosses, expireOldBosses } = require('./routes/bosses');
const { sendPush } = require('./fcm');

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
    // 1. 모든 유저의 에너지 생산 (본체 PRD × 0.5).
    //    cap = 5000 + level × 1000 (Lv1=6000, Lv30=35000) — levelTable.energyCapFor와 동일.
    await db.query(`
      UPDATE users u
      SET energy_currency = LEAST(5000 + COALESCE(u.level, 1) * 1000,
                                   u.energy_currency + FLOOR(COALESCE(g.prd, 0) * 0.5))
      FROM guardians g
      WHERE g.user_id = u.id
    `)

    // 2. 영역 유지비 차감 (levelTable.upkeepPerHour와 동일 곡선: 2×(r/100)^1.5)
    //    100m=2/h, 500m=22/h, 1km=63/h, 5km=707/h, 10km=2000/h
    await db.query(`
      UPDATE users u
      SET energy_currency = GREATEST(0, u.energy_currency - sub.total_cost)
      FROM (
        SELECT user_id,
               SUM(GREATEST(1, ROUND(2 * POWER(GREATEST(1, radius) / 100.0, 1.5)))) AS total_cost
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

    // 6.4. 속국 조공 분배 — 활성 계약마다 vassal 생산 PRD×0.5의 tribute_pct% 만큼 lord에게 이전
    let tributeTotal = 0, tributeCount = 0
    try {
      const tr = await db.query(`
        SELECT vc.id AS contract_id, vc.vassal_user_id, vc.lord_user_id, vc.tribute_to_lord_pct,
               COALESCE(g.prd, 0) AS prd
        FROM vassal_contracts vc
        LEFT JOIN guardians g ON g.user_id = vc.vassal_user_id
        WHERE vc.status = 'active'
      `)
      for (const r of tr.rows) {
        const amount = Math.floor((parseFloat(r.prd) || 0) * 0.5 * (parseFloat(r.tribute_to_lord_pct) || 0) / 100)
        if (amount <= 0) continue
        await db.query(`UPDATE users SET energy_currency = GREATEST(0, energy_currency - $1) WHERE id = $2`,
          [amount, r.vassal_user_id])
        await db.query(
          `UPDATE users SET energy_currency = LEAST(5000 + COALESCE(level, 1) * 1000, energy_currency + $1) WHERE id = $2`,
          [amount, r.lord_user_id])
        // 누적 조공 (P2-8) — UI에서 양측이 누적량 확인 가능
        await db.query(
          `UPDATE vassal_contracts SET tribute_total = COALESCE(tribute_total, 0) + $1 WHERE id = $2`,
          [amount, r.contract_id])
        tributeTotal += amount
        tributeCount++
      }
    } catch (e) { console.error('[Economy] tribute error:', e.message) }

    // 6.5. 모든 수호신 ult_charge 자연 충전 +5/시간 (cap 100)
    await db.query(`UPDATE guardians SET ult_charge = LEAST(100, COALESCE(ult_charge, 0) + 5)`)

    // 6.6. Nature 타워 인접 회복 (자기/동맹 타워 HP +5%/tick, 50m 내)
    //      box prefilter (50m → 약 0.00045°) 로 인덱스 활용
    try {
      const natures = await db.query(`SELECT fg.id, fg.user_id, t.center_lat, t.center_lng FROM fixed_guardians fg
                                       JOIN territories t ON fg.territory_id=t.id WHERE fg.tower_class='nature'`)
      const HEAL_DEG = 50 / 111000
      for (const n of natures.rows) {
        await db.query(
          `UPDATE fixed_guardians SET hp = LEAST(max_hp, hp + GREATEST(1, FLOOR(max_hp * 0.05)))
           WHERE id IN (
             SELECT fg2.id FROM fixed_guardians fg2 JOIN territories t2 ON fg2.territory_id=t2.id
             WHERE fg2.user_id = $1
               AND t2.center_lat BETWEEN $2 - $4 AND $2 + $4
               AND t2.center_lng BETWEEN $3 - $4 AND $3 + $4
               AND SQRT(POW((t2.center_lat - $2) * 111000, 2) + POW((t2.center_lng - $3) * 88700, 2)) < 50
           )`,
          [n.user_id, n.center_lat, n.center_lng, HEAL_DEG]
        ).catch(() => {})
      }
    } catch {}

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

    // 8.5. 바둑 호구(atari) 시스템 — 매 tick 진행
    let atariStarted = 0, atariResolved = 0, atariCaptures = 0
    try {
      const f = await computeFormation()
      const now = new Date()

      // 현재 atari 상태인 영역들 일괄 갱신
      for (const t of f.territories) {
        const isAtari = f.atariMap.has(t.id)
        const r = await db.query('SELECT atari_started_at, atari_damage FROM territories WHERE id=$1', [t.id])
        const cur = r.rows[0]
        if (!cur) continue

        if (isAtari) {
          const info = f.atariMap.get(t.id)
          if (!cur.atari_started_at) {
            // 새로 atari 진입 — 수비자에게 푸시 + 활동 로그
            await db.query(
              `UPDATE territories
               SET atari_started_at=NOW(), atari_attacker_ids=$2, atari_damage=$3
               WHERE id=$1`,
              [t.id, JSON.stringify(info.attackerUserIds), ATARI_DAMAGE_PER_HOUR]
            )
            try {
              const def = await db.query('SELECT fcm_token, username FROM users WHERE id=$1', [t.user_id])
              const tk = def.rows[0]?.fcm_token
              if (tk) {
                await sendPush(tk, '⚠ 영역 포위!',
                  `당신의 영역이 호구(atari) 상태입니다. 24시간 내 풀지 못하면 빼앗깁니다`,
                  { type: 'ATARI_STARTED', territoryId: t.id })
              }
              await db.query(
                `INSERT INTO activity_events (user_id, event_type, data) VALUES ($1, 'atari_started', $2)`,
                [t.user_id, JSON.stringify({ territoryId: t.id, attackerCount: info.attackerUserIds.length })]
              )
            } catch {}
            atariStarted++
          } else {
            // 이미 atari — 데미지 누적
            const elapsed = now - new Date(cur.atari_started_at)
            const newDamage = (cur.atari_damage || 0) + ATARI_DAMAGE_PER_HOUR
            await db.query(
              `UPDATE territories SET atari_damage=$2, atari_attacker_ids=$3 WHERE id=$1`,
              [t.id, newDamage, JSON.stringify(info.attackerUserIds)]
            )

            // 24시간 경과 → 자동 점령
            if (elapsed >= ATARI_DURATION_MS) {
              const newOwner = info.attackerUserIds[0]  // 첫 공격자에게 이전
              if (newOwner) {
                const oldOwner = t.user_id
                await db.query(
                  `UPDATE territories
                   SET user_id=$2, atari_started_at=NULL, atari_damage=0, atari_attacker_ids='[]', vulnerable_until=NULL
                   WHERE id=$1`,
                  [t.id, newOwner]
                )
                await db.query(`DELETE FROM fixed_guardians WHERE territory_id=$1`, [t.id])
                // XP 분배: 첫 공격자 +100, 나머지 +30
                await require('./levels').gainXp(null, newOwner, 100, 'atari_capture').catch(() => {})
                for (let i = 1; i < info.attackerUserIds.length; i++) {
                  await require('./levels').gainXp(null, info.attackerUserIds[i], 30, 'atari_assist').catch(() => {})
                }
                // 수비자에게 territory_lost 로그 + 푸시 + 영구 영역 손실 기록
                try {
                  await db.query(
                    `INSERT INTO territory_losses (former_owner_id, new_owner_id, center_lat, center_lng, radius, loss_type)
                     VALUES ($1, $2, $3, $4, $5, 'atari_capture')`,
                    [oldOwner, newOwner, t.center_lat, t.center_lng, t.radius]
                  )
                  await db.query(
                    `INSERT INTO activity_events (user_id, event_type, data) VALUES ($1, 'territory_lost', $2)`,
                    [oldOwner, JSON.stringify({ territoryId: t.id, takenBy: newOwner, attackers: info.attackerUserIds })]
                  )
                  const def = await db.query('SELECT fcm_token FROM users WHERE id=$1', [oldOwner])
                  if (def.rows[0]?.fcm_token) {
                    await sendPush(def.rows[0].fcm_token, '💀 영역 함락',
                      `호구에 막혔습니다. 영역을 잃었습니다`,
                      { type: 'TERRITORY_LOST', territoryId: t.id })
                  }
                } catch {}
                atariCaptures++
              }
            }
          }
        } else {
          // atari 해제
          if (cur.atari_started_at) {
            await db.query(
              `UPDATE territories
               SET atari_started_at=NULL, atari_damage=0, atari_attacker_ids='[]'
               WHERE id=$1`,
              [t.id]
            )
            atariResolved++
          }
        }
      }

      // 눈(eye) 표시
      for (const t of f.territories) {
        const inEye = f.eyeSet.has(t.id)
        await db.query(`UPDATE territories SET in_eye_zone=$2 WHERE id=$1`, [t.id, inEye])
      }
    } catch (e) {
      console.error('[Economy] formation tick error:', e.message)
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

    // 9.5. E) 동맹 단계 진행
    //   임시(temporary) 24h 만료 → 정식(permanent)으로 승격, 7일 후 자동 dissolve
    //   정식(permanent) stage_expires_at 만료 → dissolve
    //   I) 정식 stage_expires_at 24h 전에 양측 푸시 (1회만)
    let allyPromoted = 0, allyDissolved = 0, allyExpiringNotified = 0
    try {
      const promoted = await db.query(
        `UPDATE alliances SET stage='permanent',
                              stage_expires_at = NOW() + INTERVAL '7 days'
         WHERE active = true AND stage = 'temporary' AND stage_expires_at < NOW()
         RETURNING id, user_id_1, user_id_2`
      )
      allyPromoted = promoted.rows.length
      // 승격 알림 — 양측에 푸시
      for (const a of promoted.rows) {
        try {
          const u = await db.query('SELECT id, fcm_token FROM users WHERE id = ANY($1)', [[a.user_id_1, a.user_id_2]])
          for (const r of u.rows) {
            if (r.fcm_token) await sendPush(r.fcm_token, '🤝 동맹 정식 승격',
              '24시간 임시 동맹이 정식 동맹(7일)으로 승격되었습니다 — 효율 100%',
              { type: 'ALLIANCE_PROMOTED', allianceId: a.id })
          }
        } catch {}
      }

      // I) 정식 만료 24h 전 알림 (notification_sent_at NULL이거나 stage_expires_at 변경된 경우)
      const expiring = await db.query(
        `SELECT id, user_id_1, user_id_2, stage_expires_at FROM alliances
         WHERE active = true AND stage = 'permanent'
           AND stage_expires_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
           AND notification_sent_at IS NULL`
      )
      for (const a of expiring.rows) {
        try {
          const u = await db.query('SELECT id, fcm_token FROM users WHERE id = ANY($1)', [[a.user_id_1, a.user_id_2]])
          for (const r of u.rows) {
            if (r.fcm_token) await sendPush(r.fcm_token, '⏰ 동맹 만료 임박',
              '정식 동맹이 24시간 후 자동 해제됩니다. 유지하려면 새로 동맹 요청',
              { type: 'ALLIANCE_EXPIRING', allianceId: a.id })
          }
          await db.query(`UPDATE alliances SET notification_sent_at = NOW() WHERE id = $1`, [a.id])
        } catch {}
        allyExpiringNotified++
      }

      const dissolved = await db.query(
        `UPDATE alliances SET active = false, dissolved_at = NOW()
         WHERE active = true AND stage = 'permanent' AND stage_expires_at < NOW()
         RETURNING id`
      )
      allyDissolved = dissolved.rows.length
    } catch (e) { console.error('[Economy] alliance stage tick:', e.message) }

    // 9.6. H) Soft overlap defense_penalty 7일 회복
    //   created_at 기준 7일 경과한 영역의 0.7 → 1.0으로 자연 회복.
    //   신규 유저 좌절 완화 (영구 페널티 → 일시적 약점)
    let penaltyRecovered = 0
    try {
      const r = await db.query(
        `UPDATE territories SET defense_penalty = 1.0
         WHERE defense_penalty < 1.0 AND created_at < NOW() - INTERVAL '7 days'
         RETURNING id`
      )
      penaltyRecovered = r.rowCount || 0
    } catch (e) { console.error('[Economy] defense_penalty recovery:', e.message) }

    // 10. 7일 지난 activity_events 청소 (무한 누적 방지)
    let purgedEvents = 0
    try {
      const r = await db.query(
        `DELETE FROM activity_events WHERE created_at < NOW() - INTERVAL '7 days'`
      )
      purgedEvents = r.rowCount || 0
    } catch (e) {
      console.error('[Economy] activity_events purge error:', e.message)
    }

    console.log(`[Economy] tick — ${expired.rows.length} expired terr, ${partsDropped} parts(direct), ${partsToStorage} parts(storage), ${energyAuto} energy auto, tribute ${tributeTotal}/${tributeCount}, ${expiredBattles.rows.length} battles + ${expiredAlliances.rows.length} alliances expired, atari[+${atariStarted}/-${atariResolved}/cap${atariCaptures}], allies[promoted${allyPromoted}/expiring${allyExpiringNotified}/dissolved${allyDissolved}], penalty[recover${penaltyRecovered}], purged ${purgedEvents} old events`)
  } catch (err) {
    console.error('[Economy] tick error:', err.message)
  }
}

// 서버 시작 1분 후 첫 tick, 이후 1시간마다
setTimeout(() => {
  runEconomyTick()
  setInterval(runEconomyTick, 60 * 60 * 1000)
}, 60 * 1000)

// 6시간마다 월드 보스 스폰 + 만료 처리
setInterval(async () => {
  try { await spawnBosses(); await expireOldBosses() } catch (e) { console.error('boss tick', e.message) }
}, 6 * 60 * 60 * 1000)
// 서버 시작 후 첫 스폰 시도
setTimeout(() => spawnBosses().catch(() => {}), 30 * 1000)

// 5분마다 타워 공성 sub-tick (타워 vs 타워 + siege 만료 체크 + NPC respawn)
setInterval(async () => {
  try {
    const siege = await processTowerSiege()
    const expiry = await processSiegeExpiry()
    const respawn = await respawnNpcsForActive()
    if (siege.exchanges > 0 || expiry.captures > 0 || respawn.spawned > 0) {
      console.log(`[Siege] exchanges: ${siege.exchanges}, destroyed: ${siege.destroyed}, captures: ${expiry.captures}, NPC respawn: ${respawn.spawned}`)
    }
  } catch (e) { console.error('siege tick', e.message) }
}, 5 * 60 * 1000)

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
app.use('/api/formation', formationRoutes);
app.use('/api/tutorial', tutorialRoutes);
app.use('/api/missions', missionsRoutes);
app.use('/api/bosses',   bossesRoutes);
app.use('/api/towers',   towersRoutes);
app.use('/api/vassal',   vassalRoutes);
app.use('/api/guilds',   guildsRoutes);

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
