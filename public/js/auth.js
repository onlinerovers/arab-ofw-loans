(function () {
  const passwordInput = document.getElementById('password');
  const passwordToggle = document.getElementById('passwordToggle');
  if (!passwordInput || !passwordToggle) return;

  passwordToggle.addEventListener('click', function () {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    passwordToggle.textContent = isPassword ? '🙈' : '👁️';
    passwordToggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  });
})();
