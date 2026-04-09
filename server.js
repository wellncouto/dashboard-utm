const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';

// Database Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cache for FB Spend (5 mins)
const spendCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Auth Middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// --- Routes ---

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  
  try {
    const { rows } = await pool.query('SELECT value FROM dashboard_settings WHERE key = $1', ['password_hash']);
    if (rows.length === 0) {
      return res.status(500).json({ error: 'Dashboard password not set in database.' });
    }

    const isValid = await bcrypt.compare(password, rows[0].value);
    if (!isValid) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign({ authenticated: true }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/campaigns
app.get('/api/campaigns', authenticate, async (req, res) => {
  const period = req.query.p || '7d';
  
  // Map period to database and FB API logic
  let sqlFilter;
  let datePreset;

  if (period === 'today') {
    // Current day in Sao Paulo timezone
    sqlFilter = "timezone('America/Sao_Paulo', created_at)::date = timezone('America/Sao_Paulo', now())::date";
    datePreset = 'today';
  } else if (period === '30d') {
    sqlFilter = "created_at >= NOW() - INTERVAL '30 days'";
    datePreset = 'last_30d';
  } else {
    // Default 7d
    sqlFilter = "created_at >= NOW() - INTERVAL '7 days'";
    datePreset = 'last_7d';
  }

  try {
    // 1. Get Settings
    const settingsRes = await pool.query('SELECT key, value FROM dashboard_settings WHERE key IN ($1, $2, $3)', ['fb_marketing_token', 'fb_ad_account_id', 'password_hash']);
    const settings = Object.fromEntries(settingsRes.rows.map(r => [r.key, r.value.trim()]));
    
    const hasFbToken = !!settings.fb_marketing_token;
    const adAccountId = settings.fb_ad_account_id;

    if (hasFbToken) {
      console.log(`DEBUG Token Check: Length=${settings.fb_marketing_token.length}, EndsWith=...${settings.fb_marketing_token.slice(-4)}`);
    }

    // 2. Fetch Sales Data
    const salesQuery = `
      SELECT 
        utm_campaign, 
        utm_medium, 
        COALESCE(SUM(amount), 0) as revenue,
        COUNT(*) as sales_count
      FROM utm_sales
      WHERE ${sqlFilter}
        AND status IN ('approved', 'paid')
        AND utm_campaign IS NOT NULL
      GROUP BY utm_campaign, utm_medium
      ORDER BY revenue DESC;
    `;
    const salesRes = await pool.query(salesQuery);

    // 3. Process Campaigns and Fetch Facebook Spend
    const campaigns = [];
    const fbIds = new Set();

    salesRes.rows.forEach(row => {
      const adsetId = row.utm_campaign?.split('|').pop()?.trim();
      const campaignId = row.utm_medium?.split('|').pop()?.trim();
      const adsetName = row.utm_campaign?.split('|')[0]?.trim();
      const campaignName = row.utm_medium?.split('|')[0]?.trim();

      // Collect IDs for FB query (both could be useful)
      if (adsetId && /^\d+$/.test(adsetId)) fbIds.add(adsetId);
      if (campaignId && /^\d+$/.test(campaignId)) fbIds.add(campaignId);

      campaigns.push({
        campaign_name: campaignName,
        adset_name: adsetName,
        adset_id: adsetId,
        campaign_id: campaignId,
        revenue: parseFloat(row.revenue),
        sales: parseInt(row.sales_count),
        spend: 0,
        roas: 0
      });
    });

    // 4. Batch Fetch FB Spend
    const spendMap = new Map();
    const fbToken = settings.fb_marketing_token;

    if (hasFbToken && fbIds.size > 0 && adAccountId) {
      const idsArray = Array.from(fbIds);

      // Filter out cached IDs
      const idsToFetch = idsArray.filter(id => {
        const cacheKey = `${id}_${period}`;
        const cached = spendCache.get(cacheKey);
        if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
          spendMap.set(id, cached.spend);
          return false;
        }
        return true;
      });

      if (idsToFetch.length > 0) {
        // Fetch via Ad Account Insights (More reliable)
        const chunks = chunkArray(idsToFetch, 50);
        for (const chunk of chunks) {
          try {
            console.log(`DEBUG: Fetching ${datePreset} insights via ${adAccountId}`);
            
            const fbRes = await axios.get(`https://graph.facebook.com/v19.0/${adAccountId}/insights`, {
              params: {
                level: 'adset', // We fetch at adset level which usually maps to our UTM IDs
                filtering: JSON.stringify([{
                  field: 'adset.id',
                  operator: 'IN',
                  value: chunk
                }]),
                fields: 'spend,adset_id',
                date_preset: datePreset,
                access_token: fbToken
              }
            });

            if (fbRes.data.data) {
              fbRes.data.data.forEach(item => {
                const id = item.adset_id;
                const spend = parseFloat(item.spend || 0);
                spendMap.set(id, spend);
                spendCache.set(`${id}_${period}`, { spend, ts: Date.now() });
              });
            }
          } catch (err) {
            console.error(`Error fetching FB spend:`, err.response?.data || err.message);
          }
        }
      }
    }

    // 5. Calculate Final Metrics
    let totalRevenue = 0;
    let totalSpend = 0;
    let totalSales = 0;

    campaigns.forEach(c => {
      // Prioritize Adset spend for specific rows, fallback to Campaign spend
      c.spend = spendMap.get(c.adset_id) || spendMap.get(c.campaign_id) || 0;
      c.roas = c.spend > 0 ? (c.revenue / c.spend) : 0;
      
      totalRevenue += c.revenue;
      totalSpend += c.spend;
      totalSales += c.sales;
    });

    res.json({
      totals: {
        revenue: totalRevenue,
        spend: totalSpend,
        roas: totalSpend > 0 ? (totalRevenue / totalSpend) : 0,
        sales: totalSales
      },
      campaigns
    });

  } catch (err) {
    console.error('❌ Error in /api/campaigns:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/sales
app.get('/api/sales', authenticate, async (req, res) => {
  const period = req.query.p || '7d';
  let sqlFilter;

  if (period === 'today') {
    sqlFilter = "timezone('America/Sao_Paulo', created_at)::date = timezone('America/Sao_Paulo', now())::date";
  } else if (period === '30d') {
    sqlFilter = "created_at >= NOW() - INTERVAL '30 days'";
  } else {
    sqlFilter = "created_at >= NOW() - INTERVAL '7 days'";
  }

  try {
    const query = `
      SELECT order_id, email, amount, currency, utm_campaign, created_at
      FROM utm_sales
      WHERE ${sqlFilter}
      ORDER BY created_at DESC
      LIMIT 20;
    `;
    const { rows } = await pool.query(query);

    const maskedSales = rows.map(s => ({
      ...s,
      email: maskEmail(s.email),
      campaign: s.utm_campaign?.split('|')[0]?.trim() || 'Direct'
    }));

    res.json(maskedSales);
  } catch (err) {
    console.error('Error in /api/sales:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Helpers ---

function maskEmail(email) {
  if (!email) return '***';
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  return `${user.substring(0, 3)}***@${domain}`;
}

function chunkArray(arr, size) {
  return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );
}

function getSinceDate(period) {
  const date = new Date();
  if (period === '7d') date.setDate(date.getDate() - 7);
  else if (period === '30d') date.setDate(date.getDate() - 30);
  return date.toISOString().split('T')[0];
}

app.listen(PORT, () => console.log(`🚀 Dashboard API running on port ${PORT}`));
