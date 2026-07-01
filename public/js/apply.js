(function () {
  /* ── Country / currency / ID label ── */
  var countryMap = {
    'Kuwait':       { currency: 'KWD', idLabel: 'Civil ID' },
    'Oman':         { currency: 'OMR', idLabel: 'Resident Card (Oman ID)' },
    'Bahrain':      { currency: 'BHD', idLabel: 'CPR Card' },
    'Saudi Arabia': { currency: 'SAR', idLabel: 'Iqama' },
    'UAE':          { currency: 'AED', idLabel: 'Emirates ID' },
    'Qatar':        { currency: 'QAR', idLabel: 'Qatar ID (QID)' },
    'Other':        { currency: '',    idLabel: 'National ID / Residence Permit' },
  };

  var countrySelect  = document.getElementById('country');
  var loanCurrency   = document.getElementById('loan-currency');
  var incomeCurrency = document.getElementById('income-currency');
  var idLabel        = document.getElementById('id-label');
  var idDocLabel     = document.getElementById('id-doc-label');
  var idInput        = document.getElementById('id_number');
  var amountInput    = document.getElementById('amount');

  var USD_MIN = 5000;
  var usdToCurrency = {
    KWD: 0.31,
    OMR: 0.38,
    BHD: 0.38,
    SAR: 3.75,
    AED: 3.67,
    QAR: 3.64,
  };

  function updateCountryFields() {
    var val  = countrySelect ? countrySelect.value : '';
    var info = countryMap[val] || { currency: '', idLabel: 'Residence ID Number' };
    if (loanCurrency)   loanCurrency.textContent   = info.currency || '—';
    if (incomeCurrency) incomeCurrency.textContent = info.currency || '—';
    if (idLabel)        idLabel.textContent        = info.idLabel;
    if (idDocLabel)     idDocLabel.textContent     = info.idLabel;
    if (idInput)        idInput.placeholder        = info.idLabel ? 'Enter your ' + info.idLabel + ' number' : 'Enter ID number';

    if (amountInput) {
      var cur = info.currency || '';
      var rate = cur && usdToCurrency[cur] ? usdToCurrency[cur] : null;
      var minAmount = rate ? Math.ceil((USD_MIN * rate) * 100) / 100 : USD_MIN;
      amountInput.min = String(minAmount);
      if (amountInput.value && Number(amountInput.value) < Number(minAmount)) {
        amountInput.setCustomValidity('Minimum loan amount is ' + minAmount.toLocaleString() + ' ' + (rate ? cur : 'USD') + '.');
      } else {
        amountInput.setCustomValidity('');
      }
    }
  }

  if (countrySelect) {
    countrySelect.addEventListener('change', updateCountryFields);
    updateCountryFields();
  }

  /* ── Purpose card → hidden select sync ── */
  var purposeCards   = document.querySelectorAll('.purpose-card input[type="radio"]');
  var purposeSelect  = document.getElementById('purpose');
  var allPurposeCards = document.querySelectorAll('.purpose-card');

  purposeCards.forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (purposeSelect) purposeSelect.value = radio.value;
      allPurposeCards.forEach(function (c) { c.classList.remove('selected'); });
      radio.closest('.purpose-card').classList.add('selected');
      updateSidebar();
    });
  });

  /* ── Multi-step navigation ── */
  var steps      = document.querySelectorAll('.form-step');
  var stepItems  = document.querySelectorAll('.step-item');
  var currentStep = 1;

  // If there are validation errors, start on step 1 but show all fields
  var hasError = document.querySelector('.alert-error');
  if (hasError) {
    steps.forEach(function (s) { s.classList.remove('hidden'); });
    document.getElementById('step-progress') && (document.getElementById('step-progress').style.display = 'none');
  }

  function goToStep(n) {
    currentStep = n;
    steps.forEach(function (s) {
      var sn = parseInt(s.getAttribute('data-step'), 10);
      s.classList.toggle('hidden', sn !== n);
    });
    stepItems.forEach(function (item) {
      var sn = parseInt(item.getAttribute('data-step'), 10);
      item.classList.toggle('active', sn === n);
      item.classList.toggle('done', sn < n);
    });
    window.scrollTo({ top: document.getElementById('apply').offsetTop - 20, behavior: 'smooth' });
  }

  function validateStep(n) {
    var step = document.querySelector('.form-step[data-step="' + n + '"]');
    if (!step) return true;
    var inputs = step.querySelectorAll('input[required], select[required]');
    var ok = true;
    inputs.forEach(function (inp) {
      // skip hidden purpose select — handled by radio
      if (inp.id === 'purpose') return;
      if (!inp.checkValidity()) {
        inp.reportValidity();
        ok = false;
      }
    });
    // Validate purpose radio on step 3
    if (n === 3) {
      var checked = step.querySelector('input[name="purpose"]:checked');
      if (!checked) {
        alert('Please select a loan purpose.');
        ok = false;
      }
    }
    return ok;
  }

  document.querySelectorAll('.btn-next').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = parseInt(btn.getAttribute('data-next'), 10);
      if (validateStep(currentStep)) {
        updateSidebar();
        goToStep(next);
      }
    });
  });

  document.querySelectorAll('.btn-back').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var back = parseInt(btn.getAttribute('data-back'), 10);
      goToStep(back);
    });
  });

  /* ── Live sidebar loan summary ── */
  var sbCard    = document.getElementById('loan-summary-card');
  var sbAmount  = document.getElementById('sb-amount');
  var sbTerm    = document.getElementById('sb-term');
  var sbMonthly = document.getElementById('sb-monthly');
  var amtInput  = document.getElementById('amount');
  var termInput = document.getElementById('loan_term_months');

  var config     = document.getElementById('apply-config');
  var ANNUAL_RATE = parseFloat(config ? config.getAttribute('data-interest-rate') : '0') || 0;

  function fmt(n, currency) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
           (currency ? ' ' + currency : '');
  }

  function calcEMI(principal, months, annualRate) {
    var r = annualRate / 100 / 12;
    if (r === 0) return principal / months;
    var f = Math.pow(1 + r, months);
    return principal * r * f / (f - 1);
  }

  function updateSidebar() {
    var amt   = parseFloat(amtInput ? amtInput.value : 0) || 0;
    var mos   = parseInt(termInput ? termInput.value : 0, 10) || 0;
    var cur   = (loanCurrency && loanCurrency.textContent !== '—') ? loanCurrency.textContent : '';

    if (amt > 0 && sbCard) {
      sbCard.style.display = 'block';
      sbAmount.textContent  = fmt(amt, cur);
      sbTerm.textContent    = mos > 0 ? mos + ' months' : '—';
      sbMonthly.textContent = (mos > 0) ? fmt(calcEMI(amt, mos, ANNUAL_RATE), cur) : '—';
    }
  }

  if (amtInput)  amtInput.addEventListener('input', updateSidebar);
  if (termInput) termInput.addEventListener('input', updateSidebar);
  if (countrySelect) countrySelect.addEventListener('change', updateSidebar);

  /* ── Schedule modal ── */
  var form       = document.getElementById('apply-form');
  var previewBtn = document.getElementById('preview-schedule-btn');
  var modal      = document.getElementById('schedule-modal');
  var cancelBtn  = document.getElementById('modal-cancel-btn');
  var cancelBtn2 = document.getElementById('modal-cancel-btn2');
  var confirmBtn = document.getElementById('modal-confirm-btn');

  function closeModal() {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  function buildSchedule(principal, months, annualRate) {
    var rows = [];
    var r = annualRate / 100 / 12;
    var emi = calcEMI(principal, months, annualRate);
    var balance = principal;
    for (var m = 1; m <= months; m++) {
      var interest      = balance * r;
      var principalPart = emi - interest;
      balance = Math.max(0, balance - principalPart);
      rows.push({ month: m, emi: emi, interest: interest, principal: principalPart, balance: balance });
    }
    return { emi: emi, rows: rows };
  }

  if (previewBtn) {
    previewBtn.addEventListener('click', function () {
      if (!validateStep(4)) return;

      var amt  = parseFloat(amtInput ? amtInput.value : 0) || 0;
      var mos  = parseInt(termInput ? termInput.value : 0, 10) || 0;
      var cur  = (loanCurrency && loanCurrency.textContent !== '—') ? loanCurrency.textContent : '';

      if (amt <= 0 || mos <= 0) {
        alert('Please go back and enter a valid loan amount and term.');
        return;
      }

      var res   = buildSchedule(amt, mos, ANNUAL_RATE);
      var total = res.emi * mos;

      document.getElementById('s-amount').textContent  = fmt(amt, cur);
      document.getElementById('s-term').textContent    = mos + ' month' + (mos !== 1 ? 's' : '');
      document.getElementById('s-rate').textContent    = ANNUAL_RATE + '%';
      document.getElementById('s-monthly').textContent = fmt(res.emi, cur);
      document.getElementById('s-total').textContent   = fmt(total, cur);

      var tbody = document.getElementById('schedule-body');
      tbody.innerHTML = '';
      res.rows.forEach(function (r) {
        var tr = document.createElement('tr');
        [r.month, fmt(r.emi, cur), fmt(r.interest, cur), fmt(r.principal, cur), fmt(r.balance, cur)].forEach(function (v) {
          var td = document.createElement('td');
          td.textContent = v;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    });
  }

  if (cancelBtn)  cancelBtn.addEventListener('click', closeModal);
  if (cancelBtn2) cancelBtn2.addEventListener('click', closeModal);
  modal && modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  if (confirmBtn) confirmBtn.addEventListener('click', function () { closeModal(); form.submit(); });

  /* ── Upload drop zones ── */
  document.querySelectorAll('.upload-drop').forEach(function (zone) {
    var input = zone.querySelector('.upload-input');
    var fnEl  = zone.querySelector('.upload-filename');
    if (!input) return;

    zone.addEventListener('click', function (e) {
      if (e.target === input) return; // already clicking the input — don't double-trigger
      input.click();
    });

    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', function ()  { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        updateFileName(input, fnEl, zone);
      }
    });

    input.addEventListener('change', function () { updateFileName(input, fnEl, zone); });
  });

  function updateFileName(input, fnEl, zone) {
    if (input.files && input.files.length > 0) {
      var names = Array.from(input.files).map(function (f) { return f.name; }).join(', ');
      if (fnEl) fnEl.textContent = names;
      zone.classList.add('upload-done');
    } else {
      if (fnEl) fnEl.textContent = '';
      zone.classList.remove('upload-done');
    }
  }

  /* ── Signature Pad ── */
  var canvas = document.getElementById('sig-canvas');
  var sigInput = document.getElementById('signature_data');
  var sigClear = document.getElementById('sig-clear');
  var sigMsg   = document.getElementById('sig-required-msg');

  if (canvas) {
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var hasSig  = false;
    var canvasReady = false;

    function resizeCanvas() {
      var ratio = window.devicePixelRatio || 1;
      var w = canvas.parentElement.clientWidth;
      if (!w) return; // still hidden — skip
      canvas.width  = w * ratio;
      canvas.height = 160 * ratio;
      canvas.style.width  = w + 'px';
      canvas.style.height = '160px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      canvasReady = true;
    }

    // Resize when step 4 becomes visible
    var origGoToStep = goToStep;
    goToStep = function (n) {
      origGoToStep(n);
      if (n === 4) setTimeout(resizeCanvas, 50);
    };

    window.addEventListener('resize', function () { if (canvasReady) resizeCanvas(); });

    function getPos(e) {
      var r = canvas.getBoundingClientRect();
      var src = e.touches ? e.touches[0] : e;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }

    canvas.addEventListener('mousedown',  function (e) { drawing = true; var p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('mousemove',  function (e) { if (!drawing) return; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSig = true; });
    canvas.addEventListener('mouseup',    function ()  { drawing = false; saveSignature(); });
    canvas.addEventListener('mouseleave', function ()  { drawing = false; });

    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); drawing = true; var p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
    canvas.addEventListener('touchmove',  function (e) { e.preventDefault(); if (!drawing) return; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSig = true; }, { passive: false });
    canvas.addEventListener('touchend',   function ()  { drawing = false; saveSignature(); });

    function saveSignature() {
      if (hasSig && sigInput) sigInput.value = canvas.toDataURL('image/png');
    }

    if (sigClear) {
      sigClear.addEventListener('click', function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasSig = false;
        if (sigInput) sigInput.value = '';
      });
    }

    // Validate signature on preview
    var origPreviewClick = document.getElementById('preview-schedule-btn');
    if (origPreviewClick) {
      origPreviewClick.addEventListener('click', function () {
        if (!hasSig) {
          if (sigMsg) sigMsg.style.display = 'block';
          canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          if (sigMsg) sigMsg.style.display = 'none';
        }
      }, true); // capture phase so it runs before the main handler
    }
  }

})();
