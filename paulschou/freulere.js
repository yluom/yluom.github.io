/*
 * Easter egg « freulere » pour le Paulschou Converter.
 *
 * Après 10 s passées sur la page (onglet visible), la tête de freulere fait un
 * sneak peek de 0,5 s depuis un coin ou un bord aléatoire, disparaît 5 s, puis
 * revient ailleurs. Si la souris survole la tête, elle reste visible tant que
 * le survol dure (sinon elle est quasi impossible à attraper).
 *
 * Clic sur la tête → une animation. Trois prototypes :
 *   rain : pluie de têtes (canvas, gravité, rebonds, fondu)
 *   type : la tête vole jusqu'au champ TEXT et y tape un message ; les autres
 *          champs se convertissent en direct. Elle efface ensuite et l'état
 *          d'origine est restauré à l'identique (valeurs, classes, curseur).
 *          Une frappe clavier ou un clic dans un champ interrompt tout.
 *   bits : la tête se désintègre en 0/1 aspirés par le champ Binary
 *
 * Choix du prototype : ?egg=rain | ?egg=type | ?egg=bits (le premier délai
 * passe alors à 1 s pour tester). Sans paramètre, les prototypes s'enchaînent
 * à chaque clic.
 *
 * Contraintes : rien n'est chargé avant les 10 s, overlay en
 * pointer-events:none (seule la tête est cliquable), animations sur transform
 * / canvas uniquement, aucun accès au code de l'app (on passe par le DOM et
 * des événements "input" standards).
 */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const EFFECT_NAMES = ['rain', 'type', 'bits'];
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
  let effectIndex = Math.floor(Math.random() * EFFECT_NAMES.length);

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

    let name = forced || EFFECT_NAMES[effectIndex++ % EFFECT_NAMES.length];
    if (name === 'type' && !isInView(document.getElementById('text-input'))) name = 'rain';
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
    const fields = [...document.querySelectorAll('.converter-grid textarea')].map(el => [el, el.value]);
    const panels = [...document.querySelectorAll('.converter-grid .panel')].map(el => [el, el.className]);
    const active = document.activeElement;
    const sel = active && active.tagName === 'TEXTAREA'
      ? { el: active, start: active.selectionStart, end: active.selectionEnd, dir: active.selectionDirection }
      : null;
    return () => {
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

  const EFFECTS = { rain, type, bits };

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
