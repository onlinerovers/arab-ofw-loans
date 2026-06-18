(function () {
  const toggle = document.querySelector('.admin-dropdown-toggle');
  const menu = document.querySelector('.admin-dropdown-menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    menu.classList.toggle('open');
  });

  document.addEventListener('click', function () {
    menu.classList.remove('open');
  });
})();
