const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function setup() {
  try {
    console.log('🐘 Connecting to database...');
    
    // 1. Create Base Tables (UTMfy Core)
    console.log('📜 Initializing base UTMfy tables...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS utm_products (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id TEXT UNIQUE NOT NULL,
          platform_id TEXT NOT NULL,
          pixel_id TEXT NOT NULL,
          fb_token TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS utm_clicks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          visitor_id TEXT NOT NULL,
          product_id TEXT,
          utm_source TEXT,
          utm_medium TEXT,
          utm_campaign TEXT,
          utm_term TEXT,
          utm_content TEXT,
          utm_id TEXT,
          fbc TEXT,
          fbp TEXT,
          page_url TEXT,
          ip_address TEXT,
          user_agent TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS utm_sales (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id TEXT UNIQUE NOT NULL,
          email TEXT,
          email_hash TEXT,
          amount DECIMAL(10, 2),
          currency TEXT DEFAULT 'BRL',
          product_id TEXT,
          platform TEXT,
          status TEXT,
          visitor_id TEXT,
          fbc TEXT,
          fbp TEXT,
          utm_source TEXT,
          utm_medium TEXT,
          utm_campaign TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          metadata JSONB
      );
    `);

    // 2. Create dashboard_settings table
    console.log('🛠 Creating dashboard_settings table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 3. Create indices
    console.log('🚀 Creating indices on utm_sales...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_utm_sales_created ON utm_sales(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_utm_sales_campaign ON utm_sales(utm_campaign);
      CREATE INDEX IF NOT EXISTS idx_utm_clicks_visitor ON utm_clicks(visitor_id);
    `);

    console.log('✅ Database setup completed successfully.');
  } catch (err) {
    console.error('❌ Database setup failed:', err.message);
  } finally {
    await pool.end();
  }
}

setup();
