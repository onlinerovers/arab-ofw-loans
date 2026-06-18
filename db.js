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
    interest_rate: process.env.INTEREST_RATE || '5',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await run(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }
}

async function seedWaitlist() {
  const row = await one('SELECT COUNT(*)::int AS cnt FROM loans');
  if (row.cnt >= 50) return; // already seeded

  const COUNTRIES = [
    { name: 'Kuwait',       currency: 'KWD', nationalities: ['Kuwaiti','Egyptian','Indian','Filipino'] },
    { name: 'UAE',          currency: 'AED', nationalities: ['Emirati','Pakistani','Indian','Filipino'] },
    { name: 'Saudi Arabia', currency: 'SAR', nationalities: ['Saudi','Yemeni','Egyptian','Filipino'] },
    { name: 'Qatar',        currency: 'QAR', nationalities: ['Qatari','Indian','Filipino','Nepali'] },
    { name: 'Bahrain',      currency: 'BHD', nationalities: ['Bahraini','Indian','Filipino','Pakistani'] },
    { name: 'Oman',         currency: 'OMR', nationalities: ['Omani','Indian','Filipino','Bangladeshi'] },
  ];
  const MALE   = ['Mohammed','Ahmed','Ali','Omar','Khalid','Abdullah','Hassan','Ibrahim','Yusuf','Tariq','Nasser','Faisal','Samir','Rami','Bilal','Kareem','Ziad','Adel','Walid','Maher','Sami','Jassim','Hamad','Sultan','Rashid','Majid','Salim','Nawaf','Bader','Fahad'];
  const FEMALE = ['Fatima','Aisha','Maryam','Sara','Noura','Hessa','Reem','Layla','Dana','Shaikha','Manal','Amira','Nadia','Hanan','Rana','Dina','Lina','Yasmine','Ghada','Abeer'];
  const LNAMES = ['Al-Rashidi','Al-Mutairi','Al-Otaibi','Al-Harbi','Al-Dosari','Al-Mansoori','Al-Suwaidi','Al-Mazrouei','Al-Shamsi','Al-Nuaimi','Al-Thani','Al-Kuwari','Al-Naimi','Al-Marri','Al-Emadi','Al-Balushi','Al-Habsi','Al-Rawahi','Al-Maktoumi','Al-Zaabi','Santos','Reyes','Cruz','Garcia','Mendoza','Khan','Ahmed','Hussain','Malik','Sheikh','Sharma','Patel','Singh','Nair','Kumar'];
  const PURPOSES   = ['personal','business','education','medical','home improvement','travel','debt consolidation'];
  const EMPLOYMENT = ['employed','self-employed'];
  const STATUSES   = ['pending','pending','pending','pending','approved','collected'];

  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const amountFor = (cur) => { const r={KWD:[500,5000],AED:[2000,20000],SAR:[2000,20000],QAR:[2000,20000],BHD:[500,5000],OMR:[500,5000]}; const [mn,mx]=r[cur]||[1000,10000]; return rand(mn/100,mx/100)*100; };

  const today = new Date(); today.setHours(0,0,0,0);
  let inserted = 0;

  for (let d = 0; d < 7; d++) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);

    for (let i = 0; i < 30; i++) {
      const country  = pick(COUNTRIES);
      const first    = Math.random() > 0.35 ? pick(MALE) : pick(FEMALE);
      const name     = `${first} ${pick(LNAMES)}`;
      const status   = pick(STATUSES);
      const email    = `${name.toLowerCase().replace(/[^a-z]/g,'.').replace(/\.+/g,'.')}${rand(1,999)}@${pick(['gmail.com','yahoo.com','hotmail.com'])}`;
      const phone    = `${pick(['+965','+971','+966','+974','+973','+968'])}${rand(50000000,99999999)}`;
      const appliedAt = new Date(day); appliedAt.setHours(rand(7,22),rand(0,59),rand(0,59));
      let approvedAt = null, collectedAt = null;
      if (status === 'approved' || status === 'collected') approvedAt = new Date(appliedAt.getTime() + rand(1,3)*86400000);
      if (status === 'collected') collectedAt = new Date(approvedAt.getTime() + rand(1,2)*86400000);
      const ref = 'LN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2,6).toUpperCase();

      await pool.query(`
        INSERT INTO loans (reference_number,full_name,email,phone,country,currency,nationality,employment_status,monthly_income,amount,loan_term_months,purpose,status,applied_at,approved_at,collected_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (reference_number) DO NOTHING
      `, [ref,name,email,phone,country.name,country.currency,pick(country.nationalities),pick(EMPLOYMENT),rand(800,6000),amountFor(country.currency),pick([6,12,18,24,36]),pick(PURPOSES),status,appliedAt.toISOString(),approvedAt?.toISOString()||null,collectedAt?.toISOString()||null]);
      inserted++;
    }
  }
  console.log(`[db] Seeded ${inserted} dummy waitlist applicants.`);
}

async function init() {
  await initSchema();
  await seedAdmin();
  await seedSettings();
  await seedWaitlist();
}

module.exports = { pool, query, one, all, run, init };
