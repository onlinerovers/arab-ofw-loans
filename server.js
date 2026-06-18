require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const ejsLayouts = require('express-ejs-layouts');
const pgSession = require('connect-pg-simple')(session);

const { pool, init: initDb } = require('./db');
const settings = require('./services/settings');
const { csrfProtection } = require('./middleware/csrf');
const publicRoutes = require('./routes/public');
const { router: adminRoutes } = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const userRoutes = require('./routes/user');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
}));

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
const applyLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: 10,  message: 'Too many applications. Please try again later.', standardHeaders: true, legacyHeaders: false });
const loginLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 10,  message: 'Too many login attempts. Please try again later.', standardHeaders: true, legacyHeaders: false });

app.use(generalLimiter);
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(ejsLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error('[server] SESSION_SECRET is required.');
  process.exit(1);
}

app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  name: 'connect.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: process.env.SESSION_COOKIE_HTTPONLY !== 'false',
    secure: NODE_ENV === 'production',
    sameSite: process.env.SESSION_COOKIE_SAMESITE || 'strict',
    maxAge: 1000 * 60 * 60 * 24,
  },
}));

app.use((req, res, next) => {
  res.locals.appName = settings.get('app_name', process.env.APP_NAME || 'Arab OFW Loans & Partners');
  res.locals.admin = req.session?.adminId ? { id: req.session.adminId, username: req.session.adminUsername } : null;
  res.locals.currentUser = req.session?.userId ? { id: req.session.userId, name: req.session.userName, email: req.session.userEmail } : null;
  next();
});

app.use(flash());
app.use(csrfProtection);

app.use('/apply', applyLimiter);
app.use('/admin/login', loginLimiter);

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/user', userRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page Not Found', statusCode: 404, message: 'The page you requested could not be found.' });
});

app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).render('error', {
    title: 'Something Went Wrong',
    statusCode: 500,
    message: NODE_ENV === 'production' ? 'Something went wrong. Please try again later.' : (err.message || 'Internal server error'),
  });
});

async function start() {
  await initDb();
  await settings.load();
  app.listen(PORT, () => {
    console.log(`[server] ${settings.get('app_name', 'Arab OFW Loans & Partners')} running in ${NODE_ENV} mode on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
