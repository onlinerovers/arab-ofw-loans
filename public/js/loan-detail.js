(function () {
  var rejectForm    = document.getElementById('reject-form');
  var confirmModal  = document.getElementById('reject-confirm');
  var cancelBtn     = document.getElementById('reject-cancel');
  var confirmBtn    = document.getElementById('reject-confirm-btn');

  if (!rejectForm || !confirmModal) return;

  rejectForm.addEventListener('submit', function (e) {
    e.preventDefault();
    confirmModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  });

  cancelBtn.addEventListener('click', function () {
    confirmModal.style.display = 'none';
    document.body.style.overflow = '';
  });

  confirmBtn.addEventListener('click', function () {
    confirmModal.style.display = 'none';
    document.body.style.overflow = '';
    rejectForm.submit();
  });

  confirmModal.addEventListener('click', function (e) {
    if (e.target === confirmModal) {
      confirmModal.style.display = 'none';
      document.body.style.overflow = '';
    }
  });
})();
