const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Bharadwaj@1940',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_DATABASE || 'voltpath_db',
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected!');
    
    // Test table creation
    await client.query(`
      CREATE TABLE IF NOT EXISTS stationsmaster_test (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100)
      )
    `);
    
    await client.query("INSERT INTO stationsmaster_test (name) VALUES ('test')");
    const result = await client.query('SELECT * FROM stationsmaster_test');
    console.log('✅ Table operations OK:', result.rows);
    
    await client.query('DROP TABLE stationsmaster_test');
    client.release();
    console.log('🚀 Database ready for VoltPath!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database error:', err.message);
    process.exit(1);
  }
}

testConnection();
