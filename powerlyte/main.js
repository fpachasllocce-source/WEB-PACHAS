/* =========================================================================
   POWERLYTE — main.js (vanilla, sin dependencias)
   ========================================================================= */
(() => {
  'use strict';

  /* -----------------------------------------------------------------------
     DATOS DE PRODUCTO — editar aquí.
     IMPORTANTE: los valores nutricionales son REFERENCIALES de maqueta.
     Reemplazar con la ficha técnica / rotulado oficial antes de publicar.
     `img`: ruta a la foto PNG transparente de cada botella (vacío = placeholder SVG).
     ----------------------------------------------------------------------- */
  const FLAVORS = [
    { id: 'fresa',    name: 'Fresa',             color: '#ff3b5c', color2: '#ffb1bf', img: '',
      desc: 'Dulzor suave de fresa madura, fresca y ligera. La favorita para después del entreno.' },
    { id: 'uva',      name: 'Uva',               color: '#8b5cf6', color2: '#d6c8ff', img: '',
      desc: 'Uva intensa con final limpio. Sabor clásico de hidratación, sin empalagar.' },
    { id: 'arandano', name: 'Arándano',          color: '#2f6bff', color2: '#a9c4ff', img: '',
      desc: 'Arándano con un toque ácido que refresca. Ideal para sesiones largas y días de calor.' },
    { id: 'tropical', name: 'Frutas tropicales', color: '#ff9f1c', color2: '#ffe08a', img: '',
      desc: 'Mezcla tropical luminosa, con carácter. Para cuando el sol aprieta.' },
  ];

  const SIZES = [
    { id: '500',  ml: 500,  label: '500 ml' },   // TODO confirmar formato comercial en Perú (475 / 500 ml)
    { id: '1000', ml: 1000, label: '1 L' },
  ];

  // Valores por 100 ml (referenciales). Se pueden sobrescribir por sabor con FLAVOR_OVERRIDES.
  const NUTRITION_100 = {
    energia:   { name: 'Energía',            unit: 'kcal', v: 10,  vd: 2000, key: true,  color: '#0a1224' },
    grasas:    { name: 'Grasas totales',     unit: 'g',    v: 0 },
    carbos:    { name: 'Carbohidratos',      unit: 'g',    v: 2.5 },
    azucares:  { name: 'Azúcares',           unit: 'g',    v: 2.5, vd: 50,   key: true, sub: true, color: 'var(--acc)',
                 hint: 'La OMS recomienda menos de 50 g de azúcares libres al día.' },
    proteinas: { name: 'Proteínas',          unit: 'g',    v: 0 },
    sodio:     { name: 'Sodio',              unit: 'mg',   v: 92,  vd: 2300, key: true,  color: '#0891b2', tag: 'Na⁺' },
    potasio:   { name: 'Potasio',            unit: 'mg',   v: 78,  vd: 3500, key: true,  color: '#d4a106', tag: 'K⁺' },
    cloruro:   { name: 'Cloruro',            unit: 'mg',   v: 120, tag: 'Cl⁻' },
    zinc:      { name: 'Zinc',               unit: 'mg',   v: 0.5, vd: 11,   color: '#e11d48', tag: 'Zn²⁺' },
  };
  const FLAVOR_OVERRIDES = { /* ej.: tropical: { azucares: 2.6, energia: 11 } */ };

  /* ----------------------------------------------------------------------- */
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const root = document.documentElement;

  /* ---------- Loader ---------- */
  const loaderNum = $('[data-loader-num]');
  const loaderFill = $('.loader__fill');
  let loadP = 0, pageLoaded = false;
  addEventListener('load', () => { pageLoaded = true; });
  setTimeout(() => { pageLoaded = true; }, 3500); // salvaguarda
  (function tickLoader() {
    const target = pageLoaded ? 100 : 86;
    loadP = Math.min(target, loadP + (reduced ? 100 : pageLoaded ? 3.2 : 1.4));
    loaderNum.textContent = Math.round(loadP);
    loaderFill.setAttribute('y', 80 - (loadP / 100) * 80);
    if (loadP >= 100) return setTimeout(finishLoading, 250);
    requestAnimationFrame(tickLoader);
  })();
  function finishLoading() {
    document.body.classList.remove('is-loading');
    setTimeout(() => $$('.hero [data-split]').forEach(el => el.classList.add('is-in')), 350);
  }

  /* ---------- Split text ---------- */
  $$('[data-split]').forEach((el, li) => {
    const txt = el.textContent;
    el.textContent = '';
    [...txt].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'split-char';
      s.style.setProperty('--i', i);
      s.style.setProperty('--d', `${li * 180}ms`);
      s.textContent = ch === ' ' ? ' ' : ch;
      el.appendChild(s);
    });
  });
  $$('[data-split-lines]').forEach(el => {
    el.innerHTML = el.innerHTML.split(/<br\s*\/?>/i)
      .map((l, i) => `<span class="split-line" style="--i:${i}"><span>${l.trim()}</span></span>`).join('');
  });

  // Manifiesto: palabra por palabra
  const manif = $('[data-words]');
  manif.innerHTML = manif.textContent.trim().split(/\s+/).map(w => `<span class="w">${w}</span>`).join(' ');
  const manifWords = $$('.w', manif);

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      if (e.target.dataset.count !== undefined) countUp(e.target);
      io.unobserve(e.target);
    });
  }, { threshold: .18, rootMargin: '0px 0px -8% 0px' });
  $$('.reveal, [data-split-lines], [data-count]').forEach(el => io.observe(el));
  // escalonar revelados en grupo
  $$('.ions, .manifesto__stats, .facts').forEach(g => $$('.reveal', g).forEach((el, i) => el.style.transitionDelay = `${i * 90}ms`));

  function countUp(el) {
    const end = parseFloat(el.dataset.count), dec = +(el.dataset.decimals || 0);
    if (reduced || end === 0) { el.textContent = end.toFixed(dec); return; }
    const t0 = performance.now(), dur = 1600;
    (function step(t) {
      const p = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 4);
      el.textContent = (end * e).toFixed(dec);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------- Nav ---------- */
  const nav = $('[data-nav]');
  let lastY = scrollY;
  const navLinks = $$('.nav__links a');
  const secIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      navLinks.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('[data-section]').forEach(s => secIO.observe(s));

  const burger = $('[data-burger]'), menu = $('[data-menu]');
  const toggleMenu = open => {
    burger.setAttribute('aria-expanded', open);
    menu.classList.toggle('is-open', open);
    menu.setAttribute('aria-hidden', !open);
    document.body.style.overflow = open ? 'hidden' : '';
  };
  burger.addEventListener('click', () => toggleMenu(burger.getAttribute('aria-expanded') !== 'true'));
  $$('a', menu).forEach(a => a.addEventListener('click', () => toggleMenu(false)));

  /* ---------- Cursor ---------- */
  const cursor = $('.cursor'), cDot = $('.cursor__dot'), cRing = $('.cursor__ring'), cLabel = $('.cursor__label');
  const mouse = { x: innerWidth / 2, y: innerHeight / 2 }, ring = { ...mouse };
  addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  if (finePointer) {
    document.addEventListener('pointerover', e => {
      const t = e.target.closest('a, button, label, [data-cursor], input');
      const lab = t && t.dataset.cursor;
      cursor.classList.toggle('is-hover', !!t && !lab);
      cursor.classList.toggle('is-label', !!lab);
      if (lab) cLabel.textContent = lab;
    });
  }

  /* ---------- Magnetic ---------- */
  if (finePointer && !reduced) {
    $$('.magnetic').forEach(el => {
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .25}px, ${(e.clientY - r.top - r.height / 2) * .35}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ---------- Hero bubbles (canvas) ---------- */
  const cvs = $('[data-bubbles]'), ctx = cvs.getContext('2d');
  let bubbles = [], heroVisible = true, dpr = Math.min(devicePixelRatio || 1, 2);
  function sizeCanvas() {
    cvs.width = cvs.offsetWidth * dpr; cvs.height = cvs.offsetHeight * dpr;
    const n = Math.round(cvs.offsetWidth / (innerWidth < 700 ? 22 : 14));
    bubbles = Array.from({ length: n }, () => newBubble(true));
  }
  function newBubble(anyY) {
    return { x: Math.random() * cvs.width, y: anyY ? Math.random() * cvs.height : cvs.height + 20,
      r: (Math.random() * 3 + .6) * dpr, s: (Math.random() * .6 + .2) * dpr, w: Math.random() * Math.PI * 2, a: Math.random() * .5 + .15 };
  }
  function drawBubbles() {
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    for (const b of bubbles) {
      b.y -= b.s; b.w += .02; const x = b.x + Math.sin(b.w) * 6 * dpr;
      if (b.y < -20) Object.assign(b, newBubble(false));
      ctx.beginPath(); ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(124,245,255,${b.a})`; ctx.lineWidth = dpr * .8; ctx.stroke();
    }
  }
  new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; }).observe($('[data-hero]'));

  /* ---------- Flavor lab ---------- */
  const state = { flavor: FLAVORS[0], size: SIZES[1], basis: 'bottle' };
  const chipsWrap = $('[data-flavor-chips]'), segWrap = $('[data-size-seg]'), rowsWrap = $('[data-nrows]');
  const labBottle = $('[data-lab-bottle]'), bigName = $('[data-flavor-big]');

  chipsWrap.innerHTML = FLAVORS.map((f, i) =>
    `<button class="chip" role="radio" aria-checked="${i === 0}" data-flavor="${f.id}" style="--c:${f.color}"><i></i>${f.name}</button>`).join('');
  segWrap.innerHTML = SIZES.map(s =>
    `<button role="radio" aria-checked="${s === state.size}" data-size="${s.id}">${s.label}</button>`).join('');
  rowsWrap.innerHTML = Object.entries(NUTRITION_100).map(([k, n]) => `
    <div class="nrow${n.key ? ' nrow--key' : ''}${n.sub ? ' nrow--sub' : ''}" data-row="${k}">
      <span class="nrow__name">${n.name}${n.tag ? `<small>${n.tag}</small>` : ''}</span>
      <span class="nrow__val" data-val>—</span>
      ${n.vd ? `<span class="nrow__bar" style="--rc:${n.color}"><i></i></span><span class="nrow__hint" data-hint></span>` : ''}
    </div>`).join('');

  $('[data-lineup]').innerHTML = FLAVORS.map(f => `
    <button class="lcard" data-lineup-flavor="${f.id}" style="--c:${f.color}" data-cursor="Ver tabla">
      <span class="lcard__name">${f.name}</span>
      <span class="ph"><span class="mono">IMG · ${f.name} · botella + fruta</span></span>
      <span class="lcard__foot mono"><span>${SIZES.map(s => s.label).join(' · ')}</span><i class="arrow"></i></span>
    </button>`).join('');

  const fmt = (v, unit) => {
    const d = v === 0 ? 0 : v < 10 ? 1 : 0;
    return `${v.toFixed(d).replace(/\.0$/, '')} ${unit}`;
  };

  function renderNutrition() {
    const ml = state.basis === 'bottle' ? state.size.ml : 100;
    const ov = FLAVOR_OVERRIDES[state.flavor.id] || {};
    $('[data-serving]').textContent = state.basis === 'bottle' ? `1 botella (${state.size.ml} ml)` : '100 ml';
    Object.entries(NUTRITION_100).forEach(([k, n]) => {
      const row = $(`[data-row="${k}"]`, rowsWrap);
      const val = (ov[k] ?? n.v) * ml / 100;
      $('[data-val]', row).textContent = fmt(val, n.unit);
      if (n.vd) {
        const pct = val / n.vd * 100;
        $('.nrow__bar i', row).style.width = clamp(pct, 1.5, 100) + '%';
        $('[data-hint]', row).textContent = `${pct < 1 ? '<1' : Math.round(pct)}% del valor diario de referencia${n.hint ? ' · ' + n.hint : ''}`;
      }
    });
  }

  function applyTheme(f) {
    root.style.setProperty('--acc', f.color);
    root.style.setProperty('--acc-2', f.color2);
    $$('[data-bottle-flavor]').forEach(t => t.textContent = f.name.toUpperCase().replace('FRUTAS ', ''));
  }

  function setFlavor(id, animate = true) {
    const f = FLAVORS.find(x => x.id === id);
    if (!f || f === state.flavor && animate) return;
    state.flavor = f;
    $$('.chip', chipsWrap).forEach(c => c.setAttribute('aria-checked', c.dataset.flavor === id));
    const swap = () => {
      applyTheme(f);
      bigName.textContent = f.name.toUpperCase();
      $('[data-flavor-desc]').textContent = f.desc;
      $('[data-ph-tag]').textContent = `IMG · ${f.name} ${state.size.label} · PNG 800×1800`;
      renderNutrition();
    };
    if (!animate || reduced) return swap();
    labBottle.classList.add('is-swap'); bigName.classList.add('is-out');
    setTimeout(() => { swap(); labBottle.classList.remove('is-swap'); bigName.classList.remove('is-out'); }, 380);
  }

  chipsWrap.addEventListener('click', e => { const b = e.target.closest('[data-flavor]'); if (b) setFlavor(b.dataset.flavor); });
  segWrap.addEventListener('click', e => {
    const b = e.target.closest('[data-size]'); if (!b) return;
    state.size = SIZES.find(s => s.id === b.dataset.size);
    $$('button', segWrap).forEach(x => x.setAttribute('aria-checked', x === b));
    $('[data-size-label]').textContent = state.size.label;
    labBottle.classList.toggle('is-small', state.size.ml < 1000);
    $('[data-ph-tag]').textContent = `IMG · ${state.flavor.name} ${state.size.label} · PNG 800×1800`;
    renderNutrition();
  });
  $$('[data-basis]').forEach(b => b.addEventListener('click', () => {
    state.basis = b.dataset.basis;
    $$('[data-basis]').forEach(x => x.setAttribute('aria-checked', x === b));
    renderNutrition();
  }));
  $('[data-lineup]').addEventListener('click', e => {
    const c = e.target.closest('[data-lineup-flavor]'); if (!c) return;
    setFlavor(c.dataset.lineupFlavor);
    $('.lab').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  });
  // Flechas para navegar sabores (accesibilidad de radiogroup)
  chipsWrap.addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const i = FLAVORS.indexOf(state.flavor), n = FLAVORS.length;
    const next = FLAVORS[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
    setFlavor(next.id); $(`[data-flavor="${next.id}"]`).focus();
  });
  setFlavor(FLAVORS[0].id, false);

  /* ---------- Scroll horizontal (¿Cuándo?) ---------- */
  const hs = $('[data-hscroll]'), track = $('[data-htrack]'), hprog = $('[data-hprogress]');
  let hDist = 0;
  function sizeH() {
    hDist = Math.max(0, track.scrollWidth - innerWidth);
    hs.style.height = (hDist + innerHeight) + 'px';
  }
  function updateH() {
    const top = hs.getBoundingClientRect().top;
    const p = hDist ? clamp(-top / hDist, 0, 1) : 0;
    track.style.transform = `translate3d(${-p * hDist}px,0,0)`;
    hprog.style.width = p * 100 + '%';
  }

  /* ---------- Calculadora ---------- */
  const calc = $('[data-calc]'), gauge = $('[data-gauge]');
  function paintRange(r) { r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); }
  function runCalc() {
    const fd = new FormData(calc);
    const peso = +fd.get('peso'), min = +fd.get('min'), int = +fd.get('int'), clima = +fd.get('clima');
    $('[data-out="peso"]').textContent = `${peso} kg`;
    $('[data-out="min"]').textContent = min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) + ' min' : ''}` : `${min} min`;
    const loss = int * clima * (peso / 70) * (min / 60);             // litros de sudor estimados
    const before = Math.round(peso * 6 / 10) * 10;                   // 5–7 ml/kg
    const during = min >= 45 ? Math.round(loss * 600 / 10) * 10 : 0; // reponer ~60 % durante
    const after = Math.round((loss - during / 1000) * 1500 / 10) * 10; // 150 % del déficit restante
    $('[data-res="loss"]').textContent = loss.toFixed(1);
    $('[data-res="before"]').textContent = `${before} ml`;
    $('[data-res="during"]').textContent = during ? `${during} ml` : 'Opcional';
    $('[data-res="after"]').textContent = `${Math.max(after, 250)} ml`;
    gauge.style.strokeDashoffset = 540 - 540 * clamp(loss / 3, .03, 1);
    $$('input[type=range]', calc).forEach(paintRange);
  }
  calc.addEventListener('input', runCalc);
  runCalc();

  /* ---------- Absorción (partículas) ---------- */
  const absorb = $('[data-absorb]');
  let absorbOn = false, parts = [];
  (function buildParticles() {
    const spec = [['na', 10, 12], ['gl', 6, 12], ['h2o', 22, 7]];
    spec.forEach(([type, n, size]) => {
      for (let i = 0; i < n; i++) {
        const el = document.createElement('span');
        el.className = `pt pt--${type}`;
        el.style.width = el.style.height = size + 'px';
        absorb.appendChild(el);
        parts.push({ el, type, x: Math.random(), y: Math.random(), v: .0012 + Math.random() * .0016,
          lag: type === 'h2o' ? .06 + Math.random() * .12 : 0, ph: Math.random() * 6.28 });
      }
    });
  })();
  new IntersectionObserver(([e]) => { absorbOn = e.isIntersecting; }).observe(absorb);
  let absorbT = 0;
  function drawAbsorb() {
    absorbT += 1;
    const w = absorb.offsetWidth, h = absorb.offsetHeight;
    for (const p of parts) {
      // el agua va un poco "detrás" del sodio: más lenta al cruzar la membrana
      const speed = p.type === 'h2o' ? p.v * .8 : p.v;
      p.y += speed;
      if (p.y > 1.05) { p.y = -.05; p.x = Math.random(); }
      const nearMem = Math.abs(p.y - .5) < .06;
      const wob = Math.sin(absorbT * .03 + p.ph) * (nearMem ? 2 : 8);
      p.el.style.transform = `translate(${p.x * (w - 14) + wob}px, ${p.y * h}px)`;
      p.el.style.opacity = p.y < 0 || p.y > 1 ? 0 : 1;
    }
  }

  /* ---------- Events: imagen flotante ---------- */
  const float = $('.events__float'), floatLabel = $('[data-float-label]');
  const fpos = { x: 0, y: 0 };
  $$('[data-events] li').forEach(li => {
    li.addEventListener('pointerenter', () => { float.classList.add('is-on'); floatLabel.textContent = `IMG · ${li.dataset.img}`; });
    li.addEventListener('pointerleave', () => float.classList.remove('is-on'));
  });

  /* ---------- Ajuste del titular al ancho disponible ---------- */
  const heroTitle = $('.hero__title');
  function fitTitle() {
    heroTitle.style.fontSize = '';
    const hs0 = getComputedStyle(heroTitle.parentElement);
    const avail = heroTitle.parentElement.clientWidth - parseFloat(hs0.paddingLeft) - parseFloat(hs0.paddingRight);
    const widest = Math.max(...$$('.word', heroTitle).map(w => w.scrollWidth));
    if (widest > avail) {
      const fs = parseFloat(getComputedStyle(heroTitle).fontSize);
      heroTitle.style.fontSize = (fs * avail / widest * .98) + 'px';
    }
  }

  /* ---------- Parallax ---------- */
  const parallaxEls = $$('[data-parallax]');

  /* ---------- Loop principal ---------- */
  function onScrollFrame() {
    const y = scrollY;
    nav.classList.toggle('is-scrolled', y > 40);
    if (!menu.classList.contains('is-open')) nav.classList.toggle('is-hidden', y > lastY && y > 400);
    lastY = y;

    // manifiesto: ilumina palabras según avance
    const r = manif.getBoundingClientRect();
    const p = clamp((innerHeight * .85 - r.top) / (r.height + innerHeight * .35), 0, 1);
    const lit = Math.floor(p * manifWords.length);
    manifWords.forEach((w, i) => w.classList.toggle('is-lit', i < lit));

    if (!reduced) parallaxEls.forEach(el => { el.style.translate = `0 ${y * parseFloat(el.dataset.parallax)}px`; });
    updateH();
  }

  function loop() {
    if (finePointer) {
      ring.x = lerp(ring.x, mouse.x, .16); ring.y = lerp(ring.y, mouse.y, .16);
      cDot.style.transform = `translate(${mouse.x}px,${mouse.y}px) translate(-50%,-50%)`;
      cRing.style.transform = `translate(${ring.x}px,${ring.y}px) translate(-50%,-50%)`;
      fpos.x = lerp(fpos.x, mouse.x, .12); fpos.y = lerp(fpos.y, mouse.y, .12);
      float.style.transform = `translate(${fpos.x + 24}px, ${fpos.y - 160}px) rotate(${clamp((mouse.x - fpos.x) * .1, -10, 10)}deg)`;
    }
    if (heroVisible && !reduced) drawBubbles();
    if (absorbOn && !reduced) drawAbsorb();
    requestAnimationFrame(loop);
  }

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { onScrollFrame(); ticking = false; });
  }, { passive: true });

  let rT;
  addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { fitTitle(); sizeCanvas(); sizeH(); onScrollFrame(); }, 120); });

  fitTitle(); sizeCanvas(); sizeH(); onScrollFrame();
  if (reduced) drawAbsorb();
  requestAnimationFrame(loop);
  const refit = () => { fitTitle(); sizeH(); updateH(); };
  addEventListener('load', refit);
  if (document.fonts) { document.fonts.ready.then(refit); document.fonts.addEventListener('loadingdone', refit); }

  $('[data-year]').textContent = new Date().getFullYear();
})();
