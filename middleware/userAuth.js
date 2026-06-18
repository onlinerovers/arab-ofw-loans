function requireUser(req, res, next) {
  if (req.session && req.session.userId) return next();
  req.flash('error', 'Please log in to access your dashboard.');
  res.redirect('/user/login');
}

function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.userId) return res.redirect('/user/dashboard');
  next();
}

module.exports = { requireUser, redirectIfLoggedIn };
