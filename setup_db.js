const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function setup() {
  try {
    console.log('🐘 Connecting to database...');
    
    // 1. Create dashboard_settings table
    console.log('🛠 Creating dashboard_settings table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 2. Create indices
    console.log('🚀 Creating indices on utm_sales...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_utm_sales_created ON utm_sales(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_utm_sales_campaign ON utm_sales(utm_campaign);
    `);

    console.log('✅ Database setup completed successfully.');
  } catch (err) {
    console.error('❌ Database setup failed:', err.message);
  } finally {
    await pool.end();
  }
}

setup();
