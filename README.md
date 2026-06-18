# SafeLoans — Loan Collections Web App

A production-ready loan collections web application built with **Node.js**, **Express**, and **SQLite**.

- **Public homepage** with a polished design, loan application form, and transparent waitlist.
- **Admin dashboard** with secure login for reviewing, approving, rejecting, collecting, and tracking repayments.
- **Email notifications**, audit logging, CSV export, search, pagination, admin notes, and settings.
- **CSRF protection**, rate limiting, Helmet security headers, input validation, and bcrypt-hashed passwords.

---

## Features

### Public site
- Hero section explaining the app.
- Floating AI chatbot widget that understands natural language and replies in the user's language (OpenAI-powered; optional fallback FAQ bot if no API key).
- Expanded loan application form:
  - Name, email, phone, address
  - Employment status, monthly income, ID number
  - Loan amount, term, purpose
  - Terms and conditions acceptance
- Unique application reference number shown after submission.
- Public waitlist showing total applied, pending, and collected counts.
- Sanitized application list (name + status + date) for transparency.

### Admin dashboard
- Secure username/password login with sessions.
- Summary cards: total, pending, approved, collected, rejected.
- Search by name, email, phone, reference number, or ID number.
- Filter by status and paginated results.
- CSV export of applications.
- Detailed loan view with:
  - Full applicant and loan information
  - Approve / Reject / Mark collected actions
  - Repayment tracking with payment history
  - Admin notes
- Chat logs to review visitor conversations with the chatbot
- Settings page for app name, support email, sender name, and company address.
- Admin profile with password change.
- Audit log of admin actions.

### Notifications & security
- Email notifications sent to applicants on status changes (SMTP required).
- CSRF protection on all state-changing forms.
- Rate limiting on applications and login attempts.
- Helmet security headers.
- bcrypt-hashed admin passwords.
- Input validation and sanitization.

---

## Tech stack

- **Backend:** Node.js, Express
- **Database:** SQLite (via `better-sqlite3`)
- **Templating:** EJS with `express-ejs-layouts`
- **Auth:** `express-session` + `bcrypt`
- **Security:** `helmet`, `express-rate-limit`, `express-validator`, `lusca` (CSRF)
- **Email:** `nodemailer`
- **CSV export:** `json2csv`
- **Config:** `dotenv`

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example file and update the secrets and admin password:

```bash
cp .env.example .env
```

Edit `.env`:

```env
NODE_ENV=development
PORT=3000
APP_NAME="SafeLoans"
APP_URL=http://localhost:3000

SESSION_SECRET=change_this_to_a_long_random_string
CSRF_SECRET=change_this_to_another_long_random_string

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_strong_admin_password

# Optional: email notifications
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-email-password
EMAIL_SENDER_NAME=SafeLoans

SUPPORT_EMAIL=support@example.com
COMPANY_ADDRESS=123 Main Street, City, Country
```

> ⚠️ **Never use the default secrets in production.**

### 3. Start the server

```bash
npm start
```

Or use auto-reload during development:

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

### 4. Log in as admin

- URL: `http://localhost:3000/admin/login`
- Default credentials (from `.env`):
  - Username: `admin`
  - Password: `admin123` (if you kept the development defaults)

---

## Project structure

```
.
├── data/                  # SQLite database files
├── middleware/
│   ├── auth.js            # Admin session guards
│   └── csrf.js            # CSRF middleware (lusca)
├── public/
│   ├── css/
│   │   └── styles.css     # App styles
│   └── js/
│       ├── auth.js        # Password toggle
│       ├── dashboard.js   # Dashboard interactions
│       └── nav.js         # Admin navigation dropdown
├── routes/
│   ├── public.js          # Homepage + loan application
│   └── admin.js           # Admin auth + dashboard actions
├── services/
│   ├── audit.js           # Audit logging
│   ├── email.js           # Email notifications
│   └── settings.js        # App settings helper
├── utils/
│   └── reference.js       # Reference number generator
├── views/
│   ├── layout.ejs         # Base layout
│   ├── index.ejs          # Homepage
│   ├── login.ejs          # Admin login
│   ├── dashboard.ejs      # Admin dashboard
│   ├── loan-detail.ejs    # Single loan view
│   ├── settings.ejs       # App settings
│   ├── profile.ejs        # Admin profile
│   ├── audit-log.ejs      # Audit log
│   └── error.ejs          # Error pages
├── .env.example           # Environment template
├── db.js                  # Database setup, migrations & seeding
├── package.json
├── server.js              # Express app entry point
└── README.md
```

---

## Production checklist

Before deploying, make sure you:

1. **Change all secrets** in `.env`:
   - `SESSION_SECRET`
   - `CSRF_SECRET`
2. **Change the default admin password** (`ADMIN_PASSWORD`).
3. **Set `NODE_ENV=production`**.
4. **Enable secure cookies**:
   ```env
   SESSION_COOKIE_SECURE=true
   SESSION_COOKIE_HTTPONLY=true
   SESSION_COOKIE_SAMESITE=strict
   ```
   This requires HTTPS.
5. **Configure SMTP** if you want applicant email notifications:
   ```env
   SMTP_HOST=smtp.yourprovider.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@example.com
   SMTP_PASS=your-app-password
   EMAIL_SENDER_NAME=SafeLoans
   ```
6. **Optional: enable AI chatbot** by adding an OpenAI API key:
   ```env
   OPENAI_API_KEY=sk-your-key
   OPENAI_MODEL=gpt-3.5-turbo
   ```
   Without this key, the chatbot falls back to a simple FAQ keyword matcher.
7. **Use a persistent session store** (e.g., `connect-session-sequelize`, `connect-mongo`, or Redis) instead of the default memory store. The default store is not suitable for production and will lose sessions on restart.
7. **Use a process manager** like PM2, systemd, or Docker.
8. **Place the app behind HTTPS** (e.g., Nginx, Caddy, or a cloud load balancer).
9. **Regularly back up** the `data/loans.db` file.

---

## Deployment example with PM2

```bash
npm install -g pm2
NODE_ENV=production pm2 start server.js --name safer-loans
pm2 save
pm2 startup
```

---

## Database

The app uses SQLite. The database file is created automatically at `data/loans.db` on first run, along with the default admin user.

Migrations run automatically on startup. New columns and tables are added without losing existing data.

If you want to reset the database, stop the server and delete the files in `data/`:

```bash
rm -f data/loans.db data/loans.db-shm data/loans.db-wal
```

The schema and default admin will be recreated on the next start.

---

## License

MIT
