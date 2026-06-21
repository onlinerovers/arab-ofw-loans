const express = require('express');
const bcrypt = require('bcrypt');
const { Parser } = require('json2csv');
const { body, validationResult, param } = require('express-validator');
const { one, all, run } = require('../db');
const { requireAdmin, redirectIfAuthenticated } = require('../middleware/auth');
const { sendStatusUpdate } = require('../services/email');
const audit = require('../services/audit');
const settings = require('../services/settings');
const chatbot = require('../services/chatbot');

const router = express.Router();
const ITEMS_PER_PAGE = 20;

// ── Helpers ───────────────────────────────────────────────────
async function getDashboardData({ statusFilter = 'all', search = '', page = 1 }) {
  const statsRow = await one(`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)::int AS pending,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END)::int AS approved,
      SUM(CASE WHEN status='collected' THEN 1 ELSE 0 END)::int AS collected,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END)::int AS rejected
    FROM loans
  `);

  const whereClauses = [];
  const params = [];
  let idx = 1;

  if (statusFilter && statusFilter !== 'all') {
    whereClauses.push(`l.status = $${idx++}`);
    params.push(statusFilter);
  }

  if (search.trim()) {
    const pattern = `%${search.trim()}%`;
    whereClauses.push(`(l.full_name ILIKE $${idx} OR l.email ILIKE $${idx+1} OR l.phone ILIKE $${idx+2} OR l.reference_number ILIKE $${idx+3} OR l.id_number ILIKE $${idx+4})`);
    params.push(pattern, pattern, pattern, pattern, pattern);
    idx += 5;
  }

  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const countRow = await one(`SELECT COUNT(*)::int AS count FROM loans l ${where}`, params);
  const totalItems = countRow.count;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  const loans = await all(`
    SELECT l.*, a.username AS approved_by_name, r.username AS rejected_by_name
    FROM loans l
    LEFT JOIN admins a ON l.approved_by = a.id
    LEFT JOIN admins r ON l.rejected_by = r.id
    ${where}
    ORDER BY l.applied_at DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `, [...params, ITEMS_PER_PAGE, offset]);

  return { stats: statsRow, loans, totalItems, totalPages, currentPage, search, statusFilter };
}

async function getLoanWithNotes(loanId) {
  const loan = await one(`
    SELECT l.*, a.username AS approved_by_name, r.username AS rejected_by_name
    FROM loans l
    LEFT JOIN admins a ON l.approved_by = a.id
    LEFT JOIN admins r ON l.rejected_by = r.id
    WHERE l.id = $1
  `, [loanId]);
  if (!loan) return null;

  const notes = await all(`
    SELECT n.*, a.username AS admin_username
    FROM loan_notes n
    LEFT JOIN admins a ON n.admin_id = a.id
    WHERE n.loan_id = $1
    ORDER BY n.created_at DESC
  `, [loanId]);

  const payments = await all(`
    SELECT p.*, a.username AS recorded_by_name
    FROM payments p
    LEFT JOIN admins a ON p.recorded_by = a.id
    WHERE p.loan_id = $1
    ORDER BY p.paid_at DESC
  `, [loanId]);

  const totalPaidRow = await one('SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE loan_id = $1', [loanId]);

  return { loan, notes, payments, totalPaid: totalPaidRow.total };
}

async function updateLoanStatus(loanId, newStatus, adminId) {
  const allowed = ['pending', 'approved', 'collected', 'rejected'];
  if (!allowed.includes(newStatus)) throw new Error('Invalid status');

  let sql, params;
  if (newStatus === 'approved') {
    sql = 'UPDATE loans SET status=$1, approved_at=NOW(), approved_by=$2 WHERE id=$3';
    params = [newStatus, adminId, loanId];
  } else if (newStatus === 'rejected') {
    sql = 'UPDATE loans SET status=$1, rejected_at=NOW(), rejected_by=$2 WHERE id=$3';
    params = [newStatus, adminId, loanId];
  } else if (newStatus === 'collected') {
    sql = 'UPDATE loans SET status=$1, collected_at=NOW() WHERE id=$2';
    params = [newStatus, loanId];
  } else {
    sql = 'UPDATE loans SET status=$1 WHERE id=$2';
    params = [newStatus, loanId];
  }

  const r = await run(sql, params);
  return r.rowCount > 0;
}

async function disburseToWallet(loanId, adminId) {
  const loan = await one('SELECT * FROM loans WHERE id = $1', [loanId]);
  if (!loan || !loan.user_id) return;

  let wallet = await one('SELECT * FROM wallets WHERE user_id = $1', [loan.user_id]);
  if (!wallet) {
    const r = await run(
      'INSERT INTO wallets (user_id, balance, currency) VALUES ($1, 0, $2) RETURNING *',
      [loan.user_id, loan.currency || 'USD']
    );
    wallet = r.rows[0];
  }

  const newBalance = Number(wallet.balance) + Number(loan.amount);
  await run('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2', [newBalance, wallet.id]);
  await run(
    `INSERT INTO wallet_transactions (wallet_id, type, amount, description, admin_id, loan_id)
     VALUES ($1,'credit',$2,$3,$4,$5)`,
    [wallet.id, loan.amount, `Loan disbursement — Ref: ${loan.reference_number}`, adminId, loanId]
  );
}

// ── Root redirect ─────────────────────────────────────────────
router.get('/', (req, res) => res.redirect('/admin/dashboard'));

// ── Auth ──────────────────────────────────────────────────────
router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', { title: 'Admin Login', csrfToken: req.csrfToken(), error: req.flash('error') });
});

router.post('/login', [
  body('username').trim().notEmpty().escape(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render('login', { title: 'Admin Login', csrfToken: req.csrfToken(), error: errors.array().map(e => e.msg).join(' ') });
  }

  const { username, password } = req.body;
  const admin = await one('SELECT * FROM admins WHERE username = $1', [username]);

  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    return res.status(401).render('login', { title: 'Admin Login', csrfToken: req.csrfToken(), error: 'Invalid username or password.' });
  }

  req.session.regenerate((err) => {
    if (err) { req.flash('error', 'Unable to log in.'); return res.redirect('/admin/login'); }
    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;
    req.session.save((saveErr) => {
      if (saveErr) { req.flash('error', 'Unable to log in.'); return res.redirect('/admin/login'); }
      audit.log({ adminId: admin.id, action: 'login', entityType: 'admin', entityId: admin.id });
      res.redirect('/admin/dashboard');
    });
  });
});

router.post('/logout', requireAdmin, (req, res) => {
  const adminId = req.session.adminId;
  req.session.destroy((err) => {
    if (err) console.error('[logout] Session destroy error:', err);
    audit.log({ adminId, action: 'logout', entityType: 'admin', entityId: adminId });
    res.clearCookie('connect.sid');
    res.redirect('/admin/login');
  });
});

// ── Dashboard ─────────────────────────────────────────────────
router.get('/dashboard', requireAdmin, async (req, res) => {
  const status = req.query.status || 'all';
  const search = req.query.search || '';
  const page = parseInt(req.query.page || '1', 10);
  const data = await getDashboardData({ statusFilter: status, search, page });

  res.render('dashboard', {
    title: 'Admin Dashboard',
    admin: { username: req.session.adminUsername },
    status, search,
    ...data,
    csrfToken: req.csrfToken(),
    success: req.flash('success'),
    error: req.flash('error'),
  });
});

// ── Loan detail ───────────────────────────────────────────────
const idValidation = param('id').isInt({ min: 1 }).withMessage('Invalid loan ID.');

router.get('/loans/:id', requireAdmin, idValidation, async (req, res) => {
  if (!validationResult(req).isEmpty()) { req.flash('error', 'Invalid loan ID.'); return res.redirect('/admin/dashboard'); }
  const loanId = parseInt(req.params.id, 10);
  const data = await getLoanWithNotes(loanId);
  if (!data) { req.flash('error', 'Loan not found.'); return res.redirect('/admin/dashboard'); }
  const documents = await all('SELECT * FROM loan_documents WHERE loan_id = $1 ORDER BY uploaded_at ASC', [loanId]);
  res.render('loan-detail', {
    title: `Loan ${data.loan.reference_number}`,
    admin: { username: req.session.adminUsername },
    ...data, documents,
    csrfToken: req.csrfToken(),
    success: req.flash('success'),
    error: req.flash('error'),
  });
});

// ── Loan status actions ───────────────────────────────────────
router.post('/loans/:id/approve', requireAdmin, idValidation, async (req, res) => {
  if (!validationResult(req).isEmpty()) { req.flash('error', 'Invalid loan ID.'); return res.redirect('/admin/dashboard'); }
  const loanId = parseInt(req.params.id, 10);
  const adminId = req.session.adminId;
  try {
    if (!await updateLoanStatus(loanId, 'approved', adminId)) { req.flash('error', 'Loan not found.'); return res.redirect('/admin/dashboard'); }
    const loan = await one('SELECT * FROM loans WHERE id = $1', [loanId]);
    await sendStatusUpdate(loan, 'approved');
    audit.log({ adminId, action: 'approve', entityType: 'loan', entityId: loanId, details: { reference: loan.reference_number } });
    req.flash('success', 'Loan approved successfully.');
  } catch (err) { console.error('[approve]', err); req.flash('error', 'Unable to approve loan.'); }
  res.redirect(`/admin/loans/${loanId}`);
});

router.post('/loans/:id/collect', requireAdmin, idValidation, async (req, res) => {
  if (!validationResult(req).isEmpty()) { req.flash('error', 'Invalid loan ID.'); return res.redirect('/admin/dashboard'); }
  const loanId = parseInt(req.params.id, 10);
  const adminId = req.session.adminId;
  try {
    if (!await updateLoanStatus(loanId, 'collected', adminId)) { req.flash('error', 'Loan not found.'); return res.redirect('/admin/dashboard'); }
    const loan = await one('SELECT * FROM loans WHERE id = $1', [loanId]);
    await sendStatusUpdate(loan, 'collected');
    audit.log({ adminId, action: 'collect', entityType: 'loan', entityId: loanId, details: { reference: loan.reference_number } });
    await disburseToWallet(loanId, adminId);
    req.flash('success', 'Loan marked as collected and funds disbursed to user wallet.');
  } catch (err) { console.error('[collect]', err); req.flash('error', 'Unable to mark loan as collected.'); }
  res.redirect(`/admin/loans/${loanId}`);
});

router.post('/loans/:id/reject', requireAdmin, idValidation, async (req, res) => {
  if (!validationResult(req).isEmpty()) { req.flash('error', 'Invalid loan ID.'); return res.redirect('/admin/dashboard'); }
  const loanId = parseInt(req.params.id, 10);
  const adminId = req.session.adminId;
  try {
    if (!await updateLoanStatus(loanId, 'rejected', adminId)) { req.flash('error', 'Loan not found.'); return res.redirect('/admin/dashboard'); }
    const loan = await one('SELECT * FROM loans WHERE id = $1', [loanId]);
    await sendStatusUpdate(loan, 'rejected');
    audit.log({ adminId, action: 'reject', entityType: 'loan', entityId: loanId, details: { reference: loan.reference_number } });
    req.flash('success', 'Loan rejected.');
  } catch (err) { console.error('[reject]', err); req.flash('error', 'Unable to reject loan.'); }
  res.redirect(`/admin/loans/${loanId}`);
});

// ── Notes & payments ──────────────────────────────────────────
router.post('/loans/:id/notes', requireAdmin, idValidation, body('note').trim().notEmpty().escape(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { req.flash('error', errors.array().map(e => e.msg).join(' ')); return res.redirect(`/admin/loans/${req.params.id}`); }
  const loanId = parseInt(req.params.id, 10);
  const adminId = req.session.adminId;
  try {
    await run('INSERT INTO loan_notes (loan_id, admin_id, note) VALUES ($1,$2,$3)', [loanId, adminId, req.body.note]);
    audit.log({ adminId, action: 'add_note', entityType: 'loan', entityId: loanId, details: { note: req.body.note } });
    req.flash('success', 'Note added.');
  } catch (err) { console.error('[note]', err); req.flash('error', 'Unable to add note.'); }
  res.redirect(`/admin/loans/${loanId}`);
});

router.post('/loans/:id/payments', requireAdmin, idValidation, [
  body('amount').isFloat({ min: 0.01 }).withMessage('Payment amount must be greater than 0.').toFloat(),
  body('notes').optional({ checkFalsy: true }).trim().escape(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { req.flash('error', errors.array().map(e => e.msg).join(' ')); return res.redirect(`/admin/loans/${req.params.id}`); }
  const loanId = parseInt(req.params.id, 10);
  const adminId = req.session.adminId;
  try {
    await run('INSERT INTO payments (loan_id, amount, recorded_by, notes) VALUES ($1,$2,$3,$4)', [loanId, req.body.amount, adminId, req.body.notes || null]);
    audit.log({ adminId, action: 'record_payment', entityType: 'loan', entityId: loanId, details: { amount: req.body.amount } });
    req.flash('success', 'Payment recorded.');
  } catch (err) { console.error('[payment]', err); req.flash('error', 'Unable to record payment.'); }
  res.redirect(`/admin/loans/${loanId}`);
});

// ── CSV export ────────────────────────────────────────────────
router.get('/export/csv', requireAdmin, async (req, res) => {
  const status = req.query.status || 'all';
  const loans = status !== 'all'
    ? await all('SELECT * FROM loans WHERE status=$1 ORDER BY applied_at DESC', [status])
    : await all('SELECT * FROM loans ORDER BY applied_at DESC');

  const fields = [
    { label: 'Reference', value: 'reference_number' },
    { label: 'Full Name', value: 'full_name' },
    { label: 'Email', value: 'email' },
    { label: 'Phone', value: 'phone' },
    { label: 'Country', value: 'country' },
    { label: 'Employment Status', value: 'employment_status' },
    { label: 'Monthly Income', value: 'monthly_income' },
    { label: 'Amount', value: 'amount' },
    { label: 'Currency', value: 'currency' },
    { label: 'Term (months)', value: 'loan_term_months' },
    { label: 'Purpose', value: 'purpose' },
    { label: 'Status', value: 'status' },
    { label: 'Applied At', value: 'applied_at' },
    { label: 'Approved At', value: 'approved_at' },
    { label: 'Collected At', value: 'collected_at' },
  ];

  const csv = new Parser({ fields }).parse(loans);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="loans-${status}-${Date.now()}.csv"`);
  res.send(csv);
  audit.log({ adminId: req.session.adminId, action: 'export_csv', entityType: 'loans', details: { status, count: loans.length } });
});

// ── Settings ──────────────────────────────────────────────────
router.get('/settings', requireAdmin, async (req, res) => {
  const allSettings = await settings.getAll();
  res.render('settings', {
    title: 'Settings',
    admin: { username: req.session.adminUsername },
    settings: allSettings,
    csrfToken: req.csrfToken(),
    success: req.flash('success'),
    error: req.flash('error'),
  });
});

router.post('/settings', requireAdmin, [
  body('app_name').trim().notEmpty().escape(),
  body('support_email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('company_address').optional({ checkFalsy: true }).trim().escape(),
  body('email_sender_name').trim().notEmpty().escape(),
  body('interest_rate').optional({ checkFalsy: true }).isFloat({ min: 0, max: 100 }).toFloat(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { req.flash('error', errors.array().map(e => e.msg).join(' ')); return res.redirect('/admin/settings'); }
  await settings.set('app_name', req.body.app_name);
  await settings.set('support_email', req.body.support_email || '');
  await settings.set('company_address', req.body.company_address || '');
  await settings.set('email_sender_name', req.body.email_sender_name);
  await settings.set('interest_rate', req.body.interest_rate != null ? String(req.body.interest_rate) : '0');
  audit.log({ adminId: req.session.adminId, action: 'update_settings', entityType: 'settings' });
  req.flash('success', 'Settings saved.');
  res.redirect('/admin/settings');
});

// ── Profile ───────────────────────────────────────────────────
router.get('/profile', requireAdmin, (req, res) => {
  res.render('profile', {
    title: 'Admin Profile',
    admin: { username: req.session.adminUsername },
    csrfToken: req.csrfToken(),
    success: req.flash('success'),
    error: req.flash('error'),
  });
});

router.post('/profile/change-password', requireAdmin, [
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 8 }),
  body('confirm_password').custom((v, { req }) => v === req.body.new_password).withMessage('Passwords do not match.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { req.flash('error', errors.array().map(e => e.msg).join(' ')); return res.redirect('/admin/profile'); }
  const adminId = req.session.adminId;
  const admin = await one('SELECT * FROM admins WHERE id = $1', [adminId]);
  if (!await bcrypt.compare(req.body.current_password, admin.password_hash)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/admin/profile');
  }
  const newHash = await bcrypt.hash(req.body.new_password, 12);
  await run('UPDATE admins SET password_hash=$1 WHERE id=$2', [newHash, adminId]);
  audit.log({ adminId, action: 'change_password', entityType: 'admin', entityId: adminId });
  req.flash('success', 'Password changed successfully.');
  res.redirect('/admin/profile');
});

// ── Audit log ─────────────────────────────────────────────────
router.get('/audit-log', requireAdmin, async (req, res) => {
  const logs = await audit.getRecent(200);
  res.render('audit-log', { title: 'Audit Log', admin: { username: req.session.adminUsername }, logs });
});

// ── Chat logs ─────────────────────────────────────────────────
router.get('/chat-logs', requireAdmin, async (req, res) => {
  const sessions = await chatbot.getRecentSessions(100);
  res.render('chat-logs', {
    title: 'Chat Logs',
    csrfToken: req.csrfToken(),
    admin: { username: req.session.adminUsername },
    sessions,
    success: req.flash('success'),
    error: req.flash('error'),
  });
});

router.get('/chat-logs/:sessionId', requireAdmin, async (req, res) => {
  const sessionId = req.params.sessionId;
  const session = await one('SELECT * FROM chat_sessions WHERE session_id = $1', [sessionId]);
  if (!session) { req.flash('error', 'Chat session not found.'); return res.redirect('/admin/chat-logs'); }
  const messages = await chatbot.getSessionMessages(sessionId);
  res.render('chat-session', {
    title: 'Chat Session',
    csrfToken: req.csrfToken(),
    admin: { username: req.session.adminUsername },
    session, messages,
    success: req.flash('success'),
    error: req.flash('error'),
  });
});

// ── Notifications ─────────────────────────────────────────────
router.get('/notifications/unread-count', requireAdmin, async (req, res) => {
  const row = await one('SELECT COUNT(*)::int AS cnt FROM notifications WHERE read_at IS NULL');
  res.json({ count: row.cnt });
});

router.get('/notifications', requireAdmin, async (req, res) => {
  const notifications = await all('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50');
  res.render('notifications', {
    title: 'Notifications',
    notifications,
    csrfToken: req.csrfToken(),
  });
});

router.post('/notifications/mark-all-read', requireAdmin, async (req, res) => {
  await run('UPDATE notifications SET read_at=NOW() WHERE read_at IS NULL');
  res.redirect('/admin/notifications');
});

router.post('/notifications/:id/read', requireAdmin, async (req, res) => {
  await run('UPDATE notifications SET read_at=NOW() WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── Wallet management ─────────────────────────────────────────
router.get('/wallets', requireAdmin, async (req, res) => {
  const users = await all(`
    SELECT u.id, u.full_name, u.email, u.created_at,
           w.id AS wallet_id, w.balance, w.currency,
           COUNT(l.id)::int AS loan_count
    FROM users u
    LEFT JOIN wallets w ON w.user_id = u.id
    LEFT JOIN loans l ON l.user_id = u.id
    GROUP BY u.id, w.id
    ORDER BY u.created_at DESC
  `);
  res.render('admin-wallets', {
    title: 'User Wallets',
    users,
    csrfToken: req.csrfToken(),
    success: req.flash('success'),
    error: req.flash('error'),
  });
});

router.post('/wallets/:userId/topup', requireAdmin, [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0.'),
  body('currency').trim().notEmpty(),
  body('description').trim().escape(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { req.flash('error', errors.array().map(e => e.msg).join(' ')); return res.redirect('/admin/wallets'); }

  const userId = parseInt(req.params.userId, 10);
  const { amount, currency, description } = req.body;
  const adminId = req.session.adminId;

  const user = await one('SELECT id, full_name FROM users WHERE id = $1', [userId]);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/wallets'); }

  let wallet = await one('SELECT * FROM wallets WHERE user_id = $1', [userId]);
  if (!wallet) {
    const r = await run('INSERT INTO wallets (user_id, balance, currency) VALUES ($1, 0, $2) RETURNING *', [userId, currency]);
    wallet = r.rows[0];
  }

  const newBalance = Number(wallet.balance) + parseFloat(amount);
  await run('UPDATE wallets SET balance=$1, currency=$2, updated_at=NOW() WHERE id=$3', [newBalance, currency, wallet.id]);
  await run(
    `INSERT INTO wallet_transactions (wallet_id, type, amount, description, admin_id) VALUES ($1,'credit',$2,$3,$4)`,
    [wallet.id, parseFloat(amount), description || 'Top-up by admin', adminId]
  );

  audit.log({ adminId, action: 'wallet_topup', entityType: 'user', entityId: userId, details: { amount, currency, newBalance } });
  req.flash('success', `Wallet topped up: ${Number(amount).toLocaleString()} ${currency} added to ${user.full_name}.`);
  res.redirect('/admin/wallets');
});

// ── Clear all registered users (and their loans/wallets) ─────
router.post('/clear-real-users', requireAdmin, async (req, res) => {
  // Delete all users — cascades to wallets, wallet_transactions, and nullifies user_id on loans
  await run('UPDATE loans SET user_id = NULL WHERE user_id IS NOT NULL');
  await run('DELETE FROM wallets WHERE user_id IN (SELECT id FROM users)');
  await run('DELETE FROM users');
  audit.log({ adminId: req.session.adminId, action: 'clear_real_users', entityType: 'users', entityId: null, details: { note: 'All registered users deleted by admin' } });
  req.flash('success', 'All registered users and their wallets have been cleared.');
  res.redirect('/admin');
});

module.exports = { router, disburseToWallet };
