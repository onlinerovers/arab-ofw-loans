const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false'
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

// ─── helpers ───────────────────────────────────────────────────
async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function one(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows[0] || null;
}

async function all(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

async function run(sql, params = []) {
  return pool.query(sql, params);
}

// ─── schema ────────────────────────────────────────────────────
async function initSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS loans (
      id SERIAL PRIMARY KEY,
      reference_number TEXT UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT,
      date_of_birth TEXT,
      nationality TEXT,
      country TEXT,
      currency TEXT,
      employment_status TEXT,
      monthly_income REAL,
      id_number TEXT,
      amount REAL NOT NULL,
      loan_term_months INTEGER,
      purpose TEXT,
      signature_data TEXT,
      status TEXT DEFAULT 'pending',
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      approved_by INTEGER REFERENCES admins(id),
      collected_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,
      rejected_by INTEGER REFERENCES admins(id),
      user_id INTEGER REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS loan_notes (
      id SERIAL PRIMARY KEY,
      loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES admins(id),
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      paid_at TIMESTAMPTZ DEFAULT NOW(),
      recorded_by INTEGER REFERENCES admins(id),
      notes TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER REFERENCES admins(id),
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS loan_documents (
      id SERIAL PRIMARY KEY,
      loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS chat_sessions (
      id SERIAL PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      user_name TEXT,
      user_email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','bot')),
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      balance REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('credit','debit')),
      amount REAL NOT NULL,
      description TEXT,
      admin_id INTEGER REFERENCES admins(id),
      loan_id INTEGER REFERENCES loans(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // indexes
    `CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status)`,
    `CREATE INDEX IF NOT EXISTS idx_loans_applied_at ON loans(applied_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_sessions_sid ON chat_sessions(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_sid ON chat_messages(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_cat ON audit_logs(created_at DESC)`,
  ];

  for (const sql of stmts) {
    await pool.query(sql);
  }
  console.log('[db] Schema ready.');
}

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn('[db] ADMIN_USERNAME and ADMIN_PASSWORD must be set.');
    return;
  }
  const existing = await one('SELECT id FROM admins WHERE username = $1', [username]);
  if (existing) return;
  const hash = await bcrypt.hash(password, 12);
  await run('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [username, hash]);
  console.log(`[db] Seeded admin: ${username}`);
}

async function seedSettings() {
  const defaults = {
    app_name: process.env.APP_NAME || 'Arab OFW Loans & Partners',
    support_email: process.env.SUPPORT_EMAIL || '',
    company_address: process.env.COMPANY_ADDRESS || '',
    email_sender_name: process.env.EMAIL_SENDER_NAME || 'Arab OFW Loans',
    interest_rate: '0',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await run(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }
}

async function init() {
  await initSchema();
  await seedAdmin();
  await seedSettings();
}

module.exports = { pool, query, one, all, run, init };
