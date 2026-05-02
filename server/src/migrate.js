const db = require('./db')

async function migrate() {
  console.log('Running migrations...')

  try {
    // 기본 테이블 생성 (없으면)
    await safeQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(100) UNIQUE NOT NULL,
        energy_currency INT DEFAULT 100,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)

    await safeQuery(`
      CREATE TABLE IF NOT EXISTS guardians (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        type VARCHAR(50),
        parts JSONB,
        atk INT DEFAULT 10,
        def INT DEFAULT 10,
        hp INT DEFAULT 100,
        abs INT DEFAULT 10,
        prd INT DEFAULT 10,
        spd INT DEFAULT 10,
        rng INT DEFAULT 10,
        ter INT DEFAULT 10,
        ult_charge INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)

    await safeQuery(`
      CREATE TABLE IF NOT EXISTS territories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        center_lat FLOAT,
        center_lng FLOAT,
        radius INT DEFAULT 100,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)

    await safeQuery(`
      CREATE TABLE IF NOT EXISTS fixed_guardians (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        territory_id UUID REFERENCES territories(id),
        user_id UUID REFERENCES users(id),
        position_lat FLOAT,
        position_lng FLOAT,
        atk INT DEFAULT 5,
        def INT DEFAULT 5,
        hp INT DEFAULT 20,
        guardian_type VARCHAR(50) DEFAULT 'defense',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)

    await safeQuery(`
      CREATE TABLE IF NOT EXISTS battles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        attacker_id UUID REFERENCES users(id),
        defender_id UUID REFERENCES users(id),
        territory_id UUID,
        status VARCHAR(50) DEFAULT 'pending',
        attacker_choice VARCHAR(50),
        defender_choice VARCHAR(50),
        winner_id UUID,
        attacker_power INT,
        defender_power INT,
        absorbed_stats JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `)

    await safeQuery(`
      CREATE TABLE IF NOT EXISTS alliances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id_1 UUID REFERENCES users(id),
        user_id_2 UUID REFERENCES users(id),
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        dissolved_at TIMESTAMP
      )
    `)

    // users 테이블 컬럼 추가 (존재 여부 확인 후)
    await safeAddColumn('users', 'last_location_lat', 'FLOAT')
    await safeAddColumn('users', 'last_location_lng', 'FLOAT')
    await safeAddColumn('users', 'shield_until', 'TIMESTAMP')
    await safeAddColumn('users', 'is_online', 'BOOLEAN DEFAULT FALSE')
    await safeAddColumn('users', 'fcm_token', 'TEXT')

    // 동맹 요청 테이블
    await safeQuery(`
      CREATE TABLE IF NOT EXISTS alliance_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id UUID REFERENCES users(id),
        target_id UUID REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)

    // 전투 쿨다운 / 배신 패널티
    await safeAddColumn('users', 'last_battle_at', 'TIMESTAMP')
    await safeAddColumn('users', 'betrayal_blocked_until', 'TIMESTAMP')

    // 영역 유지비 경고/약화 시작 시각
    await safeAddColumn('territories', 'warning_at', 'TIMESTAMP')
    await safeAddColumn('territories', 'weakened_at', 'TIMESTAMP')

    // 레이어 시스템 (초심자 보호)
    await safeAddColumn('users', 'user_layer', "VARCHAR DEFAULT 'beginner'")
    await safeAddColumn('users', 'graduated_at', 'TIMESTAMP')
    await safeAddColumn('users', 'battle_wins', 'INT DEFAULT 0')

    // 영역 타입 (수익탑 등)
    await safeAddColumn('territories', 'tower_type', "VARCHAR DEFAULT 'normal'")

    // 파츠 테이블
    await safeQuery(`
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
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_parts_user ON parts(user_id)`)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_parts_equipped ON parts(user_id, equipped) WHERE equipped = true`)

    // ─── v2 개선: 사망 완화 / 오프라인 요약 / 시즌제 ─────────────────
    // 영역 취약 상태 (사망 시 삭제 대신 24시간 vulnerable)
    await safeAddColumn('territories', 'vulnerable_until', 'TIMESTAMP')

    // 오프라인 요약용 last_seen_at
    await safeAddColumn('users', 'last_seen_at', 'TIMESTAMP DEFAULT NOW()')

    // 시즌제 리더보드
    await safeAddColumn('users', 'battle_wins_season', 'INT DEFAULT 0')
    await safeQuery(`
      CREATE TABLE IF NOT EXISTS seasons (
        id SERIAL PRIMARY KEY,
        started_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        name VARCHAR(50)
      )
    `)
    // 최초 시즌 1개 보장
    await safeQuery(`
      INSERT INTO seasons (name, is_active)
      SELECT 'Season 1', true
      WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE is_active = true)
    `)

    // 응답 타임아웃 (전투 60초, 동맹 5분)
    await safeAddColumn('battles', 'expires_at', 'TIMESTAMP')
    await safeAddColumn('alliance_requests', 'expires_at', 'TIMESTAMP')

    // 길드 시스템
    await safeQuery(`
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
    await safeAddColumn('users', 'guild_id', 'UUID')
    await safeQuery(`
      CREATE TABLE IF NOT EXISTS guild_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guild_id UUID REFERENCES guilds(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_guild_msg ON guild_messages(guild_id, created_at DESC)`)

    // 영역 손실 기록 (영구 보존 — 활동 로그와 별도)
    await safeQuery(`
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
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_terr_loss ON territory_losses(former_owner_id, viewed, created_at DESC)`)

    // 튜토리얼 / 일일 미션 / PvE 보스
    await safeAddColumn('users', 'tutorial_step', 'INT DEFAULT 0')
    await safeQuery(`
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
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_daily_missions_user_date ON daily_missions(user_id, date_key)`)

    await safeQuery(`
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
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_world_bosses_active ON world_bosses(dead_at, expires_at)`)

    await safeQuery(`
      CREATE TABLE IF NOT EXISTS boss_damage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        boss_id UUID REFERENCES world_bosses(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        total_damage INT NOT NULL DEFAULT 0,
        last_hit_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(boss_id, user_id)
      )
    `)

    // 레벨/XP 시스템
    await safeAddColumn('users', 'level', 'INT DEFAULT 1')
    await safeAddColumn('users', 'xp',    'INT DEFAULT 0')
    await safeAddColumn('users', 'last_xp_event_at', 'TIMESTAMP')

    // 바둑 호구(atari) 시스템
    await safeAddColumn('territories', 'atari_started_at', 'TIMESTAMP')
    await safeAddColumn('territories', 'atari_damage',     'INT DEFAULT 0')
    await safeAddColumn('territories', 'atari_attacker_ids', 'JSONB DEFAULT \'[]\'')
    await safeAddColumn('territories', 'in_eye_zone',      'BOOLEAN DEFAULT false')

    // 타워 공성 시스템
    await safeAddColumn('territories', 'siege_breached_at',  'TIMESTAMP')   // 모든 타워 격파된 시점
    await safeAddColumn('territories', 'siege_last_attacker', 'UUID')       // 최후 일격 사용자
    await safeAddColumn('fixed_guardians', 'destroyed_at', 'TIMESTAMP')     // 격파 기록

    // 타워 디펜스 시스템 (고정 수호신 → 타워)
    await safeAddColumn('fixed_guardians', 'tower_class', "VARCHAR(20) DEFAULT 'arrow'")
    await safeAddColumn('fixed_guardians', 'tier',         'INT DEFAULT 1')
    await safeAddColumn('fixed_guardians', 'tower_range',  'INT DEFAULT 80')
    await safeAddColumn('fixed_guardians', 'fire_rate_ms', 'INT DEFAULT 3000')
    await safeAddColumn('fixed_guardians', 'last_fired_at','TIMESTAMP')
    await safeAddColumn('fixed_guardians', 'max_hp',       'INT DEFAULT 50')

    await safeQuery(`
      CREATE TABLE IF NOT EXISTS tower_strikes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tower_id UUID REFERENCES fixed_guardians(id) ON DELETE CASCADE,
        target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        damage INT NOT NULL,
        fired_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_strikes_target ON tower_strikes(target_user_id, fired_at DESC)`)

    // 고정 수호신 저장소 (생산 누적 → 현장 수령 모델)
    await safeAddColumn('fixed_guardians', 'storage_capacity', 'INT DEFAULT 5')
    await safeAddColumn('fixed_guardians', 'last_produced_at', 'TIMESTAMP DEFAULT NOW()')
    await safeQuery(`
      CREATE TABLE IF NOT EXISTS fixed_guardian_storage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixed_guardian_id UUID REFERENCES fixed_guardians(id) ON DELETE CASCADE,
        item_type VARCHAR(20) NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_fg_storage ON fixed_guardian_storage(fixed_guardian_id)`)

    // 활동 이벤트 (오프라인 요약, 로그)
    await safeQuery(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL,
        data JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_events_user_time ON activity_events(user_id, created_at DESC)`)

    // 인덱스 생성 (에러 무시)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_users_location ON users(last_location_lat, last_location_lng)`)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_territories_location ON territories(center_lat, center_lng)`)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_fixed_guardians_location ON fixed_guardians(position_lat, position_lng)`)

    console.log('Migrations complete!')
  } catch (err) {
    console.error('Migration failed:', err)
  }
}

async function safeAddColumn(table, column, type) {
  try {
    // 컬럼 존재 여부 확인
    const result = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2
    `, [table, column])

    if (result.rows.length === 0) {
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
      console.log(`✓ Added column ${table}.${column}`)
    } else {
      console.log(`- Column ${table}.${column} already exists`)
    }
  } catch (err) {
    console.error(`Error adding column ${table}.${column}:`, err.message)
  }
}

async function safeQuery(sql) {
  try {
    await db.query(sql)
    console.log('✓', sql.substring(0, 50) + '...')
  } catch (err) {
    // 이미 존재하는 경우 등 무시
    console.log('-', sql.substring(0, 50) + '... (skipped)')
  }
}

module.exports = migrate
