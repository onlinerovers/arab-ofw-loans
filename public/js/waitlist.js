(function () {
  var wlTbody = document.getElementById('waitlist-tbody');
  var wlPrev  = document.getElementById('wl-prev');
  var wlNext  = document.getElementById('wl-next');
  var wlInfo  = document.getElementById('wl-page-info');
  var currentPage = 1;

  if (!wlTbody) return;

  function statusLabel(s) {
    var map = { pending: 'Pending', approved: 'Approved', collected: 'Funded', rejected: 'Rejected' };
    return map[s] || s.charAt(0).toUpperCase() + s.slice(1);
  }

  function loadWaitlist(page) {
    wlTbody.innerHTML = '<tr><td colspan="3" class="empty-row">Loading…</td></tr>';
    fetch('/waitlist?page=' + page)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.rows || data.rows.length === 0) {
          wlTbody.innerHTML = '<tr><td colspan="3" class="empty-row">No applications yet. Be the first to apply!</td></tr>';
          if (wlPrev) wlPrev.disabled = true;
          if (wlNext) wlNext.disabled = true;
          return;
        }
        wlTbody.innerHTML = data.rows.map(function (r) {
          return '<tr><td>' + r.full_name + '</td>' +
            '<td><span class="status-badge status-' + r.status + '">' + statusLabel(r.status) + '</span></td>' +
            '<td>' + new Date(r.applied_at).toLocaleDateString() + '</td></tr>';
        }).join('');
        currentPage = data.page;
        if (wlInfo) wlInfo.textContent = 'Page ' + data.page + ' of ' + data.totalPages;
        if (wlPrev) wlPrev.disabled = data.page <= 1;
        if (wlNext) wlNext.disabled = data.page >= data.totalPages;
      })
      .catch(function () {
        wlTbody.innerHTML = '<tr><td colspan="3" class="empty-row">Failed to load. Please refresh.</td></tr>';
      });
  }

  loadWaitlist(1);
  if (wlPrev) wlPrev.addEventListener('click', function () { loadWaitlist(currentPage - 1); });
  if (wlNext) wlNext.addEventListener('click', function () { loadWaitlist(currentPage + 1); });
})();
