/**
 * Seed 30 dummy applicants per day for 7 days.
 * Run once: node scripts/seed-waitlist.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../db');

const COUNTRIES = [
  { name: 'Kuwait',       currency: 'KWD', nationalities: ['Kuwaiti', 'Egyptian', 'Indian', 'Filipino'] },
  { name: 'UAE',          currency: 'AED', nationalities: ['Emirati', 'Pakistani', 'Indian', 'Filipino'] },
  { name: 'Saudi Arabia', currency: 'SAR', nationalities: ['Saudi', 'Yemeni', 'Egyptian', 'Filipino'] },
  { name: 'Qatar',        currency: 'QAR', nationalities: ['Qatari', 'Indian', 'Filipino', 'Nepali'] },
  { name: 'Bahrain',      currency: 'BHD', nationalities: ['Bahraini', 'Indian', 'Filipino', 'Pakistani'] },
  { name: 'Oman',         currency: 'OMR', nationalities: ['Omani', 'Indian', 'Filipino', 'Bangladeshi'] },
];

const FIRST_NAMES_MALE = [
  'Mohammed', 'Ahmed', 'Ali', 'Omar', 'Khalid', 'Abdullah', 'Hassan', 'Ibrahim',
  'Yusuf', 'Tariq', 'Nasser', 'Faisal', 'Samir', 'Rami', 'Bilal', 'Kareem',
  'Ziad', 'Adel', 'Walid', 'Maher', 'Sami', 'Jassim', 'Hamad', 'Sultan',
  'Rashid', 'Majid', 'Salim', 'Nawaf', 'Bader', 'Fahad',
];

const FIRST_NAMES_FEMALE = [
  'Fatima', 'Aisha', 'Maryam', 'Sara', 'Noura', 'Hessa', 'Reem', 'Layla',
  'Dana', 'Shaikha', 'Manal', 'Amira', 'Nadia', 'Hanan', 'Rana', 'Dina',
  'Lina', 'Yasmine', 'Ghada', 'Abeer',
];

const LAST_NAMES = [
  'Al-Rashidi', 'Al-Mutairi', 'Al-Otaibi', 'Al-Harbi', 'Al-Dosari',
  'Al-Mansoori', 'Al-Suwaidi', 'Al-Mazrouei', 'Al-Shamsi', 'Al-Nuaimi',
  'Al-Thani', 'Al-Kuwari', 'Al-Naimi', 'Al-Marri', 'Al-Emadi',
  'Al-Balushi', 'Al-Habsi', 'Al-Rawahi', 'Al-Maktoumi', 'Al-Zaabi',
  'Santos', 'Reyes', 'Cruz', 'Garcia', 'Mendoza',
  'Khan', 'Ahmed', 'Hussain', 'Malik', 'Sheikh',
  'Sharma', 'Patel', 'Singh', 'Nair', 'Kumar',
];

const PURPOSES = ['personal', 'business', 'education', 'medical', 'home improvement', 'travel', 'debt consolidation'];
const EMPLOYMENT = ['employed', 'self-employed'];
const STATUSES = ['pending', 'pending', 'pending', 'pending', 'approved', 'collected'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function randomName() {
  const male = Math.random() > 0.35;
  const first = male ? pick(FIRST_NAMES_MALE) : pick(FIRST_NAMES_FEMALE);
  return `${first} ${pick(LAST_NAMES)}`;
}

function randomEmail(name) {
  const clean = name.toLowerCase().replace(/[^a-z]/g, '.').replace(/\.+/g, '.');
  const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
  return `${clean}${rand(1, 999)}@${pick(domains)}`;
}

function randomPhone() {
  const prefixes = ['+965', '+971', '+966', '+974', '+973', '+968'];
  return `${pick(prefixes)}${rand(50000000, 99999999)}`;
}

function randomAmount(currency) {
  const ranges = { KWD: [500, 5000], AED: [2000, 20000], SAR: [2000, 20000], QAR: [2000, 20000], BHD: [500, 5000], OMR: [500, 5000] };
  const [min, max] = ranges[currency] || [1000, 10000];
  return rand(min / 100, max / 100) * 100;
}

const insertLoan = db.prepare(`
  INSERT INTO loans (
    reference_number, full_name, email, phone,
    country, currency, nationality, employment_status,
    monthly_income, amount, loan_term_months, purpose,
    status, applied_at, approved_at, collected_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const DAYS = 7;
const PER_DAY = 30;
let inserted = 0;

const today = new Date();
today.setHours(0, 0, 0, 0);

for (let d = 0; d < DAYS; d++) {
  const dayDate = new Date(today);
  dayDate.setDate(today.getDate() - d); // spread across past 7 days so they show up now

  for (let i = 0; i < PER_DAY; i++) {
    const country = pick(COUNTRIES);
    const name = randomName();
    const status = pick(STATUSES);

    // Randomise time within the day
    const appliedAt = new Date(dayDate);
    appliedAt.setHours(rand(7, 22), rand(0, 59), rand(0, 59));

    let approvedAt = null;
    let collectedAt = null;
    if (status === 'approved' || status === 'collected') {
      approvedAt = new Date(appliedAt.getTime() + rand(1, 3) * 86400000);
    }
    if (status === 'collected') {
      collectedAt = new Date(approvedAt.getTime() + rand(1, 2) * 86400000);
    }

    // unique reference
    const ref = 'LN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    insertLoan.run(
      ref,
      name,
      randomEmail(name),
      randomPhone(),
      country.name,
      country.currency,
      pick(country.nationalities),
      pick(EMPLOYMENT),
      rand(800, 6000),
      randomAmount(country.currency),
      pick([6, 12, 18, 24, 36]),
      pick(PURPOSES),
      status,
      appliedAt.toISOString().replace('T', ' ').slice(0, 19),
      approvedAt ? approvedAt.toISOString().replace('T', ' ').slice(0, 19) : null,
      collectedAt ? collectedAt.toISOString().replace('T', ' ').slice(0, 19) : null,
    );
    inserted++;
  }
}

console.log(`✅ Inserted ${inserted} dummy applicants (${PER_DAY}/day × ${DAYS} days)`);
process.exit(0);
