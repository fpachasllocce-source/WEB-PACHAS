/* ==========================================================================
   Mis Finanzas semanales — lógica de la app (sin dependencias)
   Cada persona entra con su correo y contraseña; sus datos se guardan en
   el servidor (api/index.php) y se sincronizan automáticamente.
   ========================================================================== */
(function () {
  'use strict';

  const LEGACY_KEY = 'fs-data-v1'; // datos de la versión sin cuentas (solo navegador)
  const API = 'api/index.php';
  const KINDS = {
    ingreso: { label: 'Ingreso', plural: 'Ingresos' },
    fijo:    { label: 'Gasto fijo', plural: 'Gastos fijos', color: '--s-fijo' },
    hormiga: { label: 'Gasto hormiga', plural: 'Gastos hormiga', color: '--s-hormiga' },
    compra:  { label: 'Compra', plural: 'Compras', color: '--s-compra' },
  };
  const EXPENSE_KINDS = ['fijo', 'hormiga', 'compra'];
  const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const KIND_HINTS = {
    ingreso: 'Sueldo, ventas, trabajos extra, propinas… todo lo que entra.',
    fijo: 'Pagos que se repiten: alquiler, luz, internet, celular, cuotas.',
    hormiga: 'Pequeños gastos diarios que suman: café, snacks, taxi, delivery.',
    compra: 'Compras puntuales: supermercado, ropa, tecnología, hogar.',
  };

  /* ---------------- State ---------------- */
  let state = emptyState();
  let user = null;
  let weekStart = mondayOf(new Date());
  let filter = 'all';
  let editingId = null;

  function emptyState() {
    return { currency: 'PEN', movements: [], fixed: [], appliedWeeks: {}, budgets: {} };
  }

  /* ---------------- Server ---------------- */
  async function api(action, body) {
    const opts = { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(API + '?action=' + action, opts); }
    catch (e) { throw Object.assign(new Error('No hay conexión. Revisa tu internet e inténtalo de nuevo.'), { status: 0 }); }
    let json = {};
    try { json = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error(json.error || 'Algo salió mal. Inténtalo de nuevo.'), { status: res.status, body: json });
    return json;
  }

  // Saving: every change is queued and sent to the server shortly after.
  // `rev` is the server revision our data is based on and `base` a copy of that
  // server data. If another device saved in between, the server answers 409 and
  // we merge (base → ours, base → theirs) instead of overwriting anything.
  let saveTimer = null, saving = false, dirty = false;
  let rev = 0, base = emptyState();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function adopt(data, newRev) {
    state = Object.assign(emptyState(), data || {});
    base = clone(state);
    rev = newRev || 0;
  }
  function save() {
    dirty = true;
    setSync('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  }
  async function flush() {
    if (saving || !dirty || !user) return;
    saving = true; dirty = false;
    const sent = clone(state);
    let retryIn = 0;
    try {
      const res = await api('save', { data: sent, baseRev: rev });
      rev = res.rev;
      base = sent;
    } catch (e) {
      dirty = true;
      if (e.status === 401) { saving = false; return sessionExpired(); }
      if (e.status === 402) { saving = false; return boot(); }
      if (e.status === 409 && e.body) {
        // edits made while this request was in flight are part of `state` and survive the merge
        const theirs = Object.assign(emptyState(), e.body.data || {});
        state = mergeState(base, state, theirs);
        base = clone(theirs);
        rev = e.body.rev;
        render();
        toast('Se combinaron cambios hechos en otro dispositivo');
      } else {
        setSync('error', e.message);
        retryIn = 5000;
      }
    }
    saving = false;
    if (dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, retryIn || 50); }
    else setSync('ok');
  }

  // Three-way merge of lists of {id,…}: keeps additions from both sides, applies
  // deletions from both sides, and when both edited the same item keeps ours.
  // An item deleted on one side but edited on the other is kept (never lose data).
  function mergeList(b, mine, theirs) {
    const key = (x) => JSON.stringify(x);
    const B = new Map((b || []).map((x) => [x.id, x]));
    const M = new Map((mine || []).map((x) => [x.id, x]));
    const T = new Map((theirs || []).map((x) => [x.id, x]));
    const ids = [...T.keys(), ...[...M.keys()].filter((id) => !T.has(id))];
    const out = [];
    for (const id of ids) {
      const inB = B.has(id), m = M.get(id), t = T.get(id);
      const mChanged = m && (!inB || key(m) !== key(B.get(id)));
      const tChanged = t && (!inB || key(t) !== key(B.get(id)));
      if (inB && !m) { if (tChanged) out.push(t); continue; }   // we deleted it
      if (inB && !t) { if (mChanged) out.push(m); continue; }   // they deleted it
      out.push(mChanged ? m : (t || m));
    }
    return out;
  }
  function mergeState(b, mine, theirs) {
    return {
      currency: mine.currency !== b.currency ? mine.currency : theirs.currency,
      movements: mergeList(b.movements, mine.movements, theirs.movements),
      fixed: mergeList(b.fixed, mine.fixed, theirs.fixed),
      appliedWeeks: Object.assign({}, theirs.appliedWeeks, mine.appliedWeeks),
      budgets: mergeKeys(b.budgets, mine.budgets, theirs.budgets),
    };
  }
  function mergeKeys(b, mine, theirs) {
    b = b || {}; mine = mine || {}; theirs = theirs || {};
    const out = Object.assign({}, theirs);
    Object.keys(Object.assign({}, b, mine)).forEach((k) => {
      if (mine[k] !== b[k]) { if (mine[k] === undefined) delete out[k]; else out[k] = mine[k]; }
    });
    return out;
  }

  // Coming back to the tab: pick up what was saved from another device
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !user || dirty || saving) return;
    try {
      const res = await api('data');
      if (res.rev > rev && !dirty && !saving) { adopt(res.data, res.rev); render(); }
    } catch (e) { if (e.status === 401) sessionExpired(); }
  });
  function setSync(st, msg) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.dataset.state = st;
    el.querySelector('span').textContent = st === 'saving' ? 'Guardando…' : st === 'error' ? 'Sin guardar' : 'Guardado';
    el.title = msg || (st === 'error' ? 'No se pudo guardar. Reintentando…' : 'Tus datos están guardados en tu cuenta');
  }
  addEventListener('beforeunload', (e) => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------------- Dates ---------------- */
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (x.getDay() + 6) % 7; // 0 = lunes
    x.setDate(x.getDate() - dow);
    return x;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function weekKey(d) { return iso(mondayOf(d)); }
  function fmtShortDate(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function weekLabel(start) {
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) return start.getDate() + ' – ' + end.getDate() + ' ' + MONTHS[end.getMonth()] + ' ' + end.getFullYear();
    return fmtShortDate(start) + ' – ' + fmtShortDate(end) + ' ' + end.getFullYear();
  }

  /* ---------------- Money ---------------- */
  let fmt, fmtCompact;
  function setFormatters() {
    fmt = new Intl.NumberFormat('es-PE', { style: 'currency', currency: state.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    fmtCompact = new Intl.NumberFormat('es-PE', { style: 'currency', currency: state.currency, notation: 'compact', maximumFractionDigits: 1 });
  }
  const money = (n) => fmt.format(n || 0);
  const moneyShort = (n) => (Math.abs(n) >= 10000 ? fmtCompact.format(n) : new Intl.NumberFormat('es-PE', { style: 'currency', currency: state.currency, maximumFractionDigits: 0 }).format(n));
  function currencySymbol() {
    const p = fmt.formatToParts(0).find((x) => x.type === 'currency');
    return p ? p.value : state.currency;
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  const weeklyOf = (f) => (f.freq === 'mensual' ? (f.amount * 12) / 52 : f.amount);

  /* ---------------- Aggregation ---------------- */
  function movementsOfWeek(start) {
    const a = iso(start), b = iso(addDays(start, 6));
    return state.movements.filter((m) => m.date >= a && m.date <= b);
  }
  function summarize(start) {
    const list = movementsOfWeek(start);
    const s = { ingreso: 0, fijo: 0, hormiga: 0, compra: 0, days: [] };
    for (let i = 0; i < 7; i++) s.days.push({ date: addDays(start, i), ingreso: 0, fijo: 0, hormiga: 0, compra: 0 });
    for (const m of list) {
      s[m.kind] += m.amount;
      const idx = Math.round((parseIso(m.date) - start) / 864e5);
      if (s.days[idx]) s.days[idx][m.kind] += m.amount;
    }
    s.gastos = s.fijo + s.hormiga + s.compra;
    s.ganancia = s.ingreso - s.gastos;
    s.count = list.length;
    return s;
  }

  /* ---------------- DOM helpers ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2600);
  }

  /* ---------------- Render ---------------- */
  function render() {
    setFormatters();
    const cur = summarize(weekStart);
    const prev = summarize(addDays(weekStart, -7));
    const isThisWeek = iso(weekStart) === iso(mondayOf(new Date()));

    $('#weekEyebrow').textContent = isThisWeek ? 'Semana actual' : (weekStart > new Date() ? 'Semana futura' : 'Semana pasada');
    $('#weekTitle').textContent = weekLabel(weekStart);
    $('#currency').value = state.currency;
    $('#curSymbol').textContent = currencySymbol();

    renderHero(cur, prev);
    renderKpis(cur, prev);
    renderDaily(cur);
    renderSplit(cur);
    renderTrend();
    renderFixed();
    renderTable();
  }

  function deltaHtml(now, before, expense) {
    if (!before && !now) return '&nbsp;';
    if (!before) return 'Sin datos la semana anterior';
    const pct = ((now - before) / before) * 100;
    if (Math.abs(pct) < 0.5) return 'Igual que la semana anterior';
    const up = pct > 0;
    const good = expense ? !up : up;
    return '<b class="' + (good ? 'good' : 'bad') + '">' + (up ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(0) + '%</b> vs semana anterior';
  }

  function renderHero(s, p) {
    $('#heroValue').textContent = money(s.ganancia);
    $('#heroValue').style.color = s.ganancia < 0 ? 'var(--bad)' : '';
    $('#heroIncome').textContent = money(s.ingreso);
    $('#heroExpense').textContent = money(s.gastos);

    const rate = s.ingreso > 0 ? (s.ganancia / s.ingreso) * 100 : 0;
    $('#saveFill').style.width = Math.max(0, Math.min(100, rate)) + '%';

    let sub;
    if (!s.ingreso && !s.gastos) sub = '<span class="muted">Registra movimientos para ver tu ganancia</span>';
    else if (s.ingreso > 0) {
      sub = '<span class="pill ' + (rate >= 0 ? 'pill--good' : 'pill--bad') + '">' + (rate >= 0 ? '✓' : '!') + ' ' + rate.toFixed(0) + '% de ahorro</span>';
      if (p.ingreso || p.gastos) {
        const diff = s.ganancia - p.ganancia;
        sub += ' <span class="muted">' + (diff >= 0 ? '+' : '−') + money(Math.abs(diff)) + ' vs semana anterior</span>';
      }
    } else sub = '<span class="pill pill--bad">! Sin ingresos registrados</span>';
    $('#heroSub').innerHTML = sub;

    let meta = '';
    if (s.ingreso > 0 && s.ganancia >= 0) meta = 'Ahorras ' + money(round2((s.ganancia / s.ingreso) * 10)) + ' de cada ' + money(10) + ' que ganas.';
    else if (s.ingreso > 0) meta = 'Esta semana gastaste ' + money(-s.ganancia) + ' más de lo que ganaste.';
    else if (s.gastos > 0) meta = 'Añade tus ingresos para calcular la ganancia real.';
    $('#heroMeta').textContent = meta;
  }

  function renderKpis(s, p) {
    $('#kIngreso').textContent = money(s.ingreso);
    $('#kFijo').textContent = money(s.fijo);
    $('#kHormiga').textContent = money(s.hormiga);
    $('#kCompra').textContent = money(s.compra);
    $('#dIngreso').innerHTML = deltaHtml(s.ingreso, p.ingreso, false);
    $('#dFijo').innerHTML = deltaHtml(s.fijo, p.fijo, true);
    $('#dHormiga').innerHTML = deltaHtml(s.hormiga, p.hormiga, true);
    $('#dCompra').innerHTML = deltaHtml(s.compra, p.compra, true);
    renderBudgets(s);
  }

  /* ---------------- Budgets ---------------- */
  const BUDGET_KEYS = [
    { k: 'total', label: 'Total de gastos', hint: 'Fijos + hormiga + compras' },
    { k: 'hormiga', label: 'Gastos hormiga', color: '--s-hormiga' },
    { k: 'compra', label: 'Compras', color: '--s-compra' },
    { k: 'fijo', label: 'Gastos fijos', color: '--s-fijo' },
  ];
  const spentOf = (s, k) => (k === 'total' ? s.gastos : s[k]);
  function budgetStatus(spent, limit) {
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    return { pct, level: pct > 100 ? 'bad' : pct >= 80 ? 'warn' : 'good' };
  }
  function renderBudgets(s) {
    const budgets = state.budgets || {};
    [['total', '#bTotal'], ['fijo', '#bFijo'], ['hormiga', '#bHormiga'], ['compra', '#bCompra']].forEach(([k, sel]) => {
      const el = $(sel), limit = +budgets[k] || 0;
      if (!limit) {
        el.innerHTML = k === 'total' ? '' : '<button class="budget__set" data-action="budgets">+ Poner límite semanal</button>';
        return;
      }
      const spent = spentOf(s, k);
      const { pct, level } = budgetStatus(spent, limit);
      const color = level === 'bad' ? 'var(--st-bad)' : level === 'warn' ? 'var(--st-warn)' : 'var(--st-good)';
      const msg = level === 'bad' ? '✕ Te pasaste ' + money(spent - limit)
        : level === 'warn' ? '⚠ Quedan ' + money(limit - spent)
        : '✓ Quedan ' + money(limit - spent);
      el.innerHTML = '<div class="budget__bar" role="img" aria-label="' + pct.toFixed(0) + '% del presupuesto"><span style="--c:' + color + ';width:' + Math.min(100, pct) + '%"></span></div>' +
        '<div class="budget__txt"><span>' + (k === 'total' ? 'Presupuesto semanal: ' : '') + pct.toFixed(0) + '% de ' + money(limit) + '</span><b class="' + level + '">' + msg + '</b></div>';
    });
  }
  // Toast when a change pushes a budget past 80% or 100%
  function budgetAlert(before, after) {
    const budgets = state.budgets || {};
    let alert = null;
    BUDGET_KEYS.forEach(({ k, label }) => {
      const limit = +budgets[k] || 0;
      if (!limit) return;
      const a = budgetStatus(spentOf(before, k), limit), b = budgetStatus(spentOf(after, k), limit);
      if (b.level === a.level || b.pct <= a.pct) return;
      const txt = b.level === 'bad'
        ? '✕ Te pasaste de tu presupuesto de ' + label.toLowerCase() + ' (' + money(limit) + ')'
        : '⚠ Ya usaste el ' + b.pct.toFixed(0) + '% de tu presupuesto de ' + label.toLowerCase();
      if (!alert || b.level === 'bad') alert = txt;
    });
    return alert;
  }
  const budgetModal = $('#budgetModal');
  function openBudgets() {
    // suggestion: average of the last 4 complete weeks
    const avg = {};
    BUDGET_KEYS.forEach(({ k }) => (avg[k] = 0));
    for (let i = 1; i <= 4; i++) {
      const w = summarize(addDays(mondayOf(new Date()), -7 * i));
      BUDGET_KEYS.forEach(({ k }) => (avg[k] += spentOf(w, k) / 4));
    }
    const b = state.budgets || {};
    $('#budgetFields').innerHTML = BUDGET_KEYS.map(({ k, label, hint, color }) =>
      '<label class="budget-field"><span>' + (color ? '<i style="--c:var(' + color + ')"></i>' : '') + '<span>' + label +
      '<small>' + (avg[k] > 0 ? 'Tu promedio: ' + money(avg[k]) + ' por semana' : (hint || 'Sin datos aún')) + '</small></span></span>' +
      '<div class="money-input"><em>' + esc(currencySymbol()) + '</em><input type="number" name="' + k + '" min="0" step="1" inputmode="decimal" placeholder="Sin límite" value="' + (b[k] || '') + '"></div></label>'
    ).join('');
    budgetModal.showModal();
  }
  $('#budgetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const budgets = {};
    BUDGET_KEYS.forEach(({ k }) => { const v = round2(parseFloat(e.target[k].value)); if (v > 0) budgets[k] = v; });
    state.budgets = budgets;
    save(); budgetModal.close(); render();
    toast('Presupuestos guardados');
  });

  /* ---- chart helpers ---- */
  function niceMax(v) {
    if (v <= 0) return 10;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
  }
  // rect with rounded top corners (data-end), square at the baseline
  function topRounded(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }
  function bottomRounded(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return 'M' + x + ',' + y + 'V' + (y + h - r) + 'Q' + x + ',' + (y + h) + ' ' + (x + r) + ',' + (y + h) +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w) + ',' + (y + h - r) + 'V' + y + 'Z';
  }

  const tip = $('#tooltip');
  function showTip(html, evt) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = evt.clientX + 14, y = evt.clientY - r.height - 10;
    if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - 14;
    if (y < 8) y = evt.clientY + 16;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip() { tip.hidden = true; }
  function bindTips(root, builder) {
    $$('[data-tip]', root).forEach((el) => {
      const i = +el.dataset.tip;
      el.addEventListener('mousemove', (e) => showTip(builder(i), e));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('click', (e) => showTip(builder(i), e));
    });
  }
  const tipRow = (label, value, color, cls) =>
    '<div class="row' + (cls ? ' ' + cls : '') + '"><span>' + (color ? '<i style="--c:var(' + color + ')"></i>' : '') + label + '</span><b>' + value + '</b></div>';

  function renderDaily(s) {
    const el = $('#dailyChart');
    const W = Math.max(300, el.clientWidth || 600), H = 250;
    const m = { t: 22, r: 4, b: 28, l: 48 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const totals = s.days.map((d) => d.fijo + d.hormiga + d.compra);
    const max = niceMax(Math.max(...totals));
    const y = (v) => m.t + ih - (v / max) * ih;
    const band = iw / 7, bw = Math.min(40, band * 0.56);
    const todayIso = iso(new Date());
    const peak = totals.indexOf(Math.max(...totals));

    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      g += '<line class="' + (i === 0 ? 'base-line' : 'grid-line') + '" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/>';
      g += '<text x="' + (m.l - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + moneyShort(v) + '</text>';
    }
    s.days.forEach((d, i) => {
      const cx = m.l + band * i + band / 2, x = cx - bw / 2;
      const isToday = iso(d.date) === todayIso;
      g += '<g class="col" data-tip="' + i + '"><rect class="col-bg" x="' + (m.l + band * i + 2) + '" y="' + m.t + '" width="' + (band - 4) + '" height="' + ih + '" rx="8"/>';
      let acc = 0;
      const segs = EXPENSE_KINDS.filter((k) => d[k] > 0);
      segs.forEach((k, j) => {
        const y0 = y(acc), y1 = y(acc + d[k]);
        let h = y0 - y1;
        const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked fills
        h = Math.max(0, h - gap);
        const top = j === segs.length - 1;
        const path = top ? topRounded(x, y1, bw, h, 4) : 'M' + x + ',' + y1 + 'h' + bw + 'v' + h + 'h' + -bw + 'Z';
        g += '<path d="' + path + '" fill="var(' + KINDS[k].color + ')"/>';
        acc += d[k];
      });
      g += '</g>';
      if (i === peak && totals[i] > 0) g += '<text class="val-label" x="' + cx + '" y="' + (y(totals[i]) - 7) + '" text-anchor="middle">' + moneyShort(totals[i]) + '</text>';
      g += '<text class="' + (isToday ? 'today-label' : '') + '" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + DAY_SHORT[i] + (isToday ? ' ·' : '') + '</text>';
    });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gastos por día de la semana">' + g + '</svg>';
    bindTips(el, (i) => {
      const d = s.days[i];
      let h = '<h4>' + DAY_SHORT[i] + ' ' + fmtShortDate(d.date) + '</h4>';
      EXPENSE_KINDS.forEach((k) => (h += tipRow(KINDS[k].plural, money(d[k]), KINDS[k].color)));
      h += tipRow('Total gastos', money(totals[i]), null, 'total');
      if (d.ingreso) h += tipRow('Ingresos', money(d.ingreso));
      return h;
    });
  }

  function renderSplit(s) {
    const el = $('#splitChart');
    const total = s.gastos;
    let bar = '<div class="split" role="img" aria-label="Reparto de gastos">';
    EXPENSE_KINDS.forEach((k) => { if (s[k] > 0) bar += '<span style="--c:var(' + KINDS[k].color + ');flex-grow:' + s[k] + '"></span>'; });
    bar += '</div><ul class="split-rows">';
    EXPENSE_KINDS.forEach((k) => {
      const pct = total ? (s[k] / total) * 100 : 0;
      bar += '<li><i style="--c:var(' + KINDS[k].color + ')"></i><span>' + KINDS[k].plural + '</span><span class="amt">' + money(s[k]) + '</span><span class="pct">' + pct.toFixed(0) + '%</span></li>';
    });
    bar += '</ul>';
    el.innerHTML = bar;

    // Ant expense insight
    const ants = movementsOfWeek(weekStart).filter((m) => m.kind === 'hormiga');
    const box = $('#antInsight');
    if (!ants.length) {
      box.innerHTML = '<h3>🐜 Gastos hormiga</h3>Aún no registras gastos hormiga esta semana. Anota incluso los más pequeños: el café, la gaseosa, el taxi corto.';
      return;
    }
    const byConcept = {};
    ants.forEach((m) => { const k = m.concept.trim().toLowerCase(); byConcept[k] = byConcept[k] || { name: m.concept.trim(), total: 0, n: 0 }; byConcept[k].total += m.amount; byConcept[k].n++; });
    const top = Object.values(byConcept).sort((a, b) => b.total - a.total).slice(0, 3);
    const yearly = s.hormiga * 52;
    const pctInc = s.ingreso ? ' Equivale al <strong>' + ((s.hormiga / s.ingreso) * 100).toFixed(0) + '%</strong> de tus ingresos.' : '';
    box.innerHTML = '<h3>🐜 Gastos hormiga</h3>Si mantienes este ritmo, al año gastarás <strong>' + money(yearly) + '</strong> en gastos hormiga.' + pctInc +
      '<ol>' + top.map((t) => '<li>' + esc(t.name) + ': <strong>' + money(t.total) + '</strong> <span class="muted">(' + t.n + (t.n === 1 ? ' vez' : ' veces') + ')</span></li>').join('') + '</ol>';
  }

  function renderTrend() {
    const el = $('#trendChart');
    const weeks = [];
    for (let i = 7; i >= 0; i--) { const st = addDays(weekStart, -7 * i); weeks.push({ start: st, s: summarize(st) }); }
    const W = Math.max(300, el.clientWidth || 600), H = 230;
    const m = { t: 22, r: 18, b: 28, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = weeks.map((w) => w.s.ganancia);
    const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
    let maxV = niceMax(hi), minV = lo < 0 ? -niceMax(-lo) : 0;
    if (hi === 0 && lo < 0) maxV = 0;
    const span = maxV - minV || 10;
    const y = (v) => m.t + ((maxV - v) / span) * ih;
    const band = iw / weeks.length, bw = Math.min(34, band * 0.55);

    let g = '';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = minV + (span / ticks) * i, yy = y(v);
      g += '<line class="grid-line" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/>';
      g += '<text x="' + (m.l - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + moneyShort(v) + '</text>';
    }
    g += '<line class="base-line" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
    weeks.forEach((w, i) => {
      const v = w.s.ganancia, cx = m.l + band * i + band / 2, x = cx - bw / 2;
      g += '<g class="col" data-tip="' + i + '"><rect class="col-bg" x="' + (m.l + band * i + 2) + '" y="' + m.t + '" width="' + (band - 4) + '" height="' + ih + '" rx="8"/>';
      if (v > 0) g += '<path d="' + topRounded(x, y(v), bw, y(0) - y(v), 4) + '" fill="var(--s-pos)"/>';
      else if (v < 0) g += '<path d="' + bottomRounded(x, y(0), bw, y(v) - y(0), 4) + '" fill="var(--s-neg)"/>';
      g += '</g>';
      const last = i === weeks.length - 1;
      if (last && v !== 0) g += '<text class="val-label" x="' + cx + '" y="' + (v > 0 ? y(v) - 7 : y(v) + 14) + '" text-anchor="middle">' + moneyShort(v) + '</text>';
      const every = band < 56 ? 2 : 1; // thin labels on narrow screens so they never overlap
      if (last || (weeks.length - 1 - i) % every === 0) g += '<text class="' + (last ? 'today-label' : '') + '" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + w.start.getDate() + ' ' + MONTHS[w.start.getMonth()] + '</text>';
    });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Ganancia de las últimas 8 semanas">' + g + '</svg>';
    bindTips(el, (i) => {
      const w = weeks[i];
      return '<h4>Semana ' + weekLabel(w.start) + '</h4>' + tipRow('Ingresos', money(w.s.ingreso)) + tipRow('Gastos', money(w.s.gastos)) +
        tipRow('Ganancia', money(w.s.ganancia), w.s.ganancia >= 0 ? '--s-pos' : '--s-neg', 'total');
    });
  }

  function renderFixed() {
    const ul = $('#fixedList');
    if (!state.fixed.length) {
      ul.innerHTML = '<li class="empty-li">Aún no defines tus gastos fijos. Pulsa <strong>Editar</strong> para añadir alquiler, luz, internet…</li>';
    } else {
      let total = 0;
      ul.innerHTML = state.fixed.map((f) => {
        const wk = weeklyOf(f); total += wk;
        return '<li><span>' + esc(f.name) + '<span class="freq">' + (f.freq === 'mensual' ? money(f.amount) + '/mes' : 'semanal') + '</span></span><span class="amt">' + money(wk) + '</span></li>';
      }).join('') + '<li class="total"><span>Total por semana</span><span class="amt">' + money(total) + '</span></li>';
    }
    const btn = $('#applyFixed');
    const applied = state.appliedWeeks[iso(weekStart)];
    btn.disabled = !state.fixed.length || !!applied;
    btn.textContent = applied ? '✓ Gastos fijos cargados en esta semana' : 'Cargar gastos fijos a esta semana';
    btn.style.opacity = btn.disabled ? 0.6 : 1;
  }

  function renderTable() {
    const all = movementsOfWeek(weekStart).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const rows = filter === 'all' ? all : all.filter((m) => m.kind === filter);
    $('#movCount').textContent = all.length ? all.length + (all.length === 1 ? ' movimiento' : ' movimientos') + ' registrados' : 'Sin movimientos';
    $('#emptyState').hidden = all.length > 0;
    $('.table-wrap').hidden = all.length === 0;
    $('#movBody').innerHTML = rows.map((m) => {
      const d = parseIso(m.date);
      const k = KINDS[m.kind];
      const tag = m.kind === 'ingreso' ? '<span class="tag"><b>↗</b>Ingreso</span>' : '<span class="tag"><i style="--c:var(' + k.color + ')"></i>' + k.label + '</span>';
      return '<tr><td class="date">' + DAY_SHORT[(d.getDay() + 6) % 7] + ' ' + fmtShortDate(d) + '</td><td class="concept">' + esc(m.concept) + '</td><td class="kind">' + tag + '</td>' +
        '<td class="num' + (m.kind === 'ingreso' ? ' plus' : '') + '">' + (m.kind === 'ingreso' ? '+' : '−') + money(m.amount) + '</td>' +
        '<td class="act"><div class="row-actions"><button data-edit="' + m.id + '" aria-label="Editar">✎</button><button data-del="' + m.id + '" aria-label="Eliminar">🗑</button></div></td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No hay movimientos de este tipo.</td></tr>';
  }

  /* ---------------- Movement modal ---------------- */
  const movModal = $('#movModal');
  const movForm = $('#movForm');

  function openMovement(m, kind) {
    editingId = m ? m.id : null;
    $('#movModalTitle').textContent = m ? 'Editar movimiento' : 'Nuevo movimiento';
    $('#deleteMov').hidden = !m;
    const today = new Date();
    const inWeek = today >= weekStart && today < addDays(weekStart, 7);
    movForm.kind.value = m ? m.kind : (kind || movForm.kind.value || 'hormiga');
    movForm.amount.value = m ? m.amount : '';
    movForm.concept.value = m ? m.concept : '';
    movForm.date.value = m ? m.date : iso(inWeek ? today : weekStart);
    updateHint();
    fillSuggestions();
    $('#quickChips').hidden = !!m;
    if (!m) renderQuickChips();
    movModal.showModal();
    setTimeout(() => movForm.amount.focus(), 30);
  }
  // One-tap shortcuts: the person's most repeated movements of the last 60 days
  function renderQuickChips() {
    const since = iso(addDays(new Date(), -60));
    const seen = {};
    state.movements.filter((m) => m.date >= since && m.kind !== 'fijo').forEach((m) => {
      const key = m.kind + '|' + m.concept.trim().toLowerCase();
      const e = seen[key] || (seen[key] = { kind: m.kind, concept: m.concept.trim(), n: 0, last: '', amount: 0 });
      e.n++;
      if (m.date >= e.last) { e.last = m.date; e.amount = m.amount; }
    });
    const top = Object.values(seen).filter((e) => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, 8);
    $('#quickChips').innerHTML = top.map((e, i) =>
      '<button type="button" data-chip="' + i + '"><i style="--c:' + (e.kind === 'ingreso' ? 'var(--good)' : 'var(' + KINDS[e.kind].color + ')') + '"></i>' + esc(e.concept) + ' <b>' + money(e.amount) + '</b></button>'
    ).join('');
    $('#quickChips').onclick = (ev) => {
      const b = ev.target.closest('[data-chip]');
      if (!b) return;
      const e = top[+b.dataset.chip];
      movForm.kind.value = e.kind;
      movForm.concept.value = e.concept;
      movForm.amount.value = e.amount;
      updateHint(); fillSuggestions();
      movForm.querySelector('[type=submit]').focus();
    };
  }
  function updateHint() { $('#kindHint').textContent = KIND_HINTS[movForm.kind.value] || ''; }
  function fillSuggestions() {
    const kind = movForm.kind.value;
    const counts = {};
    state.movements.filter((m) => m.kind === kind).forEach((m) => (counts[m.concept] = (counts[m.concept] || 0) + 1));
    const defaults = { ingreso: ['Sueldo', 'Ventas', 'Trabajo extra'], fijo: ['Alquiler', 'Luz', 'Agua', 'Internet', 'Celular'], hormiga: ['Café', 'Snacks', 'Taxi', 'Delivery', 'Gaseosa'], compra: ['Supermercado', 'Ropa', 'Farmacia', 'Hogar'] }[kind];
    const list = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).concat(defaults).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);
    $('#conceptSuggestions').innerHTML = list.map((c) => '<option value="' + esc(c) + '">').join('');
  }
  movForm.addEventListener('change', (e) => { if (e.target.name === 'kind') { updateHint(); fillSuggestions(); } });
  movForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = round2(parseFloat(movForm.amount.value));
    const concept = movForm.concept.value.trim();
    if (!(amount > 0) || !concept || !movForm.date.value) return;
    const data = { kind: movForm.kind.value, amount, concept, date: movForm.date.value };
    const wk = mondayOf(parseIso(data.date));
    const before = summarize(wk);
    if (editingId) Object.assign(state.movements.find((m) => m.id === editingId), data);
    else state.movements.push(Object.assign({ id: uid() }, data));
    save();
    movModal.close();
    // jump to the week of the saved movement so it is visible
    weekStart = mondayOf(parseIso(data.date));
    render();
    toast(budgetAlert(before, summarize(wk)) || (editingId ? 'Movimiento actualizado' : 'Movimiento guardado'));
  });
  $('#deleteMov').addEventListener('click', () => {
    if (!editingId) return;
    deleteMovement(editingId);
    movModal.close();
  });
  function deleteMovement(id) {
    const i = state.movements.findIndex((m) => m.id === id);
    if (i < 0) return;
    const removed = state.movements.splice(i, 1)[0];
    save(); render();
    toast('Eliminado: ' + removed.concept);
  }

  /* ---------------- Fixed modal ---------------- */
  const fixedModal = $('#fixedModal');
  function fixedRow(f) {
    const div = document.createElement('div');
    div.className = 'fixed-row';
    if (f.id) div.dataset.id = f.id; // keep ids stable so edits merge across devices
    div.innerHTML = '<input type="text" placeholder="Nombre (ej. Alquiler)" maxlength="40" value="' + esc(f.name || '') + '" aria-label="Nombre">' +
      '<input type="number" placeholder="Monto" step="0.01" min="0" value="' + (f.amount || '') + '" aria-label="Monto">' +
      '<select aria-label="Frecuencia"><option value="mensual"' + (f.freq !== 'semanal' ? ' selected' : '') + '>Mensual</option><option value="semanal"' + (f.freq === 'semanal' ? ' selected' : '') + '>Semanal</option></select>' +
      '<button type="button" aria-label="Quitar">✕</button>';
    div.querySelector('button').addEventListener('click', () => div.remove());
    return div;
  }
  function openFixed() {
    const box = $('#fixedRows');
    box.innerHTML = '';
    (state.fixed.length ? state.fixed : [{}]).forEach((f) => box.appendChild(fixedRow(f)));
    fixedModal.showModal();
  }
  $('#addFixedRow').addEventListener('click', () => { const r = fixedRow({}); $('#fixedRows').appendChild(r); r.querySelector('input').focus(); });
  $('#fixedForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.fixed = $$('.fixed-row', $('#fixedRows')).map((r) => {
      const [n, a] = r.querySelectorAll('input');
      return { id: r.dataset.id || uid(), name: n.value.trim(), amount: round2(parseFloat(a.value)), freq: r.querySelector('select').value };
    }).filter((f) => f.name && f.amount > 0);
    save(); fixedModal.close(); render();
    toast('Gastos fijos guardados');
  });
  function applyFixed() {
    const key = iso(weekStart);
    if (!state.fixed.length || state.appliedWeeks[key]) return;
    state.fixed.forEach((f) => state.movements.push({ id: uid(), kind: 'fijo', amount: round2(weeklyOf(f)), concept: f.name, date: key }));
    state.appliedWeeks[key] = true;
    save(); render();
    toast('Se cargaron ' + state.fixed.length + ' gastos fijos');
  }

  /* ---------------- Import / export ---------------- */
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportCsv() {
    const rows = movementsOfWeek(weekStart).sort((a, b) => (a.date > b.date ? 1 : -1));
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = ['Fecha;Concepto;Tipo;Monto'].concat(rows.map((m) => [m.date, q(m.concept), KINDS[m.kind].label, (m.kind === 'ingreso' ? '' : '-') + m.amount.toFixed(2)].join(';'))).join('\n');
    download('gastos-semana-' + iso(weekStart) + '.csv', '﻿' + csv, 'text/csv;charset=utf-8');
  }
  function exportJson() {
    download('mis-finanzas-' + iso(new Date()) + '.json', JSON.stringify(state, null, 2), 'application/json');
  }
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.movements)) throw new Error('formato');
        state = Object.assign(emptyState(), data);
        save(); render(); toast('Copia restaurada');
      } catch (err) { toast('El archivo no es una copia válida'); }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  /* ---------------- Demo data ---------------- */
  function loadDemo() {
    if (state.movements.length && !confirm('Esto reemplazará tus datos actuales por datos de ejemplo. ¿Continuar?')) return;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const s = emptyState();
    s.currency = state.currency;
    s.fixed = [
      { id: uid(), name: 'Alquiler', amount: 1200, freq: 'mensual' },
      { id: uid(), name: 'Luz y agua', amount: 140, freq: 'mensual' },
      { id: uid(), name: 'Internet', amount: 89.9, freq: 'mensual' },
      { id: uid(), name: 'Plan celular', amount: 49.9, freq: 'mensual' },
      { id: uid(), name: 'Streaming', amount: 44.9, freq: 'mensual' },
      { id: uid(), name: 'Pasajes', amount: 45, freq: 'semanal' },
    ];
    const ants = [['Café', 6, 12], ['Snacks', 3, 8], ['Gaseosa', 3, 6], ['Taxi', 8, 18], ['Delivery', 22, 38], ['Galletas', 2, 5], ['Menú', 12, 18]];
    const buys = [['Supermercado', 110, 220], ['Mercado', 40, 90], ['Farmacia', 20, 60], ['Ropa', 70, 180], ['Artículos de limpieza', 25, 55], ['Audífonos', 90, 150]];
    const today = new Date();
    const thisMonday = mondayOf(today);
    for (let w = 7; w >= 0; w--) {
      const st = addDays(thisMonday, -7 * w);
      const lastDay = w === 0 ? (today.getDay() + 6) % 7 : 6;
      const add = (kind, concept, amount, day) => s.movements.push({ id: uid(), kind, concept, amount: round2(amount), date: iso(addDays(st, Math.min(day, lastDay))) });
      add('ingreso', 'Sueldo', 1150 + Math.round(rnd() * 3) * 50, 4);
      if (rnd() > 0.45) add('ingreso', pick(['Trabajo extra', 'Ventas', 'Freelance']), 80 + rnd() * 260, 5);
      s.fixed.forEach((f) => add('fijo', f.name, weeklyOf(f), 0));
      s.appliedWeeks[iso(st)] = true;
      for (let d = 0; d <= lastDay; d++) {
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) { const a = pick(ants); add('hormiga', a[0], a[1] + rnd() * (a[2] - a[1]), d); }
      }
      add('compra', 'Supermercado', 120 + rnd() * 110, 5);
      if (rnd() > 0.35) { const b = pick(buys.slice(1)); add('compra', b[0], b[1] + rnd() * (b[2] - b[1]), Math.floor(rnd() * 7)); }
    }
    state = s;
    weekStart = thisMonday;
    save(); render();
    toast('Datos de ejemplo cargados');
  }

  /* ---------------- Events ---------------- */
  $('#prevWeek').addEventListener('click', () => { weekStart = addDays(weekStart, -7); render(); });
  $('#nextWeek').addEventListener('click', () => { weekStart = addDays(weekStart, 7); render(); });
  $('#todayWeek').addEventListener('click', () => { weekStart = mondayOf(new Date()); render(); });
  $('#addBtn').addEventListener('click', () => openMovement(null));
  $('#fab').addEventListener('click', () => openMovement(null));
  $('#manageFixed').addEventListener('click', openFixed);
  $('#applyFixed').addEventListener('click', applyFixed);
  $('#currency').addEventListener('change', (e) => { state.currency = e.target.value; save(); render(); });

  $('#filterTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    $$('#filterTabs button').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    renderTable();
  });
  $('#movBody').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) openMovement(state.movements.find((m) => m.id === ed.dataset.edit));
    if (del) deleteMovement(del.dataset.del);
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
    if (e.target.closest('[data-open-add]')) openMovement(null);
    const act = e.target.closest('[data-action]');
    if (act) {
      closeMenu();
      ({
        'export-csv': exportCsv,
        'export-json': exportJson,
        'import-json': () => $('#importFile').click(),
        demo: loadDemo,
        password: () => openAccountModal('#passModal'),
        admin: openAdmin,
        budgets: openBudgets,
        install: promptInstall,
        logout: logout,
        'delete-account': () => openAccountModal('#deleteModal'),
        reset: () => { if (confirm('¿Borrar TODOS tus datos? Esta acción no se puede deshacer.')) { state = Object.assign(emptyState(), { currency: state.currency }); save(); render(); toast('Datos borrados'); } },
      }[act.dataset.action] || (() => {}))();
    }
    if (!e.target.closest('.menu')) closeMenu();
    if (!e.target.closest('[data-tip]')) hideTip();
  });
  // click on backdrop closes dialogs
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  const menuBtn = $('#menuBtn'), menuPanel = $('#menuPanel');
  function closeMenu() { menuPanel.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuPanel.hidden = !menuPanel.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menuPanel.hidden));
  });

  $('#themeToggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('fs-theme', next); } catch (e) {}
  });

  document.addEventListener('keydown', (e) => {
    if (!user || e.target.matches('input, select, textarea') || $('dialog[open]')) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openMovement(null); }
    if (e.key === 'ArrowLeft') $('#prevWeek').click();
    if (e.key === 'ArrowRight') $('#nextWeek').click();
  });

  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const s = summarize(weekStart); renderDaily(s); renderTrend(); }, 120); });

  /* ---------------- Accounts ---------------- */
  const authView = $('#authView'), appView = $('#appView'), payView = $('#payView');

  function showAuth(tab) {
    document.body.classList.remove('is-loading');
    appView.hidden = true;
    payView.hidden = true;
    authView.hidden = false;
    switchAuthTab(tab || 'login');
  }
  async function enterApp(u) {
    user = u;
    if (!u.access) return showPay(u);
    payView.hidden = true;
    const res = await api('data');
    adopt(res.data, res.rev);
    // Offer to bring over data saved in this browser by the old, account-less version
    if (!res.data) {
      let legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch (e) {}
      if (legacy && Array.isArray(legacy.movements) && legacy.movements.length &&
          confirm('Encontramos ' + legacy.movements.length + ' movimientos guardados en este navegador. ¿Quieres pasarlos a tu cuenta?')) {
        state = Object.assign(emptyState(), legacy);
        save();
        try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
      }
    }
    const name = u.name || u.email;
    $('#adminMenuItem').hidden = !u.admin;
    $('#userName').textContent = name;
    $('#userEmail').textContent = u.email;
    $('#userAvatar').textContent = name.trim().charAt(0).toUpperCase();
    authView.hidden = true;
    appView.hidden = false;
    document.body.classList.remove('is-loading');
    weekStart = mondayOf(new Date());
    render();
    setSync('ok');
    updateVerifyBanner();
  }
  function updateVerifyBanner() {
    $('#verifyBanner').hidden = !user || user.verified !== false;
    $('#verifyEmail').textContent = user ? user.email : '';
  }
  $('#resendVerify').addEventListener('click', async (e) => {
    const b = e.target;
    b.disabled = true;
    try { await api('resend_verify', {}); toast('Te enviamos otro correo de confirmación'); }
    catch (err) { toast(err.message); }
    finally { b.disabled = false; }
  });
  function sessionExpired() {
    user = null;
    toast('Tu sesión terminó. Vuelve a iniciar sesión.');
    showAuth('login');
  }
  async function logout() {
    if (dirty || saving) { clearTimeout(saveTimer); await flush().catch(() => {}); }
    try { await api('logout', {}); } catch (e) {}
    location.reload(); // clears every trace of this person's data from the page
  }

  function switchAuthTab(tab) {
    $$('[role=tab][data-auth-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.authTab === tab ? 'true' : 'false'));
    $('#authTabs').hidden = tab !== 'login' && tab !== 'register';
    const forms = { login: '#loginForm', register: '#registerForm', forgot: '#forgotForm', reset: '#resetForm' };
    Object.entries(forms).forEach(([k, sel]) => ($(sel).hidden = k !== tab));
    $$('.form-error', authView).forEach((x) => (x.hidden = true));
    $('#forgotForm .form-ok').hidden = true;
    $('#forgotForm [type=submit]').hidden = false;
    const f = $(forms[tab]);
    setTimeout(() => { const i = f.querySelector('input'); if (i && innerWidth > 860) i.focus(); }, 30);
  }
  authView.addEventListener('click', (e) => {
    const t = e.target.closest('[data-auth-tab]');
    if (t) switchAuthTab(t.dataset.authTab);
    const pt = e.target.closest('.pass-toggle');
    if (pt) {
      const inp = pt.parentElement.querySelector('input');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      pt.textContent = inp.type === 'password' ? 'Ver' : 'Ocultar';
    }
  });

  function formError(form, msg) {
    const el = form.querySelector('.form-error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  async function submitting(form, fn) {
    const btn = form.querySelector('[type=submit]');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Un momento…';
    formError(form, '');
    try { await fn(); }
    catch (e) { formError(form, e.message); }
    finally { btn.disabled = false; btn.textContent = label; }
  }
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim(), password = f.password.value;
    if (!validEmail(email)) return formError(f, 'Escribe un correo electrónico válido.');
    if (!password) return formError(f, 'Escribe tu contraseña.');
    submitting(f, async () => {
      const res = await api('login', { email, password });
      f.reset();
      await enterApp(res.user);
      toast('¡Hola, ' + (res.user.name || '').split(' ')[0] + '!');
    });
  });

  $('#registerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim(), email = f.email.value.trim(), password = f.password.value;
    if (name.length < 2) return formError(f, 'Escribe tu nombre.');
    if (!validEmail(email)) return formError(f, 'Escribe un correo electrónico válido.');
    if (password.length < 8) return formError(f, 'La contraseña debe tener al menos 8 caracteres.');
    if (password !== f.password2.value) return formError(f, 'Las contraseñas no coinciden.');
    submitting(f, async () => {
      const res = await api('register', { name, email, password, invite: f.invite.value.trim() });
      f.reset();
      await enterApp(res.user);
      toast('¡Cuenta creada! Bienvenido, ' + name.split(' ')[0]);
    });
  });

  // password strength meter
  $('#registerForm').password.addEventListener('input', (e) => {
    const v = e.target.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
    $('.strength', e.target.form).dataset.score = v ? Math.max(1, score) : 0;
  });

  $('#forgotForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    if (!validEmail(email)) return formError(f, 'Escribe un correo electrónico válido.');
    submitting(f, async () => {
      await api('forgot', { email });
      f.querySelector('.form-ok').hidden = false;
      f.querySelector('[type=submit]').hidden = true;
    });
  });

  let resetToken = '';
  $('#resetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value.length < 8) return formError(f, 'La contraseña debe tener al menos 8 caracteres.');
    if (f.password.value !== f.password2.value) return formError(f, 'Las contraseñas no coinciden.');
    submitting(f, async () => {
      const res = await api('reset', { token: resetToken, password: f.password.value });
      f.reset();
      await enterApp(res.user);
      toast('Contraseña cambiada. ¡Bienvenido de nuevo!');
    });
  });

  function openAccountModal(sel) {
    const d = $(sel);
    d.querySelector('form').reset();
    formError(d.querySelector('form'), '');
    d.showModal();
  }
  $('#passForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.new.value.length < 8) return formError(f, 'La nueva contraseña debe tener al menos 8 caracteres.');
    if (f.new.value !== f.new2.value) return formError(f, 'Las contraseñas no coinciden.');
    submitting(f, async () => {
      await api('password', { current: f.current.value, new: f.new.value });
      $('#passModal').close();
      toast('Contraseña actualizada');
    });
  });
  $('#deleteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    submitting(f, async () => {
      clearTimeout(saveTimer); dirty = false;
      await api('delete_account', { password: f.password.value });
      location.reload();
    });
  });

  /* ---------------- One-time payment (Yape / Plin) ---------------- */
  let payMethod = null, payPoll = null;
  const soles = (n) => 'S/ ' + Number(n).toFixed(Number.isInteger(+n) ? 0 : 2);

  function showPay(u) {
    document.body.classList.remove('is-loading');
    authView.hidden = true;
    appView.hidden = true;
    payView.hidden = false;
    const pay = u.pay || {};
    $$('[data-price]', payView).forEach((el) => (el.textContent = soles(pay.price || 10)));
    $('#payEmail').textContent = u.email;
    $('#payHello').textContent = 'Hola ' + (u.name || '').split(' ')[0] + ', haz el pago desde tu celular y luego envíanos el número de operación.';
    const methods = ['yape', 'plin'].filter((m) => pay[m]);
    $('#payUnavailable').hidden = methods.length > 0;
    if (!methods.includes(payMethod)) payMethod = methods[0] || null;
    $('#payTabs').hidden = methods.length < 2;
    $('#payTabs').innerHTML = methods.map((m) => '<button type="button" role="tab" data-pay-method="' + m + '" aria-selected="' + (m === payMethod) + '">' + (m === 'yape' ? 'Yape' : 'Plin') + '</button>').join('');
    renderPayBox(pay);

    const p = u.payment;
    const pending = p && p.status === 'pending';
    $('#payForm').hidden = pending || !methods.length;
    $('#payPending').hidden = !pending;
    $('#payRejected').hidden = !(p && p.status === 'rejected');
    if (p && p.status === 'rejected') $('#payRejected').textContent = 'No pudimos confirmar tu pago anterior' + (p.note ? ': ' + p.note : '') + '. Revisa los datos y envíalo de nuevo.';
    $('.stepper .current span', payView).textContent = pending ? '⏳' : '2';
    if (pending) {
      $('#payPendingText').textContent = 'Revisamos cada pago a mano, normalmente en menos de ' + (pay.reviewHours || 12) + ' horas. Te avisaremos por correo cuando tu cuenta esté activa.';
      $('#paySummary').innerHTML = '<dt>Medio</dt><dd>' + (p.method === 'yape' ? 'Yape' : 'Plin') + '</dd><dt>N.º de operación</dt><dd>' + esc(p.operation) + '</dd><dt>Monto</dt><dd>' + soles(pay.price || 10) + '</dd>';
    }
    clearInterval(payPoll);
    if (pending) payPoll = setInterval(checkPaid, 30000);
  }
  function renderPayBox(pay) {
    const m = payMethod && pay[payMethod];
    if (!m) { $('#payBox').innerHTML = ''; return; }
    const name = payMethod === 'yape' ? 'Yape' : 'Plin';
    $('#payBox').innerHTML =
      (m.qr ? '<img src="' + esc(m.qr) + '" alt="Código QR de ' + name + '">' : '') +
      '<span class="amount">Envía ' + soles(pay.price || 10) + ' por ' + name + ' al número</span>' +
      '<div class="pay-number"><strong>' + esc(m.number) + '</strong><button type="button" class="btn btn--ghost btn--sm" data-copy="' + esc(m.number.replace(/\s/g, '')) + '">Copiar</button></div>' +
      (m.holder ? '<span class="holder">A nombre de <strong>' + esc(m.holder) + '</strong></span>' : '') +
      '<ol class="pay-steps"><li>Abre ' + name + ' y ' + (m.qr ? 'escanea el QR o ' : '') + 'escribe el número.</li><li>Envía exactamente ' + soles(pay.price || 10) + '.</li><li>Copia el <strong>número de operación</strong> del comprobante y pégalo abajo.</li></ol>';
  }
  async function checkPaid() {
    if (payView.hidden) return clearInterval(payPoll);
    try {
      const me = await api('me');
      if (!me.user) { clearInterval(payPoll); return showAuth('login'); }
      if (me.user.access) {
        clearInterval(payPoll);
        await enterApp(me.user);
        toast('🎉 ¡Tu cuenta está activa! Bienvenido');
      } else if (me.user.payment && me.user.payment.status !== 'pending') showPay(me.user);
      return me.user;
    } catch (e) { return null; }
  }
  payView.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-pay-method]');
    if (t) { payMethod = t.dataset.payMethod; showPay(user); }
    const c = e.target.closest('[data-copy]');
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = '¡Copiado!'; setTimeout(() => (c.textContent = 'Copiar'), 1500); } catch (err) {}
    }
  });
  $('#payForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const operation = f.operation.value.replace(/\D/g, ''), payer = f.payer.value.trim();
    if (operation.length < 4) return formError(f, 'Escribe el número de operación que aparece en tu comprobante.');
    if (payer.length < 2) return formError(f, 'Escribe el nombre de quien hizo el pago.');
    submitting(f, async () => {
      const res = await api('pay', { method: payMethod, operation, payer });
      user = res.user;
      f.reset();
      if (res.user.access) await enterApp(res.user); else showPay(res.user);
    });
  });
  $('#payRefresh').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const u = await checkPaid();
    e.target.disabled = false;
    if (u && !u.access) toast('Aún estamos revisando tu pago. Te avisaremos por correo.');
  });
  $('#payEdit').addEventListener('click', () => {
    $('#payPending').hidden = true;
    $('#payForm').hidden = false;
    $('#payForm').operation.focus();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !payView.hidden) checkPaid(); });

  /* ---------------- Admin panel ---------------- */
  const adminModal = $('#adminModal');
  const fmtDate = (ts) => new Date(ts * 1000).toLocaleString('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  async function openAdmin() {
    if (!adminModal.open) adminModal.showModal();
    $('#adminPending').innerHTML = '<p class="muted">Cargando…</p>';
    try {
      const r = await api('admin_payments');
      $('#adminStats').innerHTML =
        '<div><small>Cuentas</small><strong>' + r.stats.users + '</strong></div>' +
        '<div><small>Activas (pagaron)</small><strong>' + r.stats.paid + '</strong></div>' +
        '<div><small>Recaudado aprox.</small><strong>' + soles(r.stats.paid * r.stats.price) + '</strong></div>';
      $('#adminPending').innerHTML = r.pending.length ? r.pending.map((p) =>
        '<div class="admin-item"><div class="who"><strong>' + esc(p.name) + '</strong><small>' + esc(p.email) + ' · ' + fmtDate(p.created_at) + '</small></div>' +
        '<div class="op">' + (p.method === 'yape' ? 'Yape' : 'Plin') + ' · ' + soles(p.amount) + ' · pagó <b>' + esc(p.payer) + '</b> · operación <b>' + esc(p.operation) + '</b></div>' +
        '<div class="actions"><button class="btn btn--primary btn--sm" data-review="' + p.id + '" data-approve="1">Aprobar</button><button class="btn btn--ghost btn--sm" data-review="' + p.id + '">Rechazar</button></div></div>'
      ).join('') : '<p class="notice">✓ No hay pagos pendientes.</p>';
      $('#adminRecent').innerHTML = r.recent.length ? r.recent.map((p) =>
        '<div class="admin-item"><div class="who"><strong>' + esc(p.name) + '</strong><small>' + esc(p.email) + ' · op. ' + esc(p.operation) + (p.note ? ' · ' + esc(p.note) : '') + '</small></div>' +
        '<span class="status status--' + p.status + '">' + (p.status === 'approved' ? '✓ Aprobado' : '✕ Rechazado') + '</span></div>'
      ).join('') : '<p class="muted">Todavía no hay pagos revisados.</p>';
    } catch (e) {
      $('#adminPending').innerHTML = '<p class="notice notice--bad">' + esc(e.message) + '</p>';
    }
  }
  adminModal.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-review]');
    if (!b) return;
    const approve = !!b.dataset.approve;
    let note = '';
    if (!approve) {
      note = prompt('¿Por qué rechazas este pago? (la persona verá este mensaje)', 'No encontramos el pago con ese número de operación');
      if (note === null) return;
    } else if (!confirm('¿Confirmas que el pago llegó a tu Yape/Plin?')) return;
    b.disabled = true;
    try { await api('admin_review', { id: +b.dataset.review, approve, note }); toast(approve ? 'Cuenta activada' : 'Pago rechazado'); }
    catch (err) { toast(err.message); }
    openAdmin();
  });
  $('#grantForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    const err = f.parentElement.querySelector('.form-error');
    err.hidden = true;
    if (!validEmail(email)) { err.textContent = 'Escribe un correo válido.'; err.hidden = false; return; }
    api('admin_grant', { email }).then(() => { f.reset(); toast('Cuenta activada: ' + email); openAdmin(); })
      .catch((x) => { err.textContent = x.message; err.hidden = false; });
  });

  /* ---------------- Installable app (PWA) ---------------- */
  let installEvent = null;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    $('#installMenuItem').hidden = false;
  });
  addEventListener('appinstalled', () => { $('#installMenuItem').hidden = true; toast('¡App instalada!'); });
  if (isIos && !standalone) $('#installMenuItem').hidden = false;
  async function promptInstall() {
    if (installEvent) {
      installEvent.prompt();
      await installEvent.userChoice.catch(() => {});
      installEvent = null;
      $('#installMenuItem').hidden = true;
    } else $('#installModal').showModal();
  }

  async function boot() {
    // Links from emails: ?reset=… (new password) and ?verify=… (confirm email)
    const params = new URLSearchParams(location.search);
    const verifyToken = params.get('verify');
    resetToken = params.get('reset') || '';
    if (verifyToken || resetToken || params.get('admin') || params.get('quick')) history.replaceState(null, '', location.pathname); // keep tokens out of history
    try {
      let verifyMsg = '';
      if (verifyToken) {
        try { await api('verify', { token: verifyToken }); verifyMsg = '✓ ¡Correo confirmado!'; }
        catch (e) { verifyMsg = e.message; }
      }
      const me = await api('me');
      $('#inviteField').hidden = !me.inviteRequired;
      if (resetToken) showAuth('reset');
      else if (me.user) {
        await enterApp(me.user);
        if (params.get('admin') && me.user.admin) openAdmin();
        const quick = params.get('quick'); // app shortcut: open the quick-add sheet
        if (quick && me.user.access && KINDS[quick]) openMovement(null, quick);
      } else showAuth('login');
      if (verifyMsg) toast(verifyMsg);
    } catch (e) {
      showAuth('login');
      formError($('#loginForm'), e.message);
    }
  }
  boot();
})();
