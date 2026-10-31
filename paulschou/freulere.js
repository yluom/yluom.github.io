/*
 * Easter egg « freulere » pour le Paulschou Converter.
 *
 * Après 10 s passées sur la page (onglet visible), la tête de freulere fait un
 * sneak peek de 0,5 s depuis un coin ou un bord aléatoire, disparaît 5 s, puis
 * revient ailleurs. Si la souris survole la tête, elle reste visible tant que
 * le survol dure (sinon elle est quasi impossible à attraper).
 *
 * Clic sur la tête → une animation. Prototypes :
 *   rain     : pluie de têtes (canvas, gravité, rebonds, fondu)
 *   type     : la tête vole jusqu'au champ TEXT et y tape un message
 *   bits     : la tête se désintègre en 0/1 aspirés par le champ Binary
 *   encode   : la tête se défait ligne par ligne, chaque bit atterrit à sa
 *              place dans Binary ; l'app décode « coucou freulere » en direct
 *   relay    : les bits remplissent Binary puis sautent de champ en champ
 *              (BIN → HEX → DEC → B64 → TEXT) en changeant de forme et de couleur
 *   portrait : « coucou freulere » est tapé, puis son binaire quitte le champ
 *              Binary pour dessiner le visage de freulere et y retourne
 *   remix    : la tête vole au centre en grandissant, un scan la change en
 *              binaire, les bits dansent puis alimentent le champ Binary ;
 *              l'app décode « coucou freulere » dans TEXT
 *
 * Les animations qui écrivent dans les champs restaurent ensuite l'état
 * d'origine à l'identique (valeurs, classes, curseur). Une frappe clavier ou un
 * clic dans un champ interrompt tout et restaure immédiatement.
 *
 * Choix du prototype : ?egg=<nom> (le premier délai passe alors à 1 s pour
 * tester). Sans paramètre : remix, encode, relay, portrait, bits à tour de rôle.
 *
 * Contraintes : rien n'est chargé avant les 10 s, overlay en
 * pointer-events:none (seule la tête est cliquable), animations sur transform
 * / canvas uniquement, aucun accès au code de l'app (on passe par le DOM et
 * des événements "input" standards).
 */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const EFFECT_NAMES = ['rain', 'type', 'bits', 'encode', 'relay', 'portrait', 'remix'];
  const ROTATION = ['remix', 'encode', 'relay', 'portrait', 'bits']; // sans ?egg, enchaînés à chaque clic
  const forced = EFFECT_NAMES.includes(params.get('egg')) ? params.get('egg') : null;

  const CFG = {
    firstDelay: params.has('egg') ? 1000 : 10000, // temps visible avant la 1re apparition
    peekHold: 500,          // durée du sneak peek
    peekGap: 5000,          // pause entre deux apparitions
    slide: 220,             // durée d'entrée / sortie
    afterEffectGap: 15000,  // pause après une animation
  };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scriptSrc = document.currentScript && document.currentScript.src;
  const IMG_BASE = scriptSrc ? new URL('img/', scriptSrc).href : 'img/';
  const SRC = {
    peek: IMG_BASE + 'freulere-peek.webp',
    head: IMG_BASE + 'freulere-head.webp',
  };

  const HIDDEN = 'translate(-50%, 100%)';
  const PEEK = 'translate(-50%, 48%)';
  const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
  const EASE_IN = 'cubic-bezier(.6, 0, .9, .4)';
  const TAU = Math.PI * 2;

  // ---------- utilitaires ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInCubic = t => t * t * t;
  const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
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

  // ---------- DOM ----------
  const style = document.createElement('style');
  style.textContent = `
    .fz-layer { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 2147483000; }
    .fz-anchor { position: absolute; width: 0; height: 0; visibility: hidden; }
    .fz-wrap { position: absolute; left: 0; bottom: 0; width: clamp(78px, 9vw, 118px); transform: ${HIDDEN}; will-change: transform; }
    .fz-wrap img { display: block; width: 100%; height: auto; pointer-events: auto; cursor: pointer;
      user-select: none; -webkit-user-select: none; -webkit-user-drag: none; -webkit-tap-highlight-color: transparent;
      transform-origin: 50% 30%; filter: drop-shadow(0 3px 8px rgba(0, 0, 0, .18)); }
    .fz-canvas { position: absolute; left: 0; top: 0; }
    .fz-big { position: absolute; left: 0; top: 0; will-change: transform, clip-path; filter: drop-shadow(0 6px 14px rgba(0, 0, 0, .18)); }
    .fz-halo { position: absolute; border-radius: 50%; background: radial-gradient(closest-side, rgba(245,245,245,.94) 60%, rgba(245,245,245,0)); }
    .fz-fly { position: absolute; left: 0; top: 0; width: 64px; height: 64px; will-change: transform; }
    .fz-fly img { display: block; width: 100%; height: 100%; filter: drop-shadow(0 3px 6px rgba(0, 0, 0, .2)); }
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

  function placeRandom() {
    let i;
    do { i = Math.floor(Math.random() * SPOTS.length); } while (i === lastSpot);
    lastSpot = i;
    const s = SPOTS[i]();
    anchor.style.left = s.x + 'px';
    anchor.style.top = s.y + 'px';
    anchor.style.transform = `rotate(${s.r}deg)`;
  }

  // ---------- sneak peek ----------
  let peekCtl = null;
  let effectPromise = null;
  let hovered = false;
  let effectIndex = 0;

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

  function visibleCenter(r) {
    const left = clamp(r.left, 0, innerWidth), right = clamp(r.right, 0, innerWidth);
    const top = clamp(r.top, 0, innerHeight), bottom = clamp(r.bottom, 0, innerHeight);
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }

  async function caught() {
    const origin = visibleCenter(peekImg.getBoundingClientRect());
    await peekImg.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.18) rotate(-7deg)', offset: 0.35 },
      { transform: 'scale(.96) rotate(4deg)', offset: 0.7 },
      { transform: 'scale(1)' },
    ], { duration: 320, easing: 'ease-out' }).finished.catch(() => {});
    await animateTransform(wrap, PEEK, HIDDEN, 140, EASE_IN);
    anchor.style.visibility = 'hidden';
    hovered = false;

    let name = forced || ROTATION[effectIndex++ % ROTATION.length];
    // les animations qui écrivent dans les champs ont besoin de les voir à l'écran
    const NEEDS = { type: ['text-input'], encode: ['binary-input'], remix: ['binary-input'], portrait: ['text-input', 'binary-input'] };
    if (NEEDS[name] && !NEEDS[name].every(id => isInView(document.getElementById(id)))) name = name === 'type' ? 'rain' : 'bits';
    try {
      await EFFECTS[name](origin);
    } catch (err) {
      console.warn('[freulere]', err);
    }
  }

  function isInView(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.width > 0;
  }

  // ---------- canvas plein écran ----------
  function makeCanvas() {
    const c = document.createElement('canvas');
    c.className = 'fz-canvas';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = innerWidth, h = innerHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    layer.appendChild(c);
    return { c, ctx: c.getContext('2d'), w, h, dpr };
  }

  // ---------- prototype 1 : pluie de têtes ----------
  function rain(origin) {
    return new Promise(resolve => {
      const { c, ctx, w, h, dpr } = makeCanvas();
      const count = reduced ? 10 : Math.round(clamp((w * h) / 20000, 24, 60));
      const parts = [];
      const add = (x, y, vx, vy, delay) => parts.push({
        x, y, vx, vy, delay, s: rand(34, 82), a: rand(0, TAU), va: rand(-5, 5),
        bounces: 0, age: 0, alpha: 1,
      });
      // gerbe depuis la tête attrapée, puis pluie depuis le haut
      for (let i = 0; i < 7; i++) add(origin.x, origin.y, rand(-280, 280), rand(-760, -380), 0);
      for (let i = 0; i < count; i++) add(rand(0, w), -60, rand(-50, 50), rand(0, 150), rand(150, 2200));

      const G = 1600;
      const t0 = performance.now();
      let last = t0;
      const frame = now => {
        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;
        const elapsed = now - t0;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        let alive = 0;
        for (const p of parts) {
          if (elapsed < p.delay) { alive++; continue; }
          if (p.alpha <= 0) continue;
          alive++;
          p.age += dt;
          p.vy += G * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.a += p.va * dt;
          const r = p.s / 2;
          if (p.y + r > h && p.vy > 0) {
            p.y = h - r;
            p.vy *= -0.42;
            p.vx *= 0.75;
            p.va *= 0.6;
            p.bounces++;
          }
          if (p.bounces >= 2 || p.age > 3.2) p.alpha -= dt * 2.5;
          if (p.alpha <= 0) continue;
          const cos = Math.cos(p.a) * dpr, sin = Math.sin(p.a) * dpr;
          ctx.globalAlpha = p.alpha;
          ctx.setTransform(cos, sin, -sin, cos, p.x * dpr, p.y * dpr);
          ctx.drawImage(headImg, -r, -r, p.s, p.s);
        }
        if (alive > 0 && elapsed < 8000) requestAnimationFrame(frame);
        else { c.remove(); resolve(); }
      };
      requestAnimationFrame(frame);
    });
  }

  // ---------- prototype 2 : la tête écrit dans le champ TEXT ----------
  const MESSAGES = [
    "Coucou, c'est freulere !",
    'freulere était là.',
    "Tu m'as trouvé ;)",
    'Bien joué, tu m\'as attrapé !',
  ];

  function snapshot() {
    const fields = [...document.querySelectorAll('.converter-grid textarea')].map(el => [el, el.value, el.style.cssText, el.placeholder]);
    const panels = [...document.querySelectorAll('.converter-grid .panel')].map(el => [el, el.className]);
    const active = document.activeElement;
    const sel = active && active.tagName === 'TEXTAREA'
      ? { el: active, start: active.selectionStart, end: active.selectionEnd, dir: active.selectionDirection }
      : null;
    const source = panels.find(([el, cls]) => /\bis-source\b/.test(cls));
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
      if (sel && document.activeElement === sel.el) sel.el.setSelectionRange(sel.start, sel.end, sel.dir);
    };
  }

  async function type(origin) {
    const ta = document.getElementById('text-input');
    const restore = snapshot();
    let aborted = false, restored = false;
    const doRestore = () => { if (!restored) { restored = true; restore(); } };
    const abort = () => { if (!aborted) { aborted = true; doRestore(); } };
    const onKey = () => abort();
    const onPointer = e => { if (e.target && e.target.tagName === 'TEXTAREA') abort(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);

    const fly = document.createElement('div');
    fly.className = 'fz-fly';
    const img = headImg.cloneNode();
    fly.appendChild(img);
    layer.appendChild(fly);
    const HALF = 32;
    const setPos = (x, y, rot) => { fly.style.transform = `translate(${x - HALF}px, ${y - HALF}px) rotate(${rot}deg)`; };

    try {
      // vol en arc jusqu'au coin supérieur droit du champ TEXT
      const r = ta.getBoundingClientRect();
      const target = { x: r.right - 44, y: r.top - 18 };
      const ctrl = { x: (origin.x + target.x) / 2, y: Math.min(origin.y, target.y) - 160 };
      setPos(origin.x, origin.y, 0);
      await tween(reduced ? 250 : 750, t => {
        const e = easeInOutCubic(t), u = 1 - e;
        const x = u * u * origin.x + 2 * u * e * ctrl.x + e * e * target.x;
        const y = u * u * origin.y + 2 * u * e * ctrl.y + e * e * target.y;
        setPos(x, y, lerp(0, 360 - 12, e));
      });
      if (aborted) return;

      // frappe
      const msg = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
      ta.value = '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      for (const ch of msg) {
        if (aborted) break;
        ta.value += ch;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        img.animate([
          { transform: 'translateY(0) rotate(0)' },
          { transform: 'translateY(4px) rotate(-4deg)' },
          { transform: 'translateY(0) rotate(0)' },
        ], { duration: 110, easing: 'ease-out' });
        await sleep(ch === ' ' ? rand(120, 200) : rand(55, 130));
      }
      if (!aborted) await sleep(1800);

      // effacement rapide puis restauration exacte de l'état d'origine
      while (!aborted && ta.value.length) {
        ta.value = ta.value.slice(0, -1);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(22);
      }
      doRestore();
    } finally {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      doRestore();
      // la tête repart par le bord le plus proche
      const m = new DOMMatrixReadOnly(getComputedStyle(fly).transform);
      const x = m.m41 + HALF, y = m.m42 + HALF;
      const exitX = x > innerWidth / 2 ? innerWidth + 80 : -80;
      await tween(reduced ? 200 : 500, t => {
        const e = easeInCubic(t);
        setPos(lerp(x, exitX, e), y - Math.sin(t * Math.PI) * 60, -12 + e * (exitX > 0 ? 300 : -300));
      });
      fly.remove();
    }
  }

  // ---------- prototype 3 : désintégration en bits ----------
  function bits(origin) {
    const target = document.getElementById('binary-input');
    const panel = target && target.closest('.panel');
    const GRID = 22, CELL = 7, SIZE = GRID * CELL;

    const off = document.createElement('canvas');
    off.width = off.height = GRID;
    const octx = off.getContext('2d', { willReadFrequently: true });
    octx.drawImage(headImg, 0, 0, GRID, GRID);
    const data = octx.getImageData(0, 0, GRID, GRID).data; // peut lever en file:// → catch dans caught()

    const { c, ctx, w, h, dpr } = makeCanvas();
    const cx = clamp(origin.x, SIZE / 2 + 8, w - SIZE / 2 - 8);
    const cy = clamp(origin.y, SIZE / 2 + 8, h - SIZE / 2 - 8);
    const tr = target ? target.getBoundingClientRect() : { left: w / 2 - 50, right: w / 2 + 50, top: h - 60, bottom: h - 20 };
    const tl = clamp(tr.left + 12, 0, w), trr = clamp(tr.right - 12, 0, w);
    const tt = clamp(tr.top + 12, 0, h), tb = clamp(tr.bottom - 12, 0, h);
    const GREEN = [58, 154, 91];

    const parts = [];
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const i = (gy * GRID + gx) * 4;
        if (data[i + 3] < 110) continue;
        const hx = cx - SIZE / 2 + gx * CELL + CELL / 2;
        const hy = cy - SIZE / 2 + gy * CELL + CELL / 2;
        const dx = hx - cx, dy = hy - cy, d = Math.hypot(dx, dy) || 1;
        parts.push({
          hx, hy,
          ex: (dx / d) * rand(18, 60) + rand(-10, 10),
          ey: (dy / d) * rand(18, 60) + rand(-10, 10),
          tx: rand(tl, Math.max(tl, trr)), ty: rand(tt, Math.max(tt, tb)),
          arc: rand(-90, 90),
          ch: Math.random() < 0.5 ? '0' : '1',
          col: [data[i], data[i + 1], data[i + 2]],
          delay: 300 + (gy / GRID) * 300 + rand(0, 250),
          dur: reduced ? 450 : rand(950, 1250),
        });
      }
    }

    let glowed = false;
    const glow = () => {
      if (glowed || !panel) return;
      glowed = true;
      panel.animate([
        { boxShadow: '0 2px 8px rgba(0,0,0,.06), 0 0 0 0 rgba(58,154,91,0)' },
        { boxShadow: '0 2px 8px rgba(0,0,0,.06), 0 0 0 4px rgba(58,154,91,.35)', offset: 0.3 },
        { boxShadow: '0 2px 8px rgba(0,0,0,.06), 0 0 0 0 rgba(58,154,91,0)' },
      ], { duration: 1100, easing: 'ease-out' });
    };

    return new Promise(resolve => {
      const t0 = performance.now();
      const frame = now => {
        const el = now - t0;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // fondu enchaîné tête → glyphes
        const fade = clamp(el / 240, 0, 1);
        if (fade < 1) {
          ctx.globalAlpha = 1 - fade;
          ctx.drawImage(headImg, cx - SIZE / 2, cy - SIZE / 2, SIZE, SIZE);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let done = 0, fontSize = 0;
        for (const p of parts) {
          const t = clamp((el - p.delay) / p.dur, 0, 1);
          if (t >= 1) { done++; continue; }
          let x, y;
          if (t < 0.3) {
            const e = easeOutCubic(t / 0.3);
            x = p.hx + p.ex * e;
            y = p.hy + p.ey * e;
          } else {
            const u = (t - 0.3) / 0.7, e = easeInOutCubic(u);
            const sx = p.hx + p.ex, sy = p.hy + p.ey;
            x = lerp(sx, p.tx, e) + Math.sin(u * Math.PI) * p.arc * 0.4;
            y = lerp(sy, p.ty, e) - Math.sin(u * Math.PI) * Math.abs(p.arc);
            if (u > 0.9) glow();
          }
          const k = clamp((t - 0.15) / 0.45, 0, 1);
          const rr = Math.round(lerp(p.col[0], GREEN[0], k));
          const gg = Math.round(lerp(p.col[1], GREEN[1], k));
          const bb = Math.round(lerp(p.col[2], GREEN[2], k));
          ctx.globalAlpha = fade * (t > 0.92 ? (1 - t) / 0.08 : 1);
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
          const size = Math.round(lerp(11, 7, t));
          if (size !== fontSize) { fontSize = size; ctx.font = `700 ${size}px Consolas, Monaco, monospace`; }
          ctx.fillText(p.ch, x, y);
        }
        if (done < parts.length && el < 5000) requestAnimationFrame(frame);
        else { c.remove(); resolve(); }
      };
      requestAnimationFrame(frame);
    });
  }

  // =====================================================================
  // Famille « bits + type » : les glyphes atterrissent dans les vrais champs
  // =====================================================================
  const MSG = 'coucou freulere';
  const FIELDS = { text: 'text-input', dec: 'decimal-input', bin: 'binary-input', hex: 'hex-input', b64: 'base64-input' };
  // Séparateur choisi dans l'app (espace ou rien) pour dec / bin / hex.
  const sepFor = f => {
    const el = document.querySelector(`input[data-sep-for~="${f}"]:checked`);
    return el && el.value === 'none' ? '' : ' ';
  };
  const ENC = {
    text: s => s,
    dec: s => [...s].map(c => c.charCodeAt(0).toString().padStart(3, '0')).join(sepFor('dec')),
    bin: s => [...s].map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(sepFor('bin')),
    hex: s => [...s].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(sepFor('hex')),
    b64: s => btoa(unescape(encodeURIComponent(s))),
  };
  const ALPHABET = {
    text: 'abcdefghijklmnopqrstuvwxyz',
    dec: '0123456789',
    bin: '01',
    hex: '0123456789abcdef',
    b64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  };
  const field = k => document.getElementById(FIELDS[k]);
  const panelOf = k => field(k) && field(k).closest('.panel');

  function parseColor(str) {
    str = (str || '').trim();
    if (str[0] === '#') {
      const h = str.length === 4 ? str.slice(1).split('').map(c => c + c).join('') : str.slice(1);
      return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
    }
    const m = str.match(/\d+(\.\d+)?/g);
    return m ? m.slice(0, 3).map(Number) : [51, 51, 51];
  }
  const cssVar = name => parseColor(getComputedStyle(document.documentElement).getPropertyValue(name));
  const formatColor = k => cssVar('--color-' + k);
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  function setField(ta, value, fire) {
    if (ta.value === value) return;
    ta.value = value;
    if (fire) ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Snapshot + annulation : une touche clavier ou un clic dans un champ
  // interrompt l'animation et restaure immédiatement l'état d'origine.
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

  function glyphCanvas() {
    const cv = makeCanvas();
    cv.font = '';
    cv.clear = () => {
      cv.ctx.setTransform(1, 0, 0, 1, 0, 0);
      cv.ctx.clearRect(0, 0, cv.c.width, cv.c.height);
      cv.ctx.setTransform(cv.dpr, 0, 0, cv.dpr, 0, 0);
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

  // Échantillonne la tête en grille : une cellule opaque = un glyphe 0/1 coloré.
  function headCells(cx, cy, grid, cell, bitsSeq, contrast = 1) {
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
          ch: bitsSeq ? bitsSeq[out.length % bitsSeq.length] : (Math.random() < 0.5 ? '0' : '1'),
          col: [0, 1, 2].map(k => (contrast === 1 ? data[i + k] : clamp((data[i + k] - 140) * contrast + 120, 0, 255))),
          size: cell * 1.45, weight: 700, gx, gy,
        });
      }
    }
    return out;
  }

  function clampCenter(p, size) {
    return {
      x: clamp(p.x, size / 2 + 12, innerWidth - size / 2 - 12),
      y: clamp(p.y, size / 2 + 12, innerHeight - size / 2 - 12),
    };
  }

  // Halo clair derrière un visage en glyphes, pour qu'il reste lisible sur l'app.
  function makeHalo(c, size, before) {
    const el = document.createElement('div');
    el.className = 'fz-halo';
    Object.assign(el.style, { left: c.x - size + 'px', top: c.y - size + 'px', width: size * 2 + 'px', height: size * 2 + 'px' });
    layer.insertBefore(el, before);
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 150 : 1000, easing: 'ease-out' });
    return el;
  }

  function glowPanel(panel, rgb) {
    if (!panel) return;
    const c = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    panel.animate([
      { boxShadow: `0 2px 8px rgba(0,0,0,.06), 0 0 0 0 rgba(${c},0)` },
      { boxShadow: `0 2px 8px rgba(0,0,0,.06), 0 0 0 4px rgba(${c},.35)`, offset: 0.3 },
      { boxShadow: `0 2px 8px rgba(0,0,0,.06), 0 0 0 0 rgba(${c},0)` },
    ], { duration: 1200, easing: 'ease-out' });
  }

  // Moteur commun : chaque glyphe vole d'une source vers une cible. Les cibles
  // sont atteintes dans l'ordre, étalées sur `spread` ms ; onLand(j) est appelé
  // à l'arrivée de la cible j (c'est là qu'on écrit dans le vrai champ).
  function flyGlyphs(cv, sess, o) {
    const { sources, targets, spread, dur } = o;
    const N = sources.length, M = targets.length, P = Math.max(N, M);
    const arriveAt = j => (M > 1 ? (j / (M - 1)) * spread : 0) + dur;
    const arcMax = o.arc == null ? 70 : o.arc;
    const parts = [];
    for (let p = 0; p < P; p++) {
      const j = Math.floor((p * M) / P);
      const d = dur * rand(0.7, 1);
      parts.push({ s: sources[Math.floor((p * N) / P)], t: targets[j], start: arriveAt(j) - d, d, arc: rand(-arcMax, arcMax), seed: Math.random() * 100 | 0 });
    }
    const flashes = [];
    let next = 0;
    const end = arriveAt(M - 1) + 300;
    const t0 = performance.now();
    return frames(sess, now => {
      const el = now - t0;
      while (next < M && el >= arriveAt(next)) {
        if (o.onLand) o.onLand(next);
        if (o.flash) flashes.push({ t: targets[next], at: el });
        next++;
      }
      cv.clear();
      const ctx = cv.ctx;
      let fadeIn = 1;
      if (o.intro) {
        fadeIn = clamp(el / 240, 0, 1);
        if (fadeIn < 1) {
          ctx.globalAlpha = 1 - fadeIn;
          ctx.drawImage(headImg, o.intro.x - o.intro.size / 2, o.intro.y - o.intro.size / 2, o.intro.size, o.intro.size);
        }
      }
      if (o.flash) {
        for (const f of flashes) {
          const k = (el - f.at) / 280;
          if (k >= 1) continue;
          ctx.globalAlpha = 0.35 * (1 - k);
          ctx.fillStyle = `rgb(${o.flash.join(',')})`;
          ctx.fillRect(f.t.x - f.t.w / 2 - 1, f.t.y - f.t.h / 2, f.t.w + 2, f.t.h);
        }
      }
      for (const p of parts) {
        let g, alpha = 1;
        if (el < p.start) {
          if (!o.drawWaiting) continue;
          g = p.s;
          alpha = fadeIn;
        } else if (el >= p.start + p.d) {
          if (!o.drawLanded) continue;
          g = p.t;
        } else {
          const u = (el - p.start) / p.d, e = easeInOutCubic(u), bump = Math.sin(u * Math.PI);
          let ch;
          if (o.alphabet) ch = u < 0.25 ? p.s.ch : u < 0.75 ? o.alphabet[(p.seed + Math.floor(el / 60)) % o.alphabet.length] : p.t.ch;
          else ch = u < 0.5 ? p.s.ch : p.t.ch;
          const col = o.mid
            ? (u < 0.5 ? mix(p.s.col, o.mid, u * 2) : mix(o.mid, p.t.col, (u - 0.5) * 2))
            : mix(p.s.col, p.t.col, u);
          g = {
            x: lerp(p.s.x, p.t.x, e) + bump * p.arc * 0.5,
            y: lerp(p.s.y, p.t.y, e) - bump * Math.abs(p.arc),
            ch, col, size: lerp(p.s.size, p.t.size, e), weight: u < 0.5 ? p.s.weight : p.t.weight,
          };
          alpha = fadeIn;
        }
        cv.glyph(g.ch, g.x, g.y, g.size, g.weight, g.col, alpha);
      }
      return el < end;
    });
  }

  // Efface plusieurs champs en parallèle, depuis la fin.
  function eraseFields(sess, tas, ms, fire) {
    const start = tas.map(t => t.value);
    return tween(reduced ? 150 : ms, t => {
      if (sess.aborted) return;
      tas.forEach((ta, k) => setField(ta, start[k].slice(0, Math.round(start[k].length * (1 - t))), fire));
    });
  }

  // ---------- prototype 4 : encode ----------
  // La tête se défait ligne par ligne ; chaque bit atterrit à sa place dans le
  // champ Binary et y devient du vrai texte. L'app décode en direct : le message
  // apparaît lettre par lettre dans TEXT.
  async function encode(origin) {
    const bin = field('bin');
    const sess = session();
    const cv = glyphCanvas();
    try {
      const value = ENC.bin(MSG);
      setField(bin, '', true);
      const GRID = 22, CELL = 7, SIZE = GRID * CELL;
      const c = clampCenter(origin, SIZE);
      const targets = charTargets(bin, value);
      await flyGlyphs(cv, sess, {
        sources: headCells(c.x, c.y, GRID, CELL), targets,
        spread: reduced ? 500 : 2400, dur: reduced ? 300 : 800,
        intro: { x: c.x, y: c.y, size: SIZE }, drawWaiting: true,
        mid: formatColor('bin'), flash: formatColor('bin'),
        onLand: j => setField(bin, value.slice(0, targets[j].i + 1), true),
      });
      if (sess.aborted) return;
      glowPanel(panelOf('text'), formatColor('text'));
      await sess.sleep(2400);
      if (!sess.aborted) await eraseFields(sess, [bin], 700, true);
    } finally {
      cv.c.remove();
      sess.end();
    }
  }

  // ---------- prototype 5 : relay ----------
  // Les bits remplissent Binary, puis sautent de champ en champ
  // (BIN → HEX → DEC → B64 → TEXT) en changeant de caractères et de couleur.
  async function relay(origin) {
    const ORDER = ['bin', 'hex', 'dec', 'b64', 'text'];
    const sess = session();
    const cv = glyphCanvas();
    try {
      ORDER.forEach(k => {
        setField(field(k), '', false);
        field(k).placeholder = '';
        panelOf(k).classList.remove('is-source', 'is-invalid');
      });
      const GRID = 22, CELL = 7, SIZE = GRID * CELL;
      const c = clampCenter(origin, SIZE);
      let sources = headCells(c.x, c.y, GRID, CELL);
      for (let k = 0; k < ORDER.length && !sess.aborted; k++) {
        const key = ORDER[k], ta = field(key), value = ENC[key](MSG);
        ORDER.forEach(o => panelOf(o).classList.toggle('is-source', o === key));
        const targets = charTargets(ta, value);
        await flyGlyphs(cv, sess, {
          sources, targets,
          spread: reduced ? 200 : k === 0 ? 1300 : 650, dur: reduced ? 250 : k === 0 ? 750 : 600,
          intro: k === 0 ? { x: c.x, y: c.y, size: SIZE } : null,
          drawWaiting: k === 0, alphabet: k === 0 ? null : ALPHABET[key],
          mid: formatColor(key), flash: formatColor(key), arc: k === 0 ? 70 : 50,
          onLand: j => setField(ta, value.slice(0, targets[j].i + 1), false),
        });
        sources = targets;
      }
      if (sess.aborted) return;
      glowPanel(panelOf('text'), formatColor('text'));
      await sess.sleep(2200);
      if (!sess.aborted) await eraseFields(sess, ORDER.map(field), 650, false);
    } finally {
      cv.c.remove();
      sess.end();
    }
  }

  // ---------- prototype 6 : portrait ----------
  // Le message est tapé dans TEXT, l'app le convertit ; puis le binaire quitte
  // le champ Binary pour dessiner le visage de freulere, qui scintille, et
  // retourne dans le champ.
  async function portrait(origin) {
    const txt = field('text'), bin = field('bin');
    const sess = session();
    const cv = glyphCanvas();
    let halo = null;
    try {
      setField(txt, '', true);
      for (const ch of MSG) {
        if (sess.aborted) return;
        setField(txt, txt.value + ch, true);
        await sess.sleep(reduced ? 10 : rand(45, 95));
      }
      await sess.sleep(450);
      if (sess.aborted) return;

      const value = bin.value;
      const binGlyphs = charTargets(bin, value);
      const seq = binGlyphs.map(g => g.ch);
      // le visage se forme au centre de l'écran, sur un halo pour rester lisible
      const GRID = 28, CELL = clamp(Math.round(Math.min(innerWidth, innerHeight) / 80), 6, 9), SIZE = GRID * CELL;
      const c = { x: innerWidth / 2, y: innerHeight / 2 };
      const face = headCells(c.x, c.y, GRID, CELL, seq, 1.6);
      halo = makeHalo(c, SIZE, cv.c);

      bin.style.color = 'transparent';
      await flyGlyphs(cv, sess, {
        sources: binGlyphs, targets: face,
        spread: reduced ? 200 : 900, dur: reduced ? 300 : 900,
        drawWaiting: true, drawLanded: true, mid: formatColor('bin'), arc: 90,
      });
      if (sess.aborted) return;

      // le visage « vit » : bits qui basculent + ligne de scan
      const t0 = performance.now(), HOLD = reduced ? 600 : 1800;
      const top = c.y - SIZE / 2, scanCol = formatColor('bin');
      await frames(sess, now => {
        const el = now - t0;
        cv.clear();
        const scanY = top + ((el % 900) / 900) * (SIZE + 40) - 20;
        for (const g of face) {
          if (Math.random() < 0.02) g.ch = g.ch === '0' ? '1' : '0';
          const k = clamp(1 - Math.abs(g.y - scanY) / 14, 0, 1);
          cv.glyph(g.ch, g.x, g.y, g.size * (1 + 0.25 * k), g.weight, mix(g.col, scanCol, k * 0.8), 1);
        }
        return el < HOLD;
      });
      if (sess.aborted) return;

      halo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 150 : 700, easing: 'ease-in', fill: 'forwards' });
      await flyGlyphs(cv, sess, {
        sources: face, targets: binGlyphs,
        spread: reduced ? 200 : 700, dur: reduced ? 300 : 800,
        drawWaiting: true, drawLanded: true, mid: formatColor('bin'), arc: 60,
      });
      bin.style.color = '';
      cv.clear();
      if (sess.aborted) return;
      await sess.sleep(500);
      for (let n = txt.value.length - 1; n >= 0 && !sess.aborted; n--) {
        setField(txt, txt.value.slice(0, n), true);
        await sess.sleep(28);
      }
    } finally {
      if (halo) halo.remove();
      cv.c.remove();
      sess.end();
    }
  }

  // ---------- prototype 7 : remix (encode × portrait) ----------
  // La tête rejoint le centre en grandissant, un scan la change en binaire
  // (les vrais bits de « coucou freulere »), les bits dansent, puis ils
  // alimentent le champ Binary un par un ; l'app décode le message dans TEXT.
  async function remix(origin) {
    const bin = field('bin');
    const sess = session();
    const cv = glyphCanvas();
    let halo = null, big = null;
    try {
      const GRID = 28, CELL = clamp(Math.round(Math.min(innerWidth, innerHeight) / 80), 6, 9), SIZE = GRID * CELL;
      const c = { x: innerWidth / 2, y: innerHeight / 2 };
      const top = c.y - SIZE / 2, left = c.x - SIZE / 2;
      const value = ENC.bin(MSG);
      const face = headCells(c.x, c.y, GRID, CELL, value.replace(/ /g, ''), 1.6);
      face.forEach(g => { g.home = g.ch; });
      const green = formatColor('bin');

      // 1. la tête vole au centre en grandissant
      halo = makeHalo(c, SIZE, cv.c);
      big = document.createElement('img');
      big.src = headImg.src;
      big.alt = '';
      big.className = 'fz-big';
      Object.assign(big.style, { width: SIZE + 'px', height: SIZE + 'px' });
      layer.insertBefore(big, cv.c);
      const s0 = 90 / SIZE;
      const place = (x, y, s, r) => { big.style.transform = `translate(${x - SIZE / 2}px, ${y - SIZE / 2}px) scale(${s}) rotate(${r}deg)`; };
      place(origin.x, origin.y, s0, 0);
      await tween(reduced ? 250 : 850, t => {
        if (sess.aborted) return;
        const e = easeInOutCubic(t), arc = Math.sin(t * Math.PI);
        place(lerp(origin.x, c.x, e), lerp(origin.y, c.y, e) - arc * 70, lerp(s0, 1, e), arc * -12);
      });
      if (sess.aborted) return;
      await sess.sleep(150);

      // 2. scan de haut en bas : la photo devient binaire
      const SCAN = reduced ? 250 : 900;
      let t0 = performance.now();
      await frames(sess, now => {
        const t = clamp((now - t0) / SCAN, 0, 1);
        const scanY = top - 12 + (SIZE + 24) * t;
        big.style.clipPath = `inset(${clamp(((scanY - top) / SIZE) * 100, 0, 100)}% 0 0 0)`;
        cv.clear();
        for (const g of face) {
          if (g.y > scanY + 4) continue;
          const k = clamp(1 - (scanY - g.y) / 22, 0, 1);
          cv.glyph(g.ch, g.x, g.y, g.size * (1 + 0.3 * k), g.weight, mix(g.col, green, k), 1);
        }
        cv.ctx.globalAlpha = 0.55 * Math.sin(t * Math.PI);
        cv.ctx.fillStyle = `rgb(${green.join(',')})`;
        cv.ctx.fillRect(left - 10, scanY - 1, SIZE + 20, 2);
        return t < 1;
      });
      big.remove();
      big = null;
      if (sess.aborted) return;

      // 3. les bits dansent : vague, sauts sur le temps, balancement, pirouette
      const DANCE = reduced ? 600 : 2800, BEAT = 400, SPIN0 = 1200, SPIN = 800;
      let lastBeat = -1;
      t0 = performance.now();
      await frames(sess, now => {
        const el = now - t0, s = el / 1000;
        const env = clamp(el / 300, 0, 1) * clamp((DANCE - el) / 500, 0, 1);
        const beat = Math.floor(el / BEAT), pulse = Math.exp(-((el % BEAT) / BEAT) * 5);
        if (beat !== lastBeat) {
          lastBeat = beat;
          const settle = el > DANCE - 600;
          for (const g of face) g.ch = settle ? g.home : (Math.random() < 0.15 ? (g.ch === '0' ? '1' : '0') : g.ch);
        }
        const sway = Math.sin(s * TAU * 0.6) * 16 * env;
        const spin = reduced ? 1 : Math.cos(easeInOutCubic(clamp((el - SPIN0) / SPIN, 0, 1)) * TAU);
        cv.clear();
        for (const g of face) {
          const jumper = (g.gy + beat) % 2 === 0;
          const wave = Math.sin(s * TAU * 1.3 + g.gx * 0.5) * 5;
          const jump = jumper ? pulse * 8 : 0;
          const x = c.x + (g.x + sway - c.x) * spin;
          const y = g.y + (wave - jump) * env;
          const k = pulse * env * (jumper ? 1 : 0.25);
          cv.glyph(g.ch, x, y, g.size * (1 + 0.35 * k), g.weight, mix(g.col, green, k * 0.7), 1);
        }
        return el < DANCE;
      });
      face.forEach(g => { g.ch = g.home; });
      if (sess.aborted) return;

      // 4. les bits alimentent le champ Binary, l'app décode dans TEXT
      setField(bin, '', true);
      halo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 150 : 1600, easing: 'ease-in', fill: 'forwards' });
      const targets = charTargets(bin, value);
      await flyGlyphs(cv, sess, {
        sources: face, targets,
        spread: reduced ? 500 : 2400, dur: reduced ? 300 : 850,
        drawWaiting: true, mid: green, flash: green, arc: 80,
        onLand: j => setField(bin, value.slice(0, targets[j].i + 1), true),
      });
      if (sess.aborted) return;
      glowPanel(panelOf('text'), formatColor('text'));
      await sess.sleep(2400);
      if (!sess.aborted) await eraseFields(sess, [bin], 700, true);
    } finally {
      if (big) big.remove();
      if (halo) halo.remove();
      cv.c.remove();
      sess.end();
    }
  }

  const EFFECTS = { rain, type, bits, encode, relay, portrait, remix };

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
