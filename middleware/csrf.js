const lusca = require('lusca');
const luscaToken = require('../node_modules/lusca/lib/token');

const SECRET_KEY = process.env.CSRF_SECRET || '_csrfSecret';

// Blocklist POST /apply — multer runs inside that route so req.body isn't
// parsed yet when global CSRF fires. We verify the token manually after multer.
const csrfProtection = lusca.csrf({
  key: '_csrf',
  secret: SECRET_KEY,
  blocklist: [{ path: '/apply', type: 'exact' }],
});

// Called inside the /apply route AFTER multer has populated req.body.
// Uses lusca's own token library so the logic is identical.
function verifyCsrfToken(req, res, next) {
  const submittedToken = (req.body && req.body._csrf) || (req.headers['x-csrf-token']);

  const impl = luscaToken.create(req, SECRET_KEY);
  const valid = impl.validate(req, submittedToken);

  if (!valid) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      statusCode: 403,
      message: 'Invalid or expired form token. Please go back and try again.',
    });
  }

  next();
}

module.exports = { csrfProtection, verifyCsrfToken };
