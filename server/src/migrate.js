const db = require('./db')

async function migrate() {
  console.log('Running migrations...')

  const migrations = [
    // users 테이블 위치 컬럼 추가
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_location_lat FLOAT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_location_lng FLOAT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS shield_until TIMESTAMP`,

    // 인덱스 추가
    `CREATE INDEX IF NOT EXISTS idx_users_location ON users(last_location_lat, last_location_lng)`,
    `CREATE INDEX IF NOT EXISTS idx_territories_location ON territories(center_lat, center_lng)`,
  ]

  for (const sql of migrations) {
    try {
      await db.query(sql)
      console.log('✓', sql.substring(0, 50) + '...')
    } catch (err) {
      // 이미 존재하는 경우 무시
      if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
        console.error('Migration error:', err.message)
      }
    }
  }

  console.log('Migrations complete!')
}

module.exports = migrate
