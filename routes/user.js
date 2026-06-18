const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { one, all, run } = require('../db');
const { requireUser, redirectIfLoggedIn } = require('../middleware/userAuth');

const router = express.Router();

// ── Register ──────────────────────────────────────────────────
router.get('/register', redirectIfLoggedIn, (req, res) => {
  res.render('user-register', {
    title: 'Create Account',
    csrfToken: req.csrfToken(),
    error: req.flash('error'),
    success: req.flash('success'),
    formData: {},
  });
});

router.post('/register', redirectIfLoggedIn, [
  body('full_name').trim().notEmpty().withMessage('Full name is required.').escape(),
  body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
  body('password_confirm').custom((val, { req }) => {
    if (val !== req.body.password) throw new Error('Passwords do not match.');
    return true;
  }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('user-register', {
      title: 'Create Account',
      csrfToken: req.csrfToken(),
      error: errors.array().map(e => e.msg),
      success: null,
      formData: req.body,
    });
  }

  const { full_name, email, password } = req.body;

  const existing = await one('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    return res.render('user-register', {
      title: 'Create Account',
      csrfToken: req.csrfToken(),
      error: ['An account with this email already exists. Please log in.'],
      success: null,
      formData: req.body,
    });
  }

  const hash = await bcrypt.hash(password, 12);
  const result = await run(
    'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [full_name, email, hash]
  );
  const userId = result.rows[0].id;

  // Link any existing loans submitted with this email
  await run('UPDATE loans SET user_id = $1 WHERE email = $2 AND user_id IS NULL', [userId, email]);

  req.session.userId = userId;
  req.session.userEmail = email;
  req.session.userName = full_name;
  res.redirect('/user/dashboard');
});

// ── Login ─────────────────────────────────────────────────────
router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.render('user-login', {
    title: 'Applicant Login',
    csrfToken: req.csrfToken(),
    error: req.flash('error'),
    success: req.flash('success'),
    formData: {},
  });
});

router.post('/login', redirectIfLoggedIn, [
  body('email').trim().isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('user-login', {
      title: 'Applicant Login',
      csrfToken: req.csrfToken(),
      error: ['Please enter a valid email and password.'],
      success: null,
      formData: req.body,
    });
  }

  const { email, password } = req.body;
  const user = await one('SELECT * FROM users WHERE email = $1', [email]);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render('user-login', {
      title: 'Applicant Login',
      csrfToken: req.csrfToken(),
      error: ['Invalid email or password.'],
      success: null,
      formData: req.body,
    });
  }

  req.session.userId = user.id;
  req.session.userEmail = user.email;
  req.session.userName = user.full_name;
  res.redirect('/user/dashboard');
});

// ── Logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/user/login'));
});

// ── Dashboard ─────────────────────────────────────────────────
router.get('/dashboard', requireUser, async (req, res) => {
  const user = await one('SELECT id, full_name, email, created_at FROM users WHERE id = $1', [req.session.userId]);
  if (!user) {
    req.session.destroy();
    return res.redirect('/user/login');
  }

  const loans = await all('SELECT * FROM loans WHERE user_id = $1 ORDER BY applied_at DESC', [user.id]);
  const wallet = await one('SELECT * FROM wallets WHERE user_id = $1', [user.id]);
  const transactions = wallet
    ? await all('SELECT * FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 20', [wallet.id])
    : [];

  res.render('user-dashboard', {
    title: 'My Dashboard',
    csrfToken: req.csrfToken(),
    user,
    loans,
    wallet,
    transactions,
    error: req.flash('error'),
    success: req.flash('success'),
  });
});

module.exports = router;
