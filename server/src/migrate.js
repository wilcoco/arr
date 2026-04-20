const db = require('./db')

async function migrate() {
  console.log('Running migrations...')

  try {
    // users 테이블 컬럼 추가 (존재 여부 확인 후)
    await safeAddColumn('users', 'last_location_lat', 'FLOAT')
    await safeAddColumn('users', 'last_location_lng', 'FLOAT')
    await safeAddColumn('users', 'shield_until', 'TIMESTAMP')
    await safeAddColumn('users', 'is_online', 'BOOLEAN DEFAULT FALSE')

    // 인덱스 생성 (에러 무시)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_users_location ON users(last_location_lat, last_location_lng)`)
    await safeQuery(`CREATE INDEX IF NOT EXISTS idx_territories_location ON territories(center_lat, center_lng)`)

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
