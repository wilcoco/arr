-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- 사용자 테이블
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_location GEOGRAPHY(POINT, 4326),
  is_online BOOLEAN DEFAULT FALSE,
  shield_until TIMESTAMP, -- 방어막 종료 시간
  energy_currency INT DEFAULT 1500  -- Lv1 generic 50m 타워(242E) 1~2개 가능
);

-- 수호신 테이블 (본체)
CREATE TABLE guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL, -- animal, robot, aircraft
  parts JSONB, -- 파츠 조합 정보

  -- 기본 능력치
  atk INT DEFAULT 10,
  def INT DEFAULT 10,
  hp INT DEFAULT 100,
  abs INT DEFAULT 10, -- 흡수력
  prd INT DEFAULT 10, -- 생산력
  spd INT DEFAULT 10, -- 속도
  rng INT DEFAULT 10, -- 사거리
  ter INT DEFAULT 10, -- 영역력
  ult_charge INT DEFAULT 0, -- 궁극기 충전

  created_at TIMESTAMP DEFAULT NOW()
);

-- 영역 테이블
CREATE TABLE territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  center GEOGRAPHY(POINT, 4326) NOT NULL,
  radius FLOAT NOT NULL, -- 미터 단위
  geom GEOGRAPHY(POLYGON, 4326), -- 실제 영역 폴리곤
  created_at TIMESTAMP DEFAULT NOW()
);

-- 고정 수호신 테이블
CREATE TABLE fixed_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id UUID REFERENCES territories(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  position GEOGRAPHY(POINT, 4326) NOT NULL,

  -- 분배받은 능력치
  atk INT DEFAULT 0,
  def INT DEFAULT 0,
  hp INT DEFAULT 0,

  guardian_type VARCHAR(20) DEFAULT 'defense', -- defense, production
  created_at TIMESTAMP DEFAULT NOW()
);

-- 동맹 테이블
CREATE TABLE alliances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_1 UUID REFERENCES users(id) ON DELETE CASCADE,
  user_id_2 UUID REFERENCES users(id) ON DELETE CASCADE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  dissolved_at TIMESTAMP
);

-- 전투 기록 테이블
CREATE TABLE battles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id UUID REFERENCES users(id),
  defender_id UUID REFERENCES users(id),
  territory_id UUID REFERENCES territories(id),

  attacker_choice VARCHAR(20), -- battle, alliance
  defender_choice VARCHAR(20),

  status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed
  winner_id UUID REFERENCES users(id),

  attacker_power INT,
  defender_power INT,
  absorbed_stats JSONB, -- 흡수된 능력치

  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_territories_geom ON territories USING GIST (geom);
CREATE INDEX idx_territories_center ON territories USING GIST (center);
CREATE INDEX idx_users_location ON users USING GIST (last_location);
CREATE INDEX idx_fixed_guardians_position ON fixed_guardians USING GIST (position);
CREATE INDEX idx_battles_status ON battles(status);
CREATE INDEX idx_alliances_active ON alliances(active);

-- 주변 영역 조회 함수
CREATE OR REPLACE FUNCTION find_nearby_territories(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius DOUBLE PRECISION
)
RETURNS TABLE (
  territory_id UUID,
  user_id UUID,
  distance DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.user_id,
    ST_Distance(t.center, ST_MakePoint(p_lng, p_lat)::geography) as distance
  FROM territories t
  WHERE ST_DWithin(
    t.geom,
    ST_MakePoint(p_lng, p_lat)::geography,
    p_radius
  )
  ORDER BY distance;
END;
$$ LANGUAGE plpgsql;
