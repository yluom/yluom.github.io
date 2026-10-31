/*
 * Easter egg « freulere » pour le Paulschou Converter.
 *
 * Après 10 s passées sur la page (onglet visible), la tête de freulere fait un
 * sneak peek de 0,5 s depuis un coin ou un bord aléatoire, disparaît 5 s, puis
 * revient ailleurs. Si la souris survole la tête, elle reste visible tant que
 * le survol dure (sinon elle est quasi impossible à attraper).
 *
 * Clic sur la tête → transmission Iridium, d'un seul tenant :
 *   1. la tête se détache du corps et vole au centre en grandissant pendant
 *      qu'un satellite Iridium entre sur son orbite ; son faisceau balaie la
 *      tête et la change en binaire (les vrais bits de « coucou freulere ») ;
 *   2. les bits montent vers le satellite (uplink), il fait un « Iridium
 *      flare », puis les renvoie par un faisceau dans le champ Binary
 *      (downlink) ; l'app décode le message dans TEXT ;
 *   3. perte du signal, le satellite sort, le message s'efface et l'état
 *      d'origine est restauré à l'identique (valeurs, classes, curseur).
 * Une frappe clavier ou un clic dans un champ interrompt tout et restaure
 * immédiatement.
 *
 * ?egg dans l'URL : première apparition au bout de 1 s (pour tester).
 *
 * Contraintes : rien n'est chargé avant les 10 s, overlay en
 * pointer-events:none (seule la tête est cliquable), animations sur transform
 * / canvas uniquement, aucun accès au code de l'app (on passe par le DOM et
 * ses propres événements "input" / "blur").
 */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);

  const CFG = {
    firstDelay: params.has('egg') ? 1000 : 10000, // temps visible avant la 1re apparition
    peekHold: 500,          // durée du sneak peek
    peekGap: 5000,          // pause entre deux apparitions
    slide: 220,             // durée d'entrée / sortie
    afterEffectGap: 15000,  // pause après l'animation
  };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scriptSrc = document.currentScript && document.currentScript.src;
  const IMG_BASE = scriptSrc ? new URL('img/', scriptSrc).href : 'img/';
  const SRC = {
    peek: IMG_BASE + 'freulere-peek.webp',
    head: IMG_BASE + 'freulere-head.webp',
  };
  // Position du centre de la tête dans l'image du peek (fractions) et taille
  // de l'image « tête seule » rapportée à la largeur du peek : les deux images
  // viennent du même détourage, ce qui permet de les superposer exactement.
  const HEAD_IN_PEEK = { x: 0.577, y: 0.428, size: 1.129 };

  const HIDDEN = 'translate(-50%, 100%)';
  const PEEK = 'translate(-50%, 48%)';
  const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
  const EASE_IN = 'cubic-bezier(.6, 0, .9, .4)';
  const TAU = Math.PI * 2;
  const MSG = 'coucou freulere';

  // ---------- utilitaires ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = t => t * t * (3 - 2 * t);
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInCubic = t => t * t * t;
  const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Résout quand `p` résout ou quand le signal est annulé.
  const until = (p, signal) => signal.aborted ? Promise.resolve() : Promise.race([
    p, new Promise(r => signal.addEventListener('abort', r, { once: true })),
  ]);

  // Délai qui ne s'écoule que lorsque l'onglet est visible.
  function visibleDelay(ms) {
    return new Promise(resolve => {
      let remaining = ms, start = 0, id = 0, running = false;
      const run = () => { if (running) return; running = true; start = performance.now(); id = setTimeout(done, remaining); };
      const pause = () => { if (!running) return; running = false; clearTimeout(id); remaining -= performance.now() - start; };
      const onVis = () => (document.hidden ? pause() : run());
      function done() { document.removeEventListener('visibilitychange', onVis); resolve(); }
      document.addEventListener('visibilitychange', onVis);
      if (!document.hidden) run();
    });
  }

  // Boucle rAF : fn(t) avec t ∈ [0,1].
  function tween(duration, fn) {
    return new Promise(resolve => {
      const t0 = performance.now();
      const step = now => {
        const t = Math.min(1, (now - t0) / duration);
        fn(t);
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function animateTransform(el, from, to, duration, easing) {
    el.style.transform = to;
    return el.animate([{ transform: from }, { transform: to }], { duration, easing }).finished.catch(() => {});
  }

  function loadImg(src) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    return img.decode().then(() => img);
  }

  function parseColor(str) {
    str = (str || '').trim();
    if (str[0] === '#') {
      const h = str.length === 4 ? str.slice(1).split('').map(c => c + c).join('') : str.slice(1);
      return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
    }
    const m = str.match(/\d+(\.\d+)?/g);
    return m ? m.slice(0, 3).map(Number) : [51, 51, 51];
  }
  const cssColor = name => parseColor(getComputedStyle(document.documentElement).getPropertyValue(name));
  const formatColor = k => cssColor('--color-' + k);
  // Thème clair / sombre de l'app : on regarde la luminance du fond.
  const isDark = () => { const [r, g, b] = cssColor('--bg'); return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110; };

  // ---------- DOM ----------
  const style = document.createElement('style');
  style.textContent = `
    .fz-layer { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 2147483000; }
    .fz-anchor { position: absolute; width: 0; height: 0; visibility: hidden; }
    .fz-wrap { position: absolute; left: 0; bottom: 0; width: clamp(78px, 9vw, 118px); transform: ${HIDDEN}; will-change: transform; }
    .fz-wrap img { display: block; width: 100%; height: auto; pointer-events: auto; cursor: pointer;
      user-select: none; -webkit-user-select: none; -webkit-user-drag: none; -webkit-tap-highlight-color: transparent;
      filter: drop-shadow(0 3px 8px rgba(0, 0, 0, .18)); }
    .fz-wrap img.is-headless { pointer-events: none;
      -webkit-mask-image: linear-gradient(to bottom, transparent 80%, #000 88%); mask-image: linear-gradient(to bottom, transparent 80%, #000 88%); }
    .fz-canvas { position: absolute; left: 0; top: 0; }
    .fz-halo { position: absolute; border-radius: 50%;
      background: radial-gradient(closest-side, color-mix(in srgb, var(--bg, #f5f5f5) 94%, transparent) 60%, color-mix(in srgb, var(--bg, #f5f5f5) 0%, transparent)); }
    .fz-dim { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at 50% 15%, rgba(15, 17, 21, .08), rgba(15, 17, 21, .22)); }
    .fz-sat { position: absolute; left: 0; top: 0; will-change: transform; }
    .fz-sat svg { position: absolute; left: -36px; top: -23.5px; overflow: visible; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, .2)); }
    :root[data-theme="dark"] .fz-sat svg { filter: drop-shadow(0 0 4px rgba(190, 210, 255, .35)); }
    .fz-hud { position: absolute; left: 0; top: 26px; transform: translateX(-50%); white-space: nowrap;
      font: 600 10px/1.5 Consolas, Monaco, "Courier New", monospace; letter-spacing: .04em; color: var(--text-light, #555);
      background: color-mix(in srgb, var(--panel-bg, #fff) 88%, transparent); border: 1px solid var(--border, #e0e0e0); border-radius: 4px; padding: 0 6px; }
    .fz-flare { position: absolute; left: 13px; top: 13px; width: 96px; height: 96px; margin: -48px 0 0 -48px; opacity: 0; border-radius: 50%;
      background: radial-gradient(circle, #fff 0 5%, rgba(255, 214, 90, .95) 11%, rgba(255, 190, 40, .45) 28%, rgba(255, 190, 40, 0) 62%); }
    .fz-flare::before, .fz-flare::after { content: ''; position: absolute; left: 50%; top: 50%; width: 170px; height: 2px; margin: -1px 0 0 -85px;
      background: linear-gradient(90deg, transparent, rgba(255, 176, 0, .95), transparent); }
    .fz-flare::after { transform: rotate(90deg); }
  `;

  const layer = document.createElement('div');
  layer.className = 'fz-layer';
  layer.setAttribute('aria-hidden', 'true');
  const anchor = document.createElement('div');
  anchor.className = 'fz-anchor';
  const wrap = document.createElement('div');
  wrap.className = 'fz-wrap';
  const peekImg = document.createElement('img');
  peekImg.alt = '';
  peekImg.draggable = false;
  wrap.appendChild(peekImg);
  anchor.appendChild(wrap);
  layer.appendChild(anchor);

  let headImg = null;

  // ---------- positions de sneak peek ----------
  // x, y : point d'ancrage sur un bord ; r : rotation (0 = la tête monte depuis le bas).
  const SPOTS = [
    () => ({ x: rand(14, 40), y: innerHeight, r: rand(26, 40) }),                  // bas-gauche
    () => ({ x: innerWidth - rand(14, 40), y: innerHeight, r: -rand(26, 40) }),    // bas-droite
    () => ({ x: rand(14, 40), y: 0, r: 180 - rand(26, 40) }),                      // haut-gauche
    () => ({ x: innerWidth - rand(14, 40), y: 0, r: -180 + rand(26, 40) }),        // haut-droite
    () => ({ x: 0, y: innerHeight * rand(0.35, 0.8), r: 90 + rand(-8, 8) }),       // bord gauche
    () => ({ x: innerWidth, y: innerHeight * rand(0.35, 0.8), r: -90 + rand(-8, 8) }), // bord droit
    () => ({ x: innerWidth * rand(0.15, 0.85), y: innerHeight, r: rand(-10, 10) }),  // bas
  ];
  let lastSpot = -1;
  let spot = null;

  function placeRandom() {
    let i;
    do { i = Math.floor(Math.random() * SPOTS.length); } while (i === lastSpot);
    lastSpot = i;
    spot = SPOTS[i]();
    anchor.style.left = spot.x + 'px';
    anchor.style.top = spot.y + 'px';
    anchor.style.transform = `rotate(${spot.r}deg)`;
  }

  // ---------- sneak peek ----------
  let peekCtl = null;
  let effectPromise = null;
  let hovered = false;

  async function peekOnce() {
    const ctl = new AbortController();
    const s = ctl.signal;
    peekCtl = ctl;
    placeRandom();
    anchor.style.visibility = 'visible';
    try {
      await until(animateTransform(wrap, HIDDEN, PEEK, CFG.slide, EASE_OUT), s);
      if (s.aborted) return;
      await until(sleep(CFG.peekHold), s);
      while (hovered && !s.aborted) {
        await until(new Promise(r => peekImg.addEventListener('pointerleave', r, { once: true })), s);
      }
      if (s.aborted) return;
      await until(animateTransform(wrap, PEEK, HIDDEN, CFG.slide, EASE_IN), s);
      if (!s.aborted) anchor.style.visibility = 'hidden';
    } finally {
      peekCtl = null;
    }
  }

  peekImg.addEventListener('pointerenter', () => { hovered = true; });
  peekImg.addEventListener('pointerleave', () => { hovered = false; });
  peekImg.addEventListener('pointerdown', e => {
    if (!peekCtl || peekCtl.signal.aborted) return;
    e.preventDefault();
    effectPromise = caught();
    peekCtl.abort();
  });

  // Position, taille et rotation à l'écran de la tête visible dans le peek.
  function headPose() {
    const w = wrap.offsetWidth, h = wrap.offsetHeight;
    const m = new DOMMatrixReadOnly(getComputedStyle(wrap).transform);
    const lx = m.m41 + HEAD_IN_PEEK.x * w;
    const ly = -h + m.m42 + HEAD_IN_PEEK.y * h;
    const r = (spot.r * Math.PI) / 180;
    return {
      x: spot.x + lx * Math.cos(r) - ly * Math.sin(r),
      y: spot.y + lx * Math.sin(r) + ly * Math.cos(r),
      size: HEAD_IN_PEEK.size * w,
      rot: spot.r,
    };
  }

  function caught() {
    const pose = headPose();
    // La tête se détache : on masque la tête du peek (le canvas la reprend
    // au même endroit) et le corps repart dans le bord.
    const from = getComputedStyle(wrap).transform;
    peekImg.classList.add('is-headless');
    animateTransform(wrap, from, HIDDEN, 420, EASE_IN).then(() => {
      anchor.style.visibility = 'hidden';
      peekImg.classList.remove('is-headless');
    });
    hovered = false;
    const bin = document.getElementById('binary-input');
    if (bin && !isInView(bin)) bin.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    return iridium(pose).catch(err => console.warn('[freulere]', err));
  }

  function isInView(el) {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.width > 0;
  }

  // ---------- état de l'app : snapshot / restauration / annulation ----------
  function snapshot() {
    const fields = [...document.querySelectorAll('.converter-grid textarea')].map(el => [el, el.value, el.style.cssText, el.placeholder]);
    const panels = [...document.querySelectorAll('.converter-grid .panel')].map(el => [el, el.className]);
    const msgs = [...document.querySelectorAll('[data-msg-for]')].map(el => [el, el.style.cssText]);
    const active = document.activeElement;
    const sel = active && active.tagName === 'TEXTAREA'
      ? { el: active, start: active.selectionStart, end: active.selectionEnd, dir: active.selectionDirection }
      : null;
    const source = panels.find(([, cls]) => /\bis-source\b/.test(cls));
    return () => {
      fields.forEach(([el, v, css, ph]) => { el.value = v; el.style.cssText = css; el.placeholder = ph; });
      // Resynchronise l'état interne de l'app (champ source, boutons Copier,
      // avertissements) via ses propres événements : un "input" sur le champ
      // source recalcule les autres champs à l'identique ; sans source, un
      // "blur" la remet à zéro.
      const srcField = source && source[0].querySelector('textarea');
      if (srcField) srcField.dispatchEvent(new Event('input', { bubbles: true }));
      else {
        const any = fields[0] && fields[0][0];
        if (any) any.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('input'));
      }
      fields.forEach(([el, v]) => { el.value = v; });
      panels.forEach(([el, cls]) => { el.className = cls; });
      msgs.forEach(([el, css]) => { el.style.cssText = css; });
      if (sel && document.activeElement === sel.el) sel.el.setSelectionRange(sel.start, sel.end, sel.dir);
    };
  }

  // Une touche clavier ou un clic dans un champ interrompt l'animation et
  // restaure immédiatement l'état d'origine.
  function session() {
    const restore = snapshot();
    const s = { aborted: false, restored: false };
    const doRestore = () => { if (!s.restored) { s.restored = true; restore(); } };
    const abort = () => { if (!s.aborted) { s.aborted = true; doRestore(); } };
    const onKey = () => abort();
    const onPointer = e => { if (e.target && e.target.tagName === 'TEXTAREA') abort(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    s.end = () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      doRestore();
    };
    s.sleep = ms => new Promise(r => {
      const t0 = performance.now();
      const tick = now => (s.aborted || now - t0 >= ms ? r() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
    return s;
  }

  function setField(ta, value, fire) {
    if (ta.value === value) return;
    ta.value = value;
    if (fire) ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Séparateur choisi dans l'app (espace ou rien).
  function toBinary(s) {
    const el = document.querySelector('input[data-sep-for~="bin"]:checked');
    const sep = el && el.value === 'none' ? '' : ' ';
    return [...s].map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(sep);
  }

  function eraseField(sess, ta, ms) {
    const start = ta.value;
    return tween(reduced ? 150 : ms, t => {
      if (!sess.aborted) setField(ta, start.slice(0, Math.round(start.length * (1 - t))), true);
    });
  }

  // Boucle rAF interruptible : fn(now) renvoie false pour s'arrêter.
  function frames(sess, fn) {
    return new Promise(resolve => {
      const step = now => {
        if (sess.aborted || fn(now) === false) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // ---------- rendu : canvas plein écran + glyphes ----------
  function glyphCanvas() {
    const c = document.createElement('canvas');
    c.className = 'fz-canvas';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(innerWidth * dpr);
    c.height = Math.round(innerHeight * dpr);
    c.style.width = innerWidth + 'px';
    c.style.height = innerHeight + 'px';
    layer.appendChild(c);
    const cv = { c, ctx: c.getContext('2d'), dpr, font: '' };
    cv.clear = () => {
      cv.ctx.setTransform(1, 0, 0, 1, 0, 0);
      cv.ctx.clearRect(0, 0, c.width, c.height);
      cv.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cv.ctx.textAlign = 'center';
      cv.ctx.textBaseline = 'middle';
    };
    cv.glyph = (ch, x, y, size, weight, col, alpha) => {
      const f = `${weight} ${Math.round(size * 2) / 2}px Consolas, Monaco, "Courier New", monospace`;
      if (f !== cv.font) { cv.font = f; cv.ctx.font = f; }
      cv.ctx.globalAlpha = alpha;
      cv.ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      cv.ctx.fillText(ch, x, y);
    };
    cv.clear();
    return cv;
  }

  // Position écran du centre de chaque caractère (hors espaces) qu'aurait
  // `value` dans le textarea, via un miroir invisible aux mêmes styles.
  function charTargets(ta, value) {
    const cs = getComputedStyle(ta);
    const m = document.createElement('div');
    ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle',
      'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle', 'fontFamily', 'fontSize', 'fontWeight',
      'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'tabSize',
    ].forEach(p => { m.style[p] = cs[p]; });
    Object.assign(m.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
    const spans = [];
    for (let i = 0; i < value.length; i++) {
      const s = document.createElement('span');
      s.textContent = value[i];
      m.appendChild(s);
      spans.push(s);
    }
    layer.appendChild(m);
    const mr = m.getBoundingClientRect(), tr = ta.getBoundingClientRect();
    const size = parseFloat(cs.fontSize), col = parseColor(cs.color);
    const out = [];
    spans.forEach((s, i) => {
      if (value[i] === ' ') return;
      const r = s.getBoundingClientRect();
      out.push({
        i, ch: value[i], size, col, weight: cs.fontWeight, w: r.width, h: r.height,
        x: tr.left + r.left - mr.left + r.width / 2 - ta.scrollLeft,
        y: tr.top + r.top - mr.top + r.height / 2 - ta.scrollTop,
      });
    });
    m.remove();
    return out;
  }

  // Échantillonne la tête en grille : une cellule opaque = un glyphe 0/1 coloré,
  // couleurs contrastées pour que le visage reste lisible. En thème sombre, les
  // tons sont éclaircis (sinon les cheveux disparaissent sur le fond).
  function headCells(cx, cy, grid, cell, bitsSeq) {
    const tone = isDark()
      ? v => clamp((v - 140) * 1.2 + 165, 90, 255)
      : v => clamp((v - 140) * 1.6 + 120, 0, 255);
    const off = document.createElement('canvas');
    off.width = off.height = grid;
    const octx = off.getContext('2d', { willReadFrequently: true });
    octx.drawImage(headImg, 0, 0, grid, grid);
    const data = octx.getImageData(0, 0, grid, grid).data;
    const out = [];
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const i = (gy * grid + gx) * 4;
        if (data[i + 3] < 110) continue;
        out.push({
          x: cx - (grid * cell) / 2 + gx * cell + cell / 2,
          y: cy - (grid * cell) / 2 + gy * cell + cell / 2,
          ch: bitsSeq[out.length % bitsSeq.length],
          col: [0, 1, 2].map(k => tone(data[i + k])),
          size: cell * 1.45, weight: 700,
        });
      }
    }
    return out;
  }

  // Satellite Iridium stylisé (corps doré, panneaux solaires, 3 antennes
  // MMA, les panneaux réfléchissants à l'origine des « Iridium flares »).
  function makeSatellite() {
    const el = document.createElement('div');
    el.className = 'fz-sat';
    el.innerHTML = `<svg viewBox="-40 -26 80 52" width="72" height="47" aria-hidden="true" stroke-linejoin="round">
      <path d="M-14 -6H-7M7 -6H14" stroke="#8b96a3" stroke-width="1.4"/>
      <g fill="#2b3a5c" stroke="#6f86b3" stroke-width=".7">
        <rect x="-38" y="-11" width="24" height="10" rx="1"/><rect x="14" y="-11" width="24" height="10" rx="1"/>
      </g>
      <path d="M-30 -11v10M-22 -11v10M22 -11v10M30 -11v10M-38 -6h24M14 -6h24" stroke="#6f86b3" stroke-width=".45"/>
      <path d="M-6 -20H6L7.5 10H-7.5Z" fill="#cfa84e" stroke="#8a6d2a" stroke-width=".7"/>
      <path d="M0 -20V10" stroke="#ead08a" stroke-width=".7"/>
      <g fill="#e4e9ef" stroke="#8b96a3" stroke-width=".7">
        <path d="M-7.5 2L-17 16L-13 18L-5 5Z"/><path d="M7.5 2L17 16L13 18L5 5Z"/><path d="M-3.5 6H3.5L3 20H-3Z"/>
      </g>
    </svg><div class="fz-flare"></div><div class="fz-hud"></div>`;
    layer.appendChild(el);
    return el;
  }

  function glowPanel(panel, rgb) {
    if (!panel) return;
    const c = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    const cs = getComputedStyle(panel).boxShadow;
    const base = cs && cs !== 'none' ? cs + ', ' : '';
    panel.animate([
      { boxShadow: `${base}0 0 0 0 rgba(${c},0)` },
      { boxShadow: `${base}0 0 0 4px rgba(${c},.35)`, offset: 0.3 },
      { boxShadow: `${base}0 0 0 0 rgba(${c},0)` },
    ], { duration: 1200, easing: 'ease-out' });
  }

  // Chaque glyphe vole d'une source vers une cible. Les cibles sont atteintes
  // dans l'ordre, étalées sur `spread` ms ; onLand(j) est appelé à l'arrivée
  // de la cible j (c'est là qu'on écrit dans le vrai champ).
  function flyGlyphs(cv, sess, o) {
    const { sources, targets, spread, dur } = o;
    const N = sources.length, M = targets.length, P = Math.max(N, M);
    const arriveAt = j => (M > 1 ? (j / (M - 1)) * spread : 0) + dur;
    const parts = [];
    for (let p = 0; p < P; p++) {
      const j = Math.floor((p * M) / P);
      const d = dur * rand(0.7, 1);
      parts.push({ s: sources[Math.floor((p * N) / P)], t: targets[j], start: arriveAt(j) - d, d, arc: rand(-o.arc, o.arc) });
    }
    const flashes = [];
    let next = 0;
    const end = arriveAt(M - 1) + 300;
    const t0 = performance.now();
    return frames(sess, now => {
      const el = now - t0;
      while (next < M && el >= arriveAt(next)) {
        o.onLand(next);
        flashes.push({ t: targets[next], at: el });
        next++;
      }
      cv.clear();
      const ctx = cv.ctx;
      o.onFrame(el, ctx);
      for (const f of flashes) {
        const k = (el - f.at) / 280;
        if (k >= 1) continue;
        ctx.globalAlpha = 0.35 * (1 - k);
        ctx.fillStyle = `rgb(${o.flash.join(',')})`;
        ctx.fillRect(f.t.x - f.t.w / 2 - 1, f.t.y - f.t.h / 2, f.t.w + 2, f.t.h);
      }
      for (const p of parts) {
        if (el < p.start || el >= p.start + p.d) continue;
        const u = (el - p.start) / p.d, e = easeInOutCubic(u), bump = Math.sin(u * Math.PI);
        const col = u < 0.5 ? mix(p.s.col, o.mid, u * 2) : mix(o.mid, p.t.col, (u - 0.5) * 2);
        cv.glyph(u < 0.5 ? p.s.ch : p.t.ch,
          lerp(p.s.x, p.t.x, e) + bump * p.arc * 0.5, lerp(p.s.y, p.t.y, e) - bump * Math.abs(p.arc),
          lerp(p.s.size, p.t.size, e), u < 0.5 ? p.s.weight : p.t.weight, col, 1);
      }
      return el < end;
    });
  }

  // ---------- l'animation : transmission Iridium ----------
  async function iridium(pose) {
    const bin = document.getElementById('binary-input');
    const sess = session();
    const cv = glyphCanvas();
    const ctx = cv.ctx;
    let halo = null, sat = null, dim = null;
    try {
      const W = innerWidth, H = innerHeight;
      const GRID = 28, CELL = clamp(Math.round(Math.min(W, H) / 80), 6, 9), SIZE = GRID * CELL;
      const c = { x: W / 2, y: H / 2 };
      const value = toBinary(MSG);
      const bits = value.replace(/ /g, '');
      const face = headCells(c.x, c.y, GRID, CELL, bits);
      const green = formatColor('bin');
      const orbitColor = `rgb(${cssColor('--text-muted').join(',')})`;

      // Satellite : orbite en pointillés en haut de l'écran. Il entre dès le
      // clic, arrive au-dessus de la tête pour la scanner, puis traverse
      // lentement pendant les transferts.
      const orbitTop = Math.max(52, H * 0.1), orbitDrop = H * 0.16;
      const orbitAt = p => ({ x: lerp(-70, W + 70, p), y: orbitTop + orbitDrop * Math.pow(2 * p - 1, 2) });
      const ENTER = reduced ? 300 : 900, MID = reduced ? 1600 : 6000;
      const passP = g => (g < 0 ? 0 : g < ENTER ? 0.42 * easeOutCubic(g / ENTER) : 0.42 + 0.3 * clamp((g - ENTER) / MID, 0, 1));
      sat = makeSatellite();
      const hud = sat.querySelector('.fz-hud');
      const say = txt => { if (hud.textContent !== txt) hud.textContent = txt; };
      const moveSat = p => {
        const a = orbitAt(p), b = orbitAt(p + 0.002);
        sat.style.transform = `translate(${a.x}px, ${a.y}px)`;
        sat.firstElementChild.style.transform = `rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI}deg)`;
        return a;
      };
      const drawOrbit = alpha => {
        if (alpha <= 0) return;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = orbitColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        for (let i = 0; i <= 48; i++) {
          const o = orbitAt(i / 48);
          if (i) ctx.lineTo(o.x, o.y); else ctx.moveTo(o.x, o.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };
      moveSat(0);
      say('IRIDIUM · SBD');

      // 1. vol + scan, en une seule boucle : la tête part tout de suite de sa
      //    position dans le peek pendant que le satellite entre ; dès qu'il
      //    est au-dessus, son faisceau balaie la tête et la change en binaire.
      const FLY = reduced ? 300 : 850, SCAN0 = reduced ? 150 : 450, SCAN = reduced ? 300 : 1000;
      const t0 = performance.now();
      const passT0 = t0;
      let rot0 = pose.rot % 360;
      if (rot0 > 180) rot0 -= 360;
      if (rot0 < -180) rot0 += 360;
      const s0 = pose.size / SIZE;
      halo = document.createElement('div');
      halo.className = 'fz-halo';
      Object.assign(halo.style, { left: c.x - SIZE + 'px', top: c.y - SIZE + 'px', width: SIZE * 2 + 'px', height: SIZE * 2 + 'px' });
      layer.insertBefore(halo, cv.c);
      halo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FLY, easing: 'ease-out' });

      await frames(sess, now => {
        const el = now - t0;
        const ft = clamp(el / FLY, 0, 1), e = easeOutCubic(ft);
        const st = clamp((el - SCAN0) / SCAN, 0, 1), scan = -SIZE / 2 - 12 + (SIZE + 24) * smoothstep(st);
        const sp = moveSat(passP(now - passT0));
        cv.clear();
        drawOrbit(0.4 * clamp(el / 400, 0, 1));
        if (st > 0) say('IRIDIUM · SCAN');

        const hx = lerp(pose.x, c.x, e), hy = lerp(pose.y, c.y, e) - Math.sin(ft * Math.PI) * 50;
        const hr = (lerp(rot0, 0, e) * Math.PI) / 180, hs = lerp(s0, 1, e);
        const toScreen = (lx, ly) => ({
          x: hx + hs * (lx * Math.cos(hr) - ly * Math.sin(hr)),
          y: hy + hs * (lx * Math.sin(hr) + ly * Math.cos(hr)),
        });
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(hr);
        ctx.scale(hs, hs);
        // la photo, sous la ligne de scan
        ctx.save();
        ctx.beginPath();
        ctx.rect(-SIZE / 2, scan, SIZE, SIZE);
        ctx.clip();
        ctx.globalAlpha = 1;
        ctx.drawImage(headImg, -SIZE / 2, -SIZE / 2, SIZE, SIZE);
        ctx.restore();
        // le binaire, au-dessus
        for (const g of face) {
          const ly = g.y - c.y;
          if (ly > scan + 4) continue;
          const k = clamp(1 - (scan - ly) / 22, 0, 1);
          cv.glyph(g.ch, g.x - c.x, ly, g.size * (1 + 0.3 * k), g.weight, mix(g.col, green, k), 1);
        }
        const beam = st > 0 && st < 1 ? Math.min(1, st * 8, (1 - st) * 8) : 0;
        if (beam > 0) {
          ctx.globalAlpha = 0.7 * beam;
          ctx.fillStyle = `rgb(${green.join(',')})`;
          ctx.fillRect(-SIZE / 2 - 10, scan - 1, SIZE + 20, 2);
        }
        ctx.restore();
        // le faisceau du satellite, dont le bord trace la ligne de scan
        if (beam > 0) {
          const a = toScreen(-SIZE / 2 - 10, scan), b = toScreen(SIZE / 2 + 10, scan);
          const grad = ctx.createLinearGradient(sp.x, sp.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
          grad.addColorStop(0, `rgba(${green.join(',')},.32)`);
          grad.addColorStop(1, `rgba(${green.join(',')},.1)`);
          ctx.globalAlpha = beam;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(sp.x - 2, sp.y + 14);
          ctx.lineTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(sp.x + 2, sp.y + 14);
          ctx.closePath();
          ctx.fill();
        }
        return ft < 1 || st < 1;
      });
      if (sess.aborted) return;

      // 2. uplink : les bits quittent le visage (du haut vers le bas) vers
      //    l'antenne, dès la fin du scan
      const UP_START = performance.now() - passT0, UP_SPREAD = reduced ? 300 : 1300, UP_DUR = reduced ? 300 : 650;
      face.forEach((g, k) => { g.launch = UP_START + (k / face.length) * UP_SPREAD + rand(0, 120); });
      halo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: UP_SPREAD + UP_DUR, easing: 'ease-in', fill: 'forwards' });
      let flareAt = 0;
      await frames(sess, now => {
        const g0 = now - passT0;
        const s = moveSat(passP(g0));
        cv.clear();
        drawOrbit(0.4);
        let received = 0;
        for (const g of face) {
          const u = (g0 - g.launch) / UP_DUR;
          if (u < 0) { cv.glyph(g.ch, g.x, g.y, g.size, g.weight, g.col, 1); continue; }
          if (u >= 1) { received++; continue; }
          const e = easeInCubic(u);
          cv.glyph(g.ch, lerp(g.x, s.x, e), lerp(g.y, s.y + 14, e), lerp(g.size, 5, e), g.weight,
            mix(g.col, green, Math.min(1, u * 2)), 1 - 0.6 * e);
        }
        if (received > 0) {
          const k = (g0 % 320) / 320;
          ctx.globalAlpha = 0.5 * (1 - k);
          ctx.strokeStyle = `rgb(${green.join(',')})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y + 14, 5 + k * 16, 0, TAU);
          ctx.stroke();
        }
        say(`IRIDIUM · SBD ↑ ${Math.round((received / face.length) * bits.length)}/${bits.length} bits`);
        if (received === face.length) { flareAt = now; return false; }
        return true;
      });
      if (sess.aborted) return;

      // 3. flare : le reflet du soleil sur une antenne, signature des Iridium.
      //    Le downlink démarre au pic du flare.
      say('IRIDIUM · FLARE');
      const FLARE = reduced ? 300 : 900;
      dim = document.createElement('div');
      dim.className = 'fz-dim';
      layer.insertBefore(dim, cv.c);
      dim.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: FLARE, easing: 'ease-in-out', fill: 'forwards' });
      sat.querySelector('.fz-flare').animate([
        { opacity: 0, transform: 'scale(.1) rotate(0deg)' },
        { opacity: 1, transform: 'scale(1.25) rotate(20deg)', offset: 0.35 },
        { opacity: 0, transform: 'scale(.3) rotate(45deg)' },
      ], { duration: FLARE, easing: 'ease-out' });
      await frames(sess, now => {
        moveSat(passP(now - passT0));
        cv.clear();
        drawOrbit(0.4);
        return now - flareAt < FLARE * 0.4;
      });
      if (sess.aborted) return;

      // 4. downlink : un faisceau vers le champ Binary, les bits y atterrissent.
      //    Le message d'aide « octet incomplet » de l'app est masqué pendant
      //    l'écriture bit à bit (il clignoterait), puis restauré.
      const binMsg = document.querySelector('[data-msg-for="bin"]');
      if (binMsg) binMsg.style.visibility = 'hidden';
      setField(bin, '', true);
      const targets = charTargets(bin, value);
      const DSPREAD = reduced ? 500 : 2400, DDUR = reduced ? 300 : 800, M = targets.length;
      const dlT0 = performance.now() + 16;
      const sources = targets.map((t, j) => {
        const s = orbitAt(passP(dlT0 + (M > 1 ? (j / (M - 1)) * DSPREAD : 0) + DDUR * 0.15 - passT0));
        return { x: s.x, y: s.y + 14, ch: t.ch, col: green, size: 5, weight: 700 };
      });
      const tr = bin.getBoundingClientRect();
      let landed = 0;
      await flyGlyphs(cv, sess, {
        sources, targets, spread: DSPREAD, dur: DDUR, mid: green, flash: green, arc: 6,
        onLand: j => { landed = j + 1; setField(bin, value.slice(0, targets[j].i + 1), true); },
        onFrame: el => {
          const s = moveSat(passP(performance.now() - passT0));
          drawOrbit(0.4);
          const env = clamp(el / 300, 0, 1) * clamp((DSPREAD + DDUR - el) / 400, 0, 1);
          if (env > 0) {
            const grad = ctx.createLinearGradient(0, s.y, 0, tr.top);
            grad.addColorStop(0, `rgba(${green.join(',')},.28)`);
            grad.addColorStop(1, `rgba(${green.join(',')},.05)`);
            ctx.globalAlpha = env;
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(s.x - 2, s.y + 14);
            ctx.lineTo(tr.left + 4, tr.top + 2);
            ctx.lineTo(tr.right - 4, tr.top + 2);
            ctx.lineTo(s.x + 2, s.y + 14);
            ctx.closePath();
            ctx.fill();
          }
          say(`IRIDIUM · SBD ↓ ${Math.round((landed / M) * bits.length)}/${bits.length} bits`);
        },
      });
      if (sess.aborted) return;

      // 5. fin de passage : perte du signal, le satellite sort de l'écran
      glowPanel(document.getElementById('text-input').closest('.panel'), formatColor('text'));
      say('IRIDIUM · LOS');
      const pEnd = passP(performance.now() - passT0), EXIT = reduced ? 300 : 900;
      const t1 = performance.now();
      await frames(sess, now => {
        const t = clamp((now - t1) / EXIT, 0, 1);
        moveSat(lerp(pEnd, 1.02, easeInCubic(t)));
        cv.clear();
        drawOrbit(0.4 * (1 - t));
        return t < 1;
      });
      cv.clear();
      await sess.sleep(1700);
      if (!sess.aborted) await eraseField(sess, bin, 700);
    } finally {
      if (halo) halo.remove();
      if (sat) sat.remove();
      if (dim) dim.remove();
      cv.c.remove();
      sess.end();
    }
  }

  // ---------- boucle principale ----------
  async function main() {
    await visibleDelay(CFG.firstDelay);
    try {
      const [peek, head] = await Promise.all([loadImg(SRC.peek), loadImg(SRC.head)]);
      peekImg.src = peek.src;
      headImg = head;
    } catch (err) {
      return; // images indisponibles : on abandonne en silence
    }
    document.head.appendChild(style);
    document.body.appendChild(layer);

    for (;;) {
      await peekOnce();
      if (effectPromise) {
        await effectPromise;
        effectPromise = null;
        await visibleDelay(CFG.afterEffectGap);
      } else {
        await visibleDelay(CFG.peekGap);
      }
    }
  }

  main();
})();
