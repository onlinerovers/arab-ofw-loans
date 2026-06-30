const express = require('express');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { one, all, run } = require('../db');
const { generateReferenceNumber } = require('../utils/reference');
const { sendApplicationConfirmation, sendAdminNewApplication, sendAdminNewVisit } = require('../services/email');
const { verifyCsrfToken } = require('../middleware/csrf');
const settings = require('../services/settings');
const { seedWaitlistToTarget } = require('../scripts/seed-waitlist');

const router = express.Router();

// ── File upload config ──────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|pdf|heic/i.test(path.extname(file.originalname)) || /jpeg|jpg|png|pdf|heic/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, PDF, and HEIC files are allowed.'));
    }
  },
});

const DOC_FIELDS = [
  { name: 'file_passport',            maxCount: 1 },
  { name: 'file_residence_permit',    maxCount: 1 },
  { name: 'file_salary_cert',         maxCount: 1 },
  { name: 'file_employment_contract', maxCount: 1 },
  { name: 'file_bank_statements',     maxCount: 3 },
  { name: 'file_salary_transfer',     maxCount: 1 },
  { name: 'file_payslips',            maxCount: 3 },
];

const WAITLIST_PAGE_SIZE = 10;

const CURRENCY_MAP = {
  'Kuwait':       'KWD',
  'Oman':         'OMR',
  'Bahrain':      'BHD',
  'Saudi Arabia': 'SAR',
  'UAE':          'AED',
  'Qatar':        'QAR',
};

async function getWaitlistStats() {
  return one(`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)::int AS pending,
      SUM(CASE WHEN status='collected' THEN 1 ELSE 0 END)::int AS collected
    FROM loans
  `);
}

async function generateUniqueReference() {
  for (let i = 0; i < 10; i++) {
    const ref = generateReferenceNumber();
    const existing = await one('SELECT id FROM loans WHERE reference_number = $1', [ref]);
    if (!existing) return ref;
  }
  throw new Error('Unable to generate unique reference number');
}

router.get('/', async (req, res) => {
  if (!req.session.__notifiedVisit) {
    req.session.__notifiedVisit = true;
    sendAdminNewVisit({
      path: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      referer: req.get('referer'),
    }).catch(() => {});
  }

  const stats = await getWaitlistStats();
  const csrfToken = req.csrfToken();
  const interestRate = parseFloat(settings.get('interest_rate', '0')) || 0;

  // Pre-fill form with logged-in user's details
  let formData = {};
  if (req.session.userId) {
    const user = await one('SELECT full_name, email FROM users WHERE id = $1', [req.session.userId]);
    if (user) formData = { full_name: user.full_name, email: user.email };
  }

  res.render('index', {
    title: 'Apply for a Loan',
    stats, csrfToken, interestRate, formData,
    success: req.flash('success'),
    error: req.flash('error'),
  });
});

router.get('/waitlist', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * WAITLIST_PAGE_SIZE;
  const totalRow = await one('SELECT COUNT(*)::int AS cnt FROM loans');
  const total = totalRow.cnt;
  const rows = await all(
    'SELECT full_name, status, applied_at FROM loans ORDER BY applied_at DESC LIMIT $1 OFFSET $2',
    [WAITLIST_PAGE_SIZE, offset]
  );
  res.json({ rows, page, totalPages: Math.ceil(total / WAITLIST_PAGE_SIZE), total });
});

router.get('/terms', (req, res) => res.render('terms', { title: 'Privacy Policy' }));
router.get('/legal', (req, res) => res.render('legal', { title: 'Legal Package' }));

// Read-only diagnostic. Reports DB connectivity and which env vars are PRESENT
// (booleans only — never their values). Safe to expose; remove once debugged.
router.get('/healthz', async (req, res) => {
  const health = {
    ok: true,
    node_env: process.env.NODE_ENV || '(unset)',
    db: { connected: false },
    env_present: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      SESSION_SECRET: !!process.env.SESSION_SECRET,
      SMTP_HOST: !!process.env.SMTP_HOST,
      SMTP_USER: !!process.env.SMTP_USER,
      SMTP_PASS: !!process.env.SMTP_PASS,
      ADMIN_EMAIL: !!process.env.ADMIN_EMAIL,
      SEED_HTTP_TOKEN: !!process.env.SEED_HTTP_TOKEN,
    },
  };

  try {
    const row = await one('SELECT COUNT(*)::int AS cnt FROM loans');
    health.db.connected = true;
    health.db.loan_count = row ? row.cnt : null;
  } catch (err) {
    health.ok = false;
    health.db.connected = false;
    health.db.error = err.message;
  }

  res.status(health.ok ? 200 : 500).json(health);
});

router.post('/_internal/seed-waitlist', async (req, res) => {
  const configuredToken = process.env.SEED_HTTP_TOKEN;
  const token = (req.query && req.query.token) || (req.body && req.body.token) || req.get('x-seed-token');
  if (!configuredToken || token !== configuredToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const target = req.body && req.body.targetTotal !== undefined ? req.body.targetTotal : req.query.targetTotal;
  const maxDays = req.body && req.body.maxDays !== undefined ? req.body.maxDays : req.query.maxDays;

  const safeTarget = Math.max(0, parseInt(String(target || 1000), 10) || 0);
  const safeMaxDays = Math.max(1, parseInt(String(maxDays || 30), 10) || 30);

  try {
    const result = await seedWaitlistToTarget({ targetTotal: safeTarget, maxDays: safeMaxDays });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[seed] Error:', err);
    res.status(500).json({ success: false, error: 'Seed failed' });
  }
});

const applyValidation = [
  body('full_name').trim().notEmpty().withMessage('Full name is required.').escape(),
  body('date_of_birth').notEmpty().withMessage('Date of birth is required.').isDate().withMessage('Invalid date of birth.'),
  body('nationality').trim().notEmpty().withMessage('Nationality is required.').escape(),
  body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('phone').trim().notEmpty().withMessage('Phone number is required.').escape(),
  body('address').optional({ checkFalsy: true }).trim().escape(),
  body('country').trim().notEmpty().withMessage('Country of residence is required.').escape(),
  body('employment_status').notEmpty().withMessage('Employment status is required.')
    .isIn(['employed','self-employed','unemployed','student','retired']).withMessage('Invalid employment status.').escape(),
  body('monthly_income').notEmpty().withMessage('Monthly income is required.').isFloat({ min: 0 }).withMessage('Monthly income must be 0 or more.').toFloat(),
  body('id_number').trim().notEmpty().withMessage('ID number is required.').escape(),
  body('amount').isFloat({ min: 1 }).withMessage('Loan amount must be at least 1.').toFloat(),
  body('loan_term_months').optional({ checkFalsy: true }).isInt({ min: 1 }).toInt(),
  body('purpose').notEmpty().withMessage('Please select a loan purpose.').escape(),
  body('terms').equals('on').withMessage('You must accept the terms and conditions.'),
];

function handleUpload(req, res, next) {
  upload.fields(DOC_FIELDS)(req, res, (err) => {
    if (err) {
      req.flash('error', 'File upload error: ' + err.message);
      return res.redirect('/');
    }
    next();
  });
}

router.post('/apply', handleUpload, verifyCsrfToken, applyValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const stats = await getWaitlistStats();
    const csrfToken = req.csrfToken();
    const interestRate = parseFloat(settings.get('interest_rate', '0')) || 0;
    return res.status(400).render('index', {
      title: 'Apply for a Loan',
      stats, csrfToken, interestRate,
      error: errors.array().map((e) => e.msg).join(' '),
      success: null,
      formData: req.body,
    });
  }

  const {
    full_name, date_of_birth, nationality, email, phone, address,
    country, employment_status, monthly_income, id_number,
    amount, loan_term_months, purpose, signature_data,
  } = req.body;

  const currency = CURRENCY_MAP[country] || null;
  const userId = req.session?.userId || null;
  const s = (v) => (v === undefined || v === null || v === '') ? null : String(v);
  const num = (v) => { const x = Number(v); return (v === undefined || v === null || v === '' || isNaN(x)) ? null : x; };

  try {
    const referenceNumber = await generateUniqueReference();

    const loanResult = await run(`
      INSERT INTO loans (
        reference_number, full_name, date_of_birth, nationality, email, phone, address,
        country, currency, employment_status, monthly_income, id_number,
        amount, loan_term_months, purpose, signature_data, user_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id
    `, [
      s(referenceNumber), s(full_name), s(date_of_birth), s(nationality),
      s(email), s(phone), s(address), s(country), s(currency),
      s(employment_status), num(monthly_income), s(id_number),
      num(amount), num(loan_term_months), s(purpose), s(signature_data), userId,
    ]);

    const loanId = loanResult.rows[0].id;

    for (const field of DOC_FIELDS) {
      const files = req.files && req.files[field.name];
      if (files && files.length > 0) {
        for (const f of files) {
          await run(
            'INSERT INTO loan_documents (loan_id, doc_type, original_name, stored_name) VALUES ($1,$2,$3,$4)',
            [loanId, field.name.replace('file_', ''), f.originalname, f.filename]
          );
        }
      }
    }

    const loan = await one('SELECT * FROM loans WHERE id = $1', [loanId]);
    await sendApplicationConfirmation(loan);

    await run(
      `INSERT INTO notifications (type, title, body, link) VALUES ($1,$2,$3,$4)`,
      [
        'new_application',
        `New application from ${full_name}`,
        `${full_name} applied for ${Number(amount).toLocaleString()} ${currency || ''} — Ref: ${referenceNumber}`,
        `/admin/loans/${loanId}`,
      ]
    );
    sendAdminNewApplication(loan).catch(() => {});

    req.flash('success', `Application submitted! Your reference number is ${referenceNumber}.`);
    res.redirect('/');
  } catch (err) {
    console.error('[apply] Error:', err.message, err.stack);
    req.flash('error', 'Error: ' + err.message);
    res.redirect('/');
  }
});

module.exports = router;
