(function () {
  var badge = document.getElementById('notif-badge');
  if (!badge) return;

  function poll() {
    fetch('/admin/notifications/unread-count', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.count > 0) {
          badge.textContent = data.count > 99 ? '99+' : data.count;
          badge.style.display = 'inline-flex';
        } else {
          badge.style.display = 'none';
        }
      })
      .catch(function () {});
  }

  poll();
  setInterval(poll, 30000); // refresh every 30 s
})();
