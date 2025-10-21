// config/database.js
const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||              // private, in-project
  process.env.DATABASE_PUBLIC_URL;         // public fallback (avoid if possible)

const usingPublic = !!process.env.DATABASE_PUBLIC_URL && !process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: usingPublic ? { rejectUnauthorized: false } : false,
});

// TEMP: log host once so you can verify in logs
try {
  const host = new URL(connectionString).hostname;
  console.log('🔌 DB host:', host);
} catch {}

module.exports = pool;
