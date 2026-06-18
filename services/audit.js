const { run, all } = require('../db');

function log({ adminId, action, entityType, entityId, details }) {
  run(
    `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      adminId || null,
      action,
      entityType || null,
      entityId || null,
      details ? JSON.stringify(details) : null,
    ]
  ).catch((err) => console.error('[audit] Failed to log action:', err.message));
}

async function getRecent(limit = 100) {
  return all(
    `SELECT a.*, ad.username AS admin_username
     FROM audit_logs a
     LEFT JOIN admins ad ON a.admin_id = ad.id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [limit]
  );
}

module.exports = { log, getRecent };
