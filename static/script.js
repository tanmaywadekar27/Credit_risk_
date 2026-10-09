/* =============================================================
   CreditSense – behaviour
   Talks to FastAPI: GET /   and   POST /predict
   ============================================================= */
(() => {
  'use strict';

  /* ── Config ── */
  // Auto-detect: use the page's own origin when deployed (Render),
  // fall back to localhost for local development.
  const DEFAULT_API = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
    ? 'http://127.0.0.1:8000'
    : window.location.origin;

  const OPTIONS = {
    person_home_ownership: [
      ['RENT', 'Rent'], ['MORTGAGE', 'Mortgage'], ['OWN', 'Own'], ['OTHER', 'Other'],
    ],
    loan_intent: [
      ['PERSONAL', 'Personal'], ['EDUCATION', 'Education'], ['MEDICAL', 'Medical'],
      ['VENTURE', 'Venture'], ['HOMEIMPROVEMENT', 'Home Improvement'], ['DEBTCONSOLIDATION', 'Debt Consolidation'],
    ],
    loan_grade: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((g) => [g, g]),
    cb_person_default_on_file: [['N', 'No'], ['Y', 'Yes']],
  };

  const NUMERIC   = ['person_age', 'person_income', 'person_emp_length', 'loan_amnt', 'loan_int_rate', 'cb_person_cred_hist_length'];
  const INTEGERS  = new Set(['person_age', 'cb_person_cred_hist_length']);
  const CATS      = Object.keys(OPTIONS);

  const DEFAULTS = {
    person_age: 28, person_income: 55000, person_emp_length: 4,
    person_home_ownership: 'RENT', loan_intent: 'PERSONAL', loan_grade: 'B',
    loan_amnt: 10000, loan_int_rate: 11.5,
    cb_person_default_on_file: 'N', cb_person_cred_hist_length: 5,
  };

  const PRESETS = {
    steady: {
      person_age: 35, person_income: 90000, person_emp_length: 9,
      person_home_ownership: 'MORTGAGE', loan_intent: 'EDUCATION', loan_grade: 'A',
      loan_amnt: 8000, loan_int_rate: 7.5,
      cb_person_default_on_file: 'N', cb_person_cred_hist_length: 12,
    },
    stretched: {
      person_age: 23, person_income: 28000, person_emp_length: 1,
      person_home_ownership: 'RENT', loan_intent: 'MEDICAL', loan_grade: 'F',
      loan_amnt: 16000, loan_int_rate: 19.8,
      cb_person_default_on_file: 'Y', cb_person_cred_hist_length: 2,
    },
  };

  /* ── Helpers ── */
  const $     = (id) => document.getElementById(id);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep   = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
  const fmt     = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

  /* ── DOM refs ── */
  const form          = $('appForm');
  const verdict       = $('verdict');
  const gFill         = $('gFill');
  const needle        = $('needle');
  const gThresh       = $('gThresh');
  const gThreshLabel  = $('gThreshLabel');
  const pctNum        = $('pctNum');
  const vLabel        = $('vLabel');
  const vNote         = $('vNote');
  const statProb      = $('statProb');
  const statThr       = $('statThr');
  const statGap       = $('statGap');
  const submitBtn     = $('submitBtn');
  const submitText    = $('submitText');
  const apiUrlInput   = $('apiUrl');
  const connMsg       = $('connMsg');
  const historyBox    = $('historyBox');
  const historyList   = $('historyList');
  const historyCount  = $('historyCount');
  const panelChip     = $('panelStateChip');
  const statChecks    = $('stat-checks');
  const statThreshDisp = $('stat-threshold-display');

  const checks  = { count: 0 };
  const history = [];
  let countRaf  = 0;

  /* ──────────────────────────────────────────
     Particle canvas
  ────────────────────────────────────────── */
  (function initParticles() {
    const canvas = $('particleCanvas');
    if (!canvas || reduced) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [];

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function Particle() {
      this.reset();
    }
    Particle.prototype.reset = function () {
      this.x  = Math.random() * W;
      this.y  = Math.random() * H;
      this.r  = Math.random() * 1.6 + 0.3;
      this.vx = (Math.random() - 0.5) * 0.25;
      this.vy = (Math.random() - 0.5) * 0.25;
      this.a  = Math.random() * 0.45 + 0.05;
    };
    Particle.prototype.update = function () {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
    };

    function createParticles(n) {
      particles = Array.from({ length: n }, () => new Particle());
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(130, 170, 255, ${p.a})`;
        ctx.fill();
        p.update();
      });
      requestAnimationFrame(draw);
    }

    window.addEventListener('resize', () => { resize(); createParticles(70); });
    resize();
    createParticles(70);
    draw();
  })();

  /* ──────────────────────────────────────────
     Build chip groups
  ────────────────────────────────────────── */
  function buildChips() {
    document.querySelectorAll('.chip-group').forEach((box) => {
      const name = box.dataset.name;
      OPTIONS[name].forEach(([value, label]) => {
        const id  = `${name}_${value}`;
        const inp = document.createElement('input');
        inp.type  = 'radio';
        inp.name  = name;
        inp.id    = id;
        inp.value = value;
        const lab = document.createElement('label');
        lab.htmlFor     = id;
        lab.textContent = label;
        box.append(inp, lab);
      });
    });
  }

  /* ──────────────────────────────────────────
     Number + slider pairs
  ────────────────────────────────────────── */
  function paintSlider(pair) {
    const num = pair.querySelector('input[type=number]');
    const rng = pair.querySelector('.range-slider');
    if (!rng) return;
    const min = Number(rng.min);
    const max = Number(rng.max);
    const v   = num.value === '' ? min : Number(num.value);
    const pct = Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
    rng.value = String(v);
    rng.style.setProperty('--fill', `${pct}%`);
  }

  function validateField(num) {
    const wrap = num.closest('.field-wrap');
    let msg = '';
    if (!num.checkValidity()) {
      if (num.value === '') msg = 'Enter a value';
      else if (num.validity.rangeUnderflow) msg = `Min: ${num.min}`;
      else if (num.validity.rangeOverflow)  msg = `Max: ${num.max}`;
      else msg = num.validationMessage;
    }
    wrap.classList.toggle('invalid', Boolean(msg));
    if (msg) wrap.dataset.msg = msg; else delete wrap.dataset.msg;
    return !msg;
  }

  function bindPairs() {
    document.querySelectorAll('.field-pair').forEach((pair) => {
      const num = pair.querySelector('input[type=number]');
      const rng = pair.querySelector('.range-slider');
      if (!num || !rng) return;
      rng.addEventListener('input', () => { num.value = rng.value; paintSlider(pair); validateField(num); updateRatio(); });
      num.addEventListener('input', () => { paintSlider(pair); validateField(num); updateRatio(); });
    });
  }

  /* ──────────────────────────────────────────
     Debt-to-income meter
  ────────────────────────────────────────── */
  function updateRatio() {
    const income = Number(form.elements.person_income.value);
    const loan   = Number(form.elements.loan_amnt.value);
    const ok     = income > 0 && loan >= 0;
    const ratio  = ok ? loan / income : NaN;
    const meter  = $('ratioMeter');

    $('ratioVal').textContent   = ok ? ratio.toFixed(2) : '—';
    $('ratioBar').style.width   = `${(ok ? Math.min(ratio, 1) : 0) * 100}%`;
    meter.dataset.level         = !ok || ratio < 0.2 ? 'low' : ratio < 0.35 ? 'mid' : 'high';
    $('ratioHint').textContent  = ok
      ? `Loan = ${Math.round(ratio * 100)}% of annual income. Passed automatically to the model.`
      : 'Calculated automatically from loan amount ÷ annual income.';
  }

  /* ──────────────────────────────────────────
     Reading + writing form
  ────────────────────────────────────────── */
  function readForm() {
    const p = {};
    NUMERIC.forEach((n) => {
      const v = Number(form.elements[n].value);
      p[n] = INTEGERS.has(n) ? Math.round(v) : v;
    });
    CATS.forEach((n) => { p[n] = form.elements[n].value; });
    p.loan_percent_income = Math.round((p.loan_amnt / p.person_income) * 100) / 100;
    return p;
  }

  function tweenNumber(input, to, ms = 500) {
    const from  = Number(input.value) || 0;
    const fire  = () => input.dispatchEvent(new Event('input', { bubbles: true }));
    if (reduced || from === to) { input.value = to; fire(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      input.value = k === 1 ? to : Math.round((from + (to - from) * e) * 10) / 10;
      fire();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function setValues(values) {
    NUMERIC.forEach((n) => tweenNumber(form.elements[n], values[n]));
    CATS.forEach((n) => {
      const radio = form.querySelector(`input[name="${n}"][value="${values[n]}"]`);
      if (radio) radio.checked = true;
    });
  }

  /* ──────────────────────────────────────────
     Gauge
  ────────────────────────────────────────── */
  function resetGauge(instant = false) {
    if (instant) {
      gFill.style.transition  = 'none';
      needle.style.transition = 'none';
    }
    gFill.style.strokeDashoffset  = '100';
    needle.style.transform        = 'rotate(-90deg)';
    if (instant) {
      void gFill.getBoundingClientRect();
      gFill.style.transition  = '';
      needle.style.transition = '';
    }
  }

  function aimGauge(p) {
    gFill.style.strokeDashoffset = String(100 - p * 100);
    needle.style.transform       = `rotate(${-90 + p * 180}deg)`;
  }

  function placeThreshold(t) {
    const a   = -90 + t * 180;
    const rad = (a * Math.PI) / 180;
    const r   = 130;
    gThresh.setAttribute('transform', `translate(160 150) rotate(${a})`);
    gThreshLabel.setAttribute('x', (160 + r * Math.sin(rad)).toFixed(1));
    gThreshLabel.setAttribute('y', (150 - r * Math.cos(rad) + 4).toFixed(1));
    gThreshLabel.textContent = `cut-off ${(t * 100).toFixed(0)}%`;
    gThresh.classList.add('on');
    gThreshLabel.classList.add('on');
  }

  function countUp(to, ms) {
    cancelAnimationFrame(countRaf);
    if (reduced) { pctNum.textContent = to.toFixed(1); return; }
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      pctNum.textContent = (to * e).toFixed(1);
      if (k < 1) countRaf = requestAnimationFrame(tick);
    };
    countRaf = requestAnimationFrame(tick);
  }

  /* ──────────────────────────────────────────
     Panel states
  ────────────────────────────────────────── */
  function setIdle() {
    cancelAnimationFrame(countRaf);
    document.body.removeAttribute('data-verdict');
    verdict.removeAttribute('data-verdict');
    verdict.dataset.state = 'idle';
    resetGauge();
    pctNum.textContent  = '—';
    vLabel.textContent  = 'Awaiting Application';
    vNote.textContent   = 'Fill in the applicant details and click Analyze Risk.';
    panelChip.textContent = 'Awaiting input';
    statProb.textContent = statThr.textContent = statGap.textContent = '—';
    gThresh.classList.remove('on');
    gThreshLabel.classList.remove('on');
  }

  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.setAttribute('aria-busy', String(on));
    submitText.textContent = on ? 'Analyzing…' : 'Analyze Risk';
    if (!on) return;

    cancelAnimationFrame(countRaf);
    document.body.removeAttribute('data-verdict');
    verdict.removeAttribute('data-verdict');
    verdict.dataset.state = 'loading';
    gFill.style.strokeDashoffset = '100';
    needle.style.transform = 'rotate(-55deg)';
    pctNum.textContent     = '—';
    vLabel.textContent     = 'Scoring…';
    vNote.textContent      = 'Sending applicant data to the model.';
    panelChip.textContent  = 'Processing';
    statProb.textContent   = statThr.textContent = statGap.textContent = '—';
  }

  function showError(message) {
    cancelAnimationFrame(countRaf);
    document.body.removeAttribute('data-verdict');
    verdict.removeAttribute('data-verdict');
    verdict.dataset.state = 'error';
    resetGauge();
    pctNum.textContent    = '—';
    vLabel.textContent    = 'Error';
    vNote.textContent     = message;
    panelChip.textContent = 'Error';
    statProb.textContent  = statThr.textContent = statGap.textContent = '—';
  }

  function showResult(data) {
    const p    = clamp01(data.default_probability);
    const t    = clamp01(data.threshold);
    const high = Number(data.default_prediction) === 1;
    const gap  = (p - t) * 100;

    document.body.dataset.verdict = high ? 'high' : 'low';
    verdict.dataset.verdict       = high ? 'high' : 'low';
    verdict.dataset.state = 'settling';
    void verdict.offsetWidth;
    verdict.dataset.state = 'result';

    aimGauge(p);
    placeThreshold(t);
    countUp(p * 100, 1400);

    vLabel.textContent = high ? '⚠ High Risk' : '✓ Low Risk';
    const near = Math.abs(gap) < 3 ? ' Close to cut-off — review carefully.' : '';
    vNote.textContent = (high
      ? `Probability (${(p*100).toFixed(1)}%) ≥ cut-off (${(t*100).toFixed(1)}%) — flagged.`
      : `Probability (${(p*100).toFixed(1)}%) < cut-off (${(t*100).toFixed(1)}%) — not flagged.`
    ) + near;

    panelChip.textContent = high ? 'High Risk' : 'Low Risk';
    statProb.textContent  = `${(p * 100).toFixed(2)}%`;
    statThr.textContent   = `${(t * 100).toFixed(2)}%`;
    statGap.textContent   = Math.abs(gap) < 0.05
      ? 'At the cut-off'
      : `${Math.abs(gap).toFixed(1)} pp ${gap > 0 ? 'above' : 'below'}`;

    // Update global threshold display in hero
    if (statThreshDisp) statThreshDisp.textContent = `${(t * 100).toFixed(0)}%`;
  }

  /* ──────────────────────────────────────────
     History
  ────────────────────────────────────────── */
  function renderHistory() {
    historyBox.hidden = history.length === 0;
    if (historyCount) historyCount.textContent = history.length;
    historyList.replaceChildren(...history.map((h) => {
      const li   = document.createElement('li');
      const btn  = document.createElement('button');
      const high = Number(h.data.default_prediction) === 1;
      btn.type      = 'button';
      btn.className = 'h-item';
      btn.dataset.verdict = high ? 'high' : 'low';
      btn.innerHTML = '<span class="h-dot"></span><span class="h-main"><strong></strong><span></span></span><span class="h-sub"></span>';
      btn.querySelector('strong').textContent           = `${(clamp01(h.data.default_probability) * 100).toFixed(1)}%`;
      btn.querySelector('.h-main span').textContent     = high ? 'High risk' : 'Low risk';
      btn.querySelector('.h-sub').textContent           = `${h.payload.loan_grade} · $${fmt(h.payload.loan_amnt)}`;
      btn.addEventListener('click', () => {
        setValues(h.payload);
        resetGauge(true);
        showResult(h.data);
      });
      li.append(btn);
      return li;
    }));
  }

  function pushHistory(payload, data) {
    history.unshift({ payload, data });
    history.length = Math.min(history.length, 5);
    renderHistory();
    checks.count++;
    if (statChecks) statChecks.textContent = checks.count;
  }

  /* ──────────────────────────────────────────
     API
  ────────────────────────────────────────── */
  function apiBase() {
    return (apiUrlInput.value.trim() || DEFAULT_API).replace(/\/+$/, '');
  }

  async function request(path, options = {}, timeout = 12000) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      return await fetch(apiBase() + path, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function setPill(state, text) {
    $('apiPill').dataset.state    = state;
    $('apiPillText').textContent  = text;
  }

  async function checkApi() {
    setPill('checking', 'Connecting…');
    connMsg.textContent = '';
    try {
      const res = await request('/', {}, 5000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPill('online', 'API connected');
      connMsg.textContent = '✓ Connected successfully.';
      return true;
    } catch {
      setPill('offline', 'API offline');
      connMsg.textContent = '✗ Cannot reach the API. Make sure uvicorn is running and CORS is enabled.';
      return false;
    }
  }

  function describeFailure(err) {
    if (err?.name === 'AbortError') return 'Request timed out. Try again.';
    if (err instanceof TypeError)   return `Cannot reach ${apiBase()}. Check that uvicorn is running.`;
    return err?.message || 'Something went wrong.';
  }

  async function describeBadResponse(res) {
    if (res.status === 422) {
      try {
        const body = await res.json();
        if (Array.isArray(body.detail)) {
          return 'Validation error: ' + body.detail
            .map((d) => `${d.loc[d.loc.length - 1]} (${d.msg})`).join(', ') + '.';
        }
      } catch { /* fall through */ }
    }
    return `API error (status ${res.status}).`;
  }

  /* ──────────────────────────────────────────
     Form submission
  ────────────────────────────────────────── */
  function validateAll() {
    let first = null;
    form.querySelectorAll('.field-pair input[type=number]').forEach((num) => {
      if (!validateField(num) && !first) first = num;
    });
    if (first) first.focus();
    return !first;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateAll()) return;

    const payload = readForm();
    const started = performance.now();
    setLoading(true);

    // Scroll to result panel on mobile
    if (window.matchMedia('(max-width: 1100px)').matches) {
      verdict.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }

    try {
      const res = await request('/predict', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await describeBadResponse(res));

      const data = await res.json();
      if (typeof data.default_probability !== 'number' || typeof data.threshold !== 'number') {
        throw new Error('Unexpected response shape from API.');
      }

      await sleep(Math.max(0, 700 - (performance.now() - started)));
      setLoading(false);
      setPill('online', 'API connected');
      showResult(data);
      pushHistory(payload, data);
    } catch (err) {
      setLoading(false);
      if (err instanceof TypeError || err?.name === 'AbortError') setPill('offline', 'API offline');
      showError(describeFailure(err));
    }
  });

  /* ──────────────────────────────────────────
     Buttons
  ────────────────────────────────────────── */
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => setValues(PRESETS[btn.dataset.preset]));
  });

  $('resetBtn').addEventListener('click', () => {
    setValues(DEFAULTS);
    form.querySelectorAll('.field-wrap.invalid').forEach((f) => f.classList.remove('invalid'));
    setIdle();
  });

  $('apiTest').addEventListener('click', () => {
    try { localStorage.setItem('riskApiUrl', apiBase()); } catch { /* ignore */ }
    checkApi();
  });

  apiUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('apiTest').click(); }
  });

  /* ──────────────────────────────────────────
     Init
  ────────────────────────────────────────── */
  function init() {
    buildChips();
    bindPairs();

    // Populate defaults without animation
    NUMERIC.forEach((n) => {
      form.elements[n].value = DEFAULTS[n];
      // Find the .field-pair ancestor
      const pair = form.elements[n].closest('.field-pair');
      if (pair) paintSlider(pair);
    });
    CATS.forEach((n) => {
      const r = form.querySelector(`input[name="${n}"][value="${DEFAULTS[n]}"]`);
      if (r) r.checked = true;
    });
    updateRatio();

    try {
      apiUrlInput.value = localStorage.getItem('riskApiUrl') || DEFAULT_API;
    } catch {
      apiUrlInput.value = DEFAULT_API;
    }

    // Power-on gauge sweep
    if (!reduced) {
      setTimeout(() => {
        if (verdict.dataset.state !== 'idle') return;
        gFill.style.strokeDashoffset = '65';
        needle.style.transform       = 'rotate(-30deg)';
        setTimeout(() => {
          if (verdict.dataset.state === 'idle') resetGauge();
        }, 1200);
      }, 1200);
    }

    checkApi();
  }

  init();
})();
