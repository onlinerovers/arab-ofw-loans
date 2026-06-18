(function () {
  document.querySelectorAll('.toggle-details').forEach(function (button) {
    button.addEventListener('click', function () {
      const row = button.closest('tr');
      const detailsRow = row.nextElementSibling;
      if (!detailsRow || !detailsRow.classList.contains('details-row')) return;

      const isHidden = detailsRow.hidden;
      detailsRow.hidden = !isHidden;
      button.textContent = isHidden ? 'Hide' : 'View';
      button.setAttribute('aria-expanded', String(isHidden));
    });
  });
})();
