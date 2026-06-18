const { one, run, all } = require('../db');

// In-memory cache so settings.get() stays synchronous for EJS/middleware use
let _cache = {};

async function load() {
  const rows = await all('SELECT key, value FROM settings');
  _cache = {};
  for (const r of rows) _cache[r.key] = r.value;
}

function get(key, defaultValue = '') {
  return key in _cache ? _cache[key] : defaultValue;
}

async function set(key, value) {
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
  _cache[key] = value;
}

async function getAll() {
  await load();
  return { ..._cache };
}

module.exports = { get, set, getAll, load };
