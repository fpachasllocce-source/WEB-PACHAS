/* ==========================================================================
   Mis Finanzas semanales — lógica de la app (sin dependencias)
   Datos guardados en localStorage del navegador.
   ========================================================================== */
(function () {
  'use strict';

  const STORE_KEY = 'fs-data-v1';
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
  let state = load();
  let weekStart = mondayOf(new Date());
  let filter = 'all';
  let editingId = null;

  function emptyState() {
    return { currency: 'PEN', movements: [], fixed: [], appliedWeeks: {} };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(emptyState(), JSON.parse(raw));
    } catch (e) {}
    return emptyState();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
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
  }

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

  function openMovement(m) {
    editingId = m ? m.id : null;
    $('#movModalTitle').textContent = m ? 'Editar movimiento' : 'Nuevo movimiento';
    $('#deleteMov').hidden = !m;
    const today = new Date();
    const inWeek = today >= weekStart && today < addDays(weekStart, 7);
    movForm.kind.value = m ? m.kind : (movForm.kind.value || 'hormiga');
    movForm.amount.value = m ? m.amount : '';
    movForm.concept.value = m ? m.concept : '';
    movForm.date.value = m ? m.date : iso(inWeek ? today : weekStart);
    updateHint();
    fillSuggestions();
    movModal.showModal();
    setTimeout(() => movForm.amount.focus(), 30);
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
    if (editingId) Object.assign(state.movements.find((m) => m.id === editingId), data);
    else state.movements.push(Object.assign({ id: uid() }, data));
    save();
    movModal.close();
    // jump to the week of the saved movement so it is visible
    weekStart = mondayOf(parseIso(data.date));
    render();
    toast(editingId ? 'Movimiento actualizado' : 'Movimiento guardado');
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
      return { id: uid(), name: n.value.trim(), amount: round2(parseFloat(a.value)), freq: r.querySelector('select').value };
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
    if (e.target.matches('input, select, textarea') || $('dialog[open]')) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openMovement(null); }
    if (e.key === 'ArrowLeft') $('#prevWeek').click();
    if (e.key === 'ArrowRight') $('#nextWeek').click();
  });

  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const s = summarize(weekStart); renderDaily(s); renderTrend(); }, 120); });

  render();
})();
