// β 모델 마이그레이션
//   v2_beta_redesign: 모든 게임플레이 테이블 wipe + 신규 스키마 (1 tower = 1 territory)
//   _migrations 테이블로 1회만 실행 보장 — 이후 재시작에서는 wipe 안 함.
const db = require('./db')

async function migrate() {
  console.log('[migrate] starting...')
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )`)

    const v2Done = await db.query(`SELECT name FROM _migrations WHERE name = 'v2_beta_redesign'`)
    if (v2Done.rows.length === 0) {
      console.log('[migrate] applying v2_beta_redesign — WIPING all gameplay tables and recreating schema')
      await wipeAndRecreate()
      await db.query(`INSERT INTO _migrations (name) VALUES ('v2_beta_redesign')`)
      console.log('[migrate] v2_beta_redesign applied.')
    } else {
      console.log('[migrate] v2_beta_redesign already applied — skipping wipe, only running idempotent forward-compat ALTERs.')
      await ensureSchema()
    }
    console.log('[migrate] complete.')
  } catch (err) {
    console.error('[migrate] failed:', err)
  }
}

// 게임플레이 테이블 전체 DROP CASCADE → 신규 스키마 CREATE
async function wipeAndRecreate() {
  // 의존 순서 무시 — CASCADE로 전부 정리
  const dropTables = [
    'vassal_contracts', 'territory_intrusions',
    'tower_strikes', 'fixed_guardian_storage', 'slot_grants',
    'fixed_guardians', 'territory_losses', 'territories',
    'battles', 'alliances', 'alliance_requests',
    'parts', 'guardians',
    'world_bosses', 'boss_damage', 'daily_missions',
    'activity_events', 'guild_messages', 'guilds',
    'seasons', 'users'
  ]
  for (const t of dropTables) {
    try {
      await db.query(`DROP TABLE IF EXISTS ${t} CASCADE`)
    } catch (e) {
      console.warn(`[migrate] DROP ${t} warning:`, e.message)
    }
  }
  await ensureSchema()

  // 시즌 1 시드
  await db.query(`INSERT INTO seasons (name, is_active) VALUES ('Season 1', true)
                  ON CONFLICT DO NOTHING`).catch(() => {})
}

// 모든 테이블/컬럼/인덱스 IF NOT EXISTS — 멱등.
async function ensureSchema() {
  // ─── users ────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(100) UNIQUE NOT NULL,
      energy_currency INT DEFAULT 100,
      level INT DEFAULT 1,
      xp INT DEFAULT 0,
      last_xp_event_at TIMESTAMP,
      last_location_lat FLOAT,
      last_location_lng FLOAT,
      shield_until TIMESTAMP,
      is_online BOOLEAN DEFAULT FALSE,
      fcm_token TEXT,
      last_battle_at TIMESTAMP,
      betrayal_blocked_until TIMESTAMP,
      user_layer VARCHAR DEFAULT 'beginner',
      graduated_at TIMESTAMP,
      battle_wins INT DEFAULT 0,
      battle_wins_season INT DEFAULT 0,
      last_seen_at TIMESTAMP DEFAULT NOW(),
      tutorial_step INT DEFAULT 0,
      guild_id UUID,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_users_location ON users(last_location_lat, last_location_lng)`)

  // ─── seasons ──────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS seasons (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMP DEFAULT NOW(),
      ended_at TIMESTAMP,
      is_active BOOLEAN DEFAULT true,
      name VARCHAR(50)
    )
  `)

  // ─── guardians (본체 수호신) ───────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS guardians (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50),
      parts JSONB,
      atk INT DEFAULT 10, def INT DEFAULT 10, hp INT DEFAULT 100,
      abs INT DEFAULT 10, prd INT DEFAULT 10, spd INT DEFAULT 10,
      rng INT DEFAULT 10, ter INT DEFAULT 10,
      ult_charge INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  // ─── territories (β: 1 tower = 1 territory) ───────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS territories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      center_lat FLOAT NOT NULL,
      center_lng FLOAT NOT NULL,
      radius INT NOT NULL,
      parent_territory_id UUID REFERENCES territories(id) ON DELETE SET NULL,
      tower_type VARCHAR DEFAULT 'normal',
      vulnerable_until TIMESTAMP,
      warning_at TIMESTAMP,
      weakened_at TIMESTAMP,
      atari_started_at TIMESTAMP,
      atari_damage INT DEFAULT 0,
      atari_attacker_ids JSONB DEFAULT '[]',
      in_eye_zone BOOLEAN DEFAULT false,
      siege_breached_at TIMESTAMP,
      siege_last_attacker UUID,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_territories_location ON territories(center_lat, center_lng)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_territories_user ON territories(user_id)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_territories_parent ON territories(parent_territory_id)`)

  // ─── fixed_guardians (=타워, territory와 1:1) ─────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS fixed_guardians (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      territory_id UUID UNIQUE REFERENCES territories(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      position_lat FLOAT NOT NULL,
      position_lng FLOAT NOT NULL,
      tower_class VARCHAR(20) DEFAULT 'generic',
      tier INT DEFAULT 1,
      tower_range INT DEFAULT 80,
      fire_rate_ms INT DEFAULT 3000,
      atk INT DEFAULT 5, def INT DEFAULT 5,
      hp INT DEFAULT 50, max_hp INT DEFAULT 50,
      guardian_type VARCHAR(50) DEFAULT 'defense',
      storage_capacity INT DEFAULT 5,
      last_fired_at TIMESTAMP,
      last_produced_at TIMESTAMP DEFAULT NOW(),
      destroyed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_fixed_guardians_location ON fixed_guardians(position_lat, position_lng)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_fixed_guardians_user ON fixed_guardians(user_id)`)

  // ─── 속국 계약 (vassal/lord 계약, 제안자=vassal이 분배율 제안) ──
  await db.query(`
    CREATE TABLE IF NOT EXISTS vassal_contracts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vassal_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      lord_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      lord_territory_id UUID REFERENCES territories(id) ON DELETE CASCADE,
      vassal_territory_id UUID UNIQUE REFERENCES territories(id) ON DELETE CASCADE,
      proposed_position_lat FLOAT NOT NULL,
      proposed_position_lng FLOAT NOT NULL,
      proposed_radius_m INT NOT NULL,
      proposed_tower_class VARCHAR(20) DEFAULT 'generic',
      tribute_to_lord_pct REAL NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      proposed_at TIMESTAMP DEFAULT NOW(),
      responded_at TIMESTAMP,
      expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours'),
      dissolved_at TIMESTAMP,
      tribute_total INT DEFAULT 0   -- 누적 조공량 (P2-8)
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_vassal_lord ON vassal_contracts(lord_user_id, status)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_vassal_vassal ON vassal_contracts(vassal_user_id, status)`)

  // ─── 침입 throttle (큰 영역 알림 폭주 방지) ───────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS territory_intrusions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      territory_id UUID REFERENCES territories(id) ON DELETE CASCADE,
      intruder_id UUID REFERENCES users(id) ON DELETE CASCADE,
      first_entered_at TIMESTAMP DEFAULT NOW(),
      last_entered_at TIMESTAMP DEFAULT NOW(),
      notification_sent_at TIMESTAMP,
      UNIQUE(territory_id, intruder_id)
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_intrusions_terr ON territory_intrusions(territory_id)`)

  // ─── 전투/동맹 ─────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS battles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      attacker_id UUID REFERENCES users(id) ON DELETE CASCADE,
      defender_id UUID REFERENCES users(id) ON DELETE CASCADE,
      territory_id UUID,
      status VARCHAR(50) DEFAULT 'pending',
      attacker_choice VARCHAR(50),
      defender_choice VARCHAR(50),
      winner_id UUID,
      attacker_power INT,
      defender_power INT,
      absorbed_stats JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP,
      expires_at TIMESTAMP
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS alliances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id_1 UUID REFERENCES users(id) ON DELETE CASCADE,
      user_id_2 UUID REFERENCES users(id) ON DELETE CASCADE,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      dissolved_at TIMESTAMP
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS alliance_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
      target_id UUID REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    )
  `)

  // ─── 부속 테이블 (파츠/공성/저장소/grant/이벤트/길드/보스/미션/손실) ─
  await db.query(`
    CREATE TABLE IF NOT EXISTS parts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      slot VARCHAR(20) NOT NULL,
      tier INTEGER NOT NULL DEFAULT 1,
      guardian_type VARCHAR(50),
      stat_bonuses JSONB NOT NULL DEFAULT '{}',
      passives JSONB NOT NULL DEFAULT '[]',
      equipped BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_parts_user ON parts(user_id)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_parts_equipped ON parts(user_id, equipped) WHERE equipped = true`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS tower_strikes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tower_id UUID REFERENCES fixed_guardians(id) ON DELETE CASCADE,
      target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      damage INT NOT NULL,
      fired_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_strikes_target ON tower_strikes(target_user_id, fired_at DESC)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS fixed_guardian_storage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fixed_guardian_id UUID REFERENCES fixed_guardians(id) ON DELETE CASCADE,
      item_type VARCHAR(20) NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_fg_storage ON fixed_guardian_storage(fixed_guardian_id)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS slot_grants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      territory_id UUID REFERENCES territories(id) ON DELETE CASCADE,
      position_lat FLOAT NOT NULL,
      position_lng FLOAT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_slot_grants_user ON slot_grants(user_id, expires_at) WHERE used_at IS NULL`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS activity_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      event_type VARCHAR(50) NOT NULL,
      data JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_events_user_time ON activity_events(user_id, created_at DESC)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(40) NOT NULL UNIQUE,
      leader_id UUID REFERENCES users(id) ON DELETE SET NULL,
      member_count INT DEFAULT 1,
      max_members INT DEFAULT 10,
      shared_energy INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS guild_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      guild_id UUID REFERENCES guilds(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_guild_msg ON guild_messages(guild_id, created_at DESC)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS territory_losses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      former_owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      new_owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      center_lat FLOAT NOT NULL,
      center_lng FLOAT NOT NULL,
      radius FLOAT,
      loss_type VARCHAR(20),
      viewed BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_terr_loss ON territory_losses(former_owner_id, viewed, created_at DESC)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_missions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      mission_key VARCHAR(40) NOT NULL,
      progress INT NOT NULL DEFAULT 0,
      target INT NOT NULL,
      reward_xp INT NOT NULL DEFAULT 0,
      reward_energy INT NOT NULL DEFAULT 0,
      completed BOOLEAN DEFAULT false,
      claimed BOOLEAN DEFAULT false,
      date_key VARCHAR(10) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_daily_missions_user_date ON daily_missions(user_id, date_key)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS world_bosses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      boss_type VARCHAR(40) NOT NULL,
      center_lat FLOAT NOT NULL,
      center_lng FLOAT NOT NULL,
      max_hp INT NOT NULL,
      hp INT NOT NULL,
      atk INT NOT NULL DEFAULT 50,
      def INT NOT NULL DEFAULT 30,
      spawned_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      dead_at TIMESTAMP,
      rewards_distributed BOOLEAN DEFAULT false
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_world_bosses_active ON world_bosses(dead_at, expires_at)`)
  await db.query(`
    CREATE TABLE IF NOT EXISTS boss_damage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      boss_id UUID REFERENCES world_bosses(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      total_damage INT NOT NULL DEFAULT 0,
      last_hit_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(boss_id, user_id)
    )
  `)
}

module.exports = migrate
