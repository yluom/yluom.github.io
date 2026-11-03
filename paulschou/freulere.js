/*
 * Easter egg « freulere » pour le Paulschou Converter.
 *
 * Après 3 s passées sur la page (onglet visible), la tête de freulere fait un
 * sneak peek de 1,6 s depuis un coin ou un bord aléatoire, disparaît 3 s, puis
 * revient ailleurs. Après l'animation du clic, elle revient au bout de 5 s.
 * Si la souris survole la tête, elle reste visible tant que le survol dure
 * (sinon elle est quasi impossible à attraper).
 *
 * Pendant le peek, un « appât » donne envie de cliquer, tiré au hasard parmi
 * glitch, ressort et orbite (jamais deux fois le même d'affilée). ?lure=<nom>
 * en force un, ?lure=tous tire parmi tous, prototypes compris :
 *   - glitch : la tête parasite (aberration chromatique, tremblements) et
 *     passe une fraction de seconde en binaire, comme si le signal décrochait ;
 *   - ressort : la tête jaillit sur un ressort de boîte à surprise, fait un
 *     tour complet façon hibou, puis redescend ;
 *   - orbite : un mini satellite Iridium tourne autour de la tête (il passe
 *     derrière) en émettant des pings, et une pastille « 1 » de notification
 *     apparaît sur le front ;
 *   - psst (prototype) : une bulle de pensée tape « psst » en binaire, puis le
 *     décode comme le ferait le convertisseur ;
 *   - formats (prototype) : le visage passe par les 5 formats de l'app (TXT,
 *     DEC, BIN, HEX, B64), écrit avec l'encodage de « freulere » dans la
 *     couleur du format, avec l'étiquette du panneau à côté ;
 *   - copy (prototype) : le visage est sélectionné comme du texte, un bouton
 *     Copy de l'app apparaît, un curseur clique dessus (« Copied ») et une
 *     copie de la tête s'envole.
 * Un clic pendant l'appât fonctionne partout sur la tête, même en l'air.
 * Avec prefers-reduced-motion, seule la pastille apparaît, sans mouvement.
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
 * Se servir de l'app (saisie ou focus dans un champ, clic sur un contrôle,
 * Échap) interrompt tout et restaure immédiatement ; faire défiler la page,
 * y compris au doigt sur les champs, ne l'interrompt pas.
 *
 * ?egg dans l'URL : première apparition au bout de 1 s (pour tester).
 *
 * Contraintes : rien n'est chargé avant les 3 s, overlay en
 * pointer-events:none (seule la tête est cliquable), animations sur transform
 * / canvas uniquement, aucun accès au code de l'app (on passe par le DOM et
 * ses propres événements "input" / "blur").
 */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);

  const CFG = {
    firstDelay: params.has('egg') ? 1000 : 3000,  // temps visible avant la 1re apparition
    peekHold: 1600,         // durée du sneak peek (au moins la durée de l'appât)
    peekGap: 3000,          // pause entre deux apparitions
    slide: 220,             // durée d'entrée / sortie
    afterEffectGap: 5000,   // pause après l'animation
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
    .fz-lure { position: absolute; left: 0; top: 0; pointer-events: none; }
    .fz-hit { pointer-events: auto; cursor: pointer; -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; -webkit-user-drag: none; }
    img.fz-lure { filter: drop-shadow(0 3px 8px rgba(0, 0, 0, .18)); will-change: transform; }
    .fz-spring { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
    .fz-mini { position: absolute; left: 0; top: 0; width: 0; height: 0; will-change: transform; }
    .fz-mini svg { position: absolute; left: -14px; top: -9px; width: 28px; height: 18px; overflow: visible; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .25)); }
    .fz-ping { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; border: 1.5px solid currentColor; opacity: 0; }
    .fz-up { position: absolute; left: 0; top: 0; width: 0; height: 0; }
    .fz-dot { position: absolute; border-radius: 50%; background: var(--panel-bg, #fff); border: 1px solid var(--border, #e0e0e0);
      box-shadow: 0 1px 3px rgba(0, 0, 0, .12); transform: scale(0); }
    .fz-bubble { position: absolute; left: 0; top: 0; box-sizing: border-box; padding: 6px 10px; border-radius: 14px; white-space: pre; text-align: center;
      background: var(--panel-bg, #fff); border: 1px solid var(--border, #e0e0e0); box-shadow: 0 3px 10px rgba(0, 0, 0, .15);
      font: 700 10px/1.35 Consolas, Monaco, "Courier New", monospace; color: var(--color-bin, #3a9a5b); opacity: 0; }
    .fz-bubble.is-text { font-size: 17px; line-height: 1.6; color: var(--text, #333); }
    .fz-tag { position: absolute; left: 0; top: 0; white-space: nowrap; padding: .2rem .5rem; border-radius: 4px;
      font: 600 .65rem/1.4 "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-transform: uppercase; letter-spacing: .05em;
      color: var(--on-color, #fff); box-shadow: 0 2px 6px rgba(0, 0, 0, .2); opacity: 0; }
    .fz-copy { position: absolute; left: 0; top: 0; white-space: nowrap; box-shadow: 0 2px 8px rgba(0, 0, 0, .15); opacity: 0; }
    .fz-copy.icon-btn { font-family: "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .fz-cursor { position: absolute; left: 0; top: 0; width: 16px; height: 22px; opacity: 0; pointer-events: none; transform-origin: 0 0; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .3)); }
    .fz-wrap img.fz-ghost { position: absolute; opacity: 0; pointer-events: none; }
    .fz-badge { position: absolute; min-width: 20px; height: 20px; margin: -10px 0 0 -10px; padding: 0 5px; box-sizing: border-box; border-radius: 10px;
      background: #e5484d; color: #fff; border: 2px solid var(--panel-bg, #fff); box-shadow: 0 2px 6px rgba(0, 0, 0, .3);
      font: 700 11px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; transform: scale(0); }
  `;

  // Satellite Iridium stylisé (corps doré, panneaux solaires, 3 antennes
  // MMA, les panneaux réfléchissants à l'origine des « Iridium flares »).
  const SAT_SVG = `<svg viewBox="-40 -26 80 52" width="72" height="47" aria-hidden="true" stroke-linejoin="round">
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
    </svg>`;

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
  let lure = null;
  // Éléments survolés (le peek et les morceaux cliquables des appâts) : la
  // tête reste tant que l'un d'eux est sous le pointeur.
  const hovering = new Set();

  async function peekOnce() {
    const ctl = new AbortController();
    const s = ctl.signal;
    peekCtl = ctl;
    placeRandom();
    anchor.style.visibility = 'visible';
    try {
      await until(animateTransform(wrap, HIDDEN, PEEK, CFG.slide, EASE_OUT), s);
      if (s.aborted) return;
      lure = startLure();
      await until(Promise.all([sleep(CFG.peekHold), lure.done]), s);
      while (hovering.size && !s.aborted) await until(sleep(100), s);
      if (s.aborted) return;
      await until(animateTransform(wrap, PEEK, HIDDEN, CFG.slide, EASE_IN), s);
      if (!s.aborted) anchor.style.visibility = 'hidden';
    } finally {
      stopLure();
      peekCtl = null;
    }
  }

  function stopLure() {
    if (!lure) return;
    const l = lure;
    lure = null;
    l.stop();
    l.els.forEach(el => { hovering.delete(el); el.remove(); });
  }

  function grab(e) {
    if (!peekCtl || peekCtl.signal.aborted) return;
    e.preventDefault();
    const extra = lure && lure.pose ? lure.pose() : null;
    stopLure();
    effectPromise = caught(extra);
    peekCtl.abort();
  }

  function hittable(el) {
    el.addEventListener('pointerenter', () => hovering.add(el));
    el.addEventListener('pointerleave', () => hovering.delete(el));
    el.addEventListener('pointerdown', grab);
    return el;
  }
  hittable(peekImg);

  // Position, taille et rotation à l'écran de la tête visible dans le peek.
  // `extra` : déplacement de la tête par l'appât (repère du peek, px / deg).
  function headPose(extra) {
    const x = extra || { dx: 0, dy: 0, rot: 0 };
    const w = wrap.offsetWidth, h = wrap.offsetHeight;
    const m = new DOMMatrixReadOnly(getComputedStyle(wrap).transform);
    const lx = m.m41 + HEAD_IN_PEEK.x * w + x.dx;
    const ly = -h + m.m42 + HEAD_IN_PEEK.y * h + x.dy;
    const r = (spot.r * Math.PI) / 180;
    return {
      x: spot.x + lx * Math.cos(r) - ly * Math.sin(r),
      y: spot.y + lx * Math.sin(r) + ly * Math.cos(r),
      size: HEAD_IN_PEEK.size * w,
      rot: spot.r + x.rot,
    };
  }

  // ---------- appâts : donner envie de cliquer ----------
  // Chaque appât reçoit la géométrie du peek (px, repère du wrap) et renvoie
  // { done, stop, els, pose? } : `done` résout quand il est fini (la tête est
  // revenue au repos), `stop` l'arrête net, `els` sont ses éléments (retirés
  // au stop), `pose()` le déplacement courant de la tête.
  function lureGeom() {
    const w = wrap.offsetWidth, h = wrap.offsetHeight, size = HEAD_IN_PEEK.size * w;
    return { w, h, size, cx: HEAD_IN_PEEK.x * w, cy: HEAD_IN_PEEK.y * h };
  }

  function lureEl(tag, cls, g) {
    const el = document.createElement(tag);
    el.className = cls;
    if (g) Object.assign(el.style, { left: g.cx - g.size / 2 + 'px', top: g.cy - g.size / 2 + 'px', width: g.size + 'px', height: g.size + 'px' });
    wrap.appendChild(el);
    return el;
  }

  // Petit séquenceur : fn(el) appelée à chaque frame (el = ms écoulées)
  // jusqu'à `duration` ou jusqu'au stop.
  function timeline(duration, fn) {
    let stopped = false;
    const done = new Promise(resolve => {
      const t0 = performance.now();
      const step = now => {
        if (stopped) return resolve();
        const el = Math.min(duration, now - t0);
        fn(el);
        if (el < duration) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    return { done, stop: () => { stopped = true; } };
  }

  // 1. Glitch : le signal décroche. Tremblements + aberration chromatique,
  //    puis la tête passe en binaire (les bits de « coucou freulere ») un
  //    instant, deux fois.
  function lureGlitch(g) {
    const GRID = 16, cell = g.size / GRID;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = lureEl('canvas', 'fz-lure fz-hit', g);
    hittable(c);
    c.width = c.height = Math.round(g.size * dpr);
    c.style.opacity = '0';
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const green = formatColor('bin');
    const cells = headCells(g.size / 2, g.size / 2, GRID, cell, toBinary(MSG).replace(/ /g, ''));
    ctx.font = `700 ${cell * 1.45}px Consolas, Monaco, "Courier New", monospace`;
    for (const k of cells) {
      ctx.fillStyle = `rgb(${mix(k.col, green, 0.45).map(v => v | 0).join(',')})`;
      ctx.fillText(k.ch, k.x, k.y);
    }
    const RGB = 'drop-shadow(-3px 0 0 rgba(255, 0, 90, .8)) drop-shadow(3px 0 0 rgba(0, 210, 255, .8))';
    const shake = [
      { transform: 'none', filter: 'none' },
      { transform: 'translate(-3px, 1px) skewX(6deg)', filter: RGB },
      { transform: 'translate(4px, -1px)', filter: RGB + ' hue-rotate(90deg) saturate(3)' },
      { transform: 'translate(-2px, 0) skewX(-8deg)', filter: RGB },
      { transform: 'translate(2px, 1px)', filter: 'none' },
      { transform: 'none', filter: 'none' },
    ];
    const anims = [];
    const flash = on => { c.style.opacity = on ? '1' : '0'; peekImg.classList.toggle('is-headless', on); };
    const tl = timeline(1450, el => {
      if (!anims.length && el >= 0) anims.push(peekImg.animate(shake, { duration: 260, easing: 'steps(5, end)' }));
      if (anims.length === 1 && el >= 820) anims.push(peekImg.animate(shake, { duration: 200, easing: 'steps(5, end)' }));
      const bin = (el >= 200 && el < 420) || (el >= 980 && el < 1080);
      flash(bin);
      // tranche décalée pendant le binaire, comme une image qui saute
      if (bin) c.style.transform = `translateX(${(Math.random() < 0.5 ? -1 : 1) * rand(0, 4)}px)`;
    });
    return {
      done: tl.done, els: [c],
      stop: () => { tl.stop(); anims.forEach(a => a.cancel()); flash(false); },
    };
  }

  // 2. Ressort : la tête jaillit sur un ressort de boîte à surprise, fait un
  //    tour complet façon hibou en haut, puis redescend avec un rebond.
  function lureRessort(g) {
    const head = lureEl('img', 'fz-lure fz-hit', g);
    head.src = headImg.src;
    head.alt = '';
    head.draggable = false;
    hittable(head);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'fz-spring');
    svg.setAttribute('width', g.w);
    svg.setAttribute('height', g.h * 2);
    const coil = document.createElementNS(NS, 'path');
    const shine = document.createElementNS(NS, 'path');
    coil.setAttribute('fill', 'none');
    coil.setAttribute('stroke', '#7d8895');
    coil.setAttribute('stroke-width', '3');
    shine.setAttribute('fill', 'none');
    shine.setAttribute('stroke', '#dfe5ec');
    shine.setAttribute('stroke-width', '1');
    coil.setAttribute('stroke-linecap', 'round');
    coil.setAttribute('stroke-linejoin', 'round');
    svg.append(coil, shine);
    wrap.insertBefore(svg, head);
    peekImg.classList.add('is-headless');

    // le bas du ressort est sous le bord de l'écran, le haut sous le menton
    const base = g.h * 0.98, LOOPS = 7, AMP = g.w * 0.09, D = g.h * 0.62;
    const easeOutBack = t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
    let dx = 0, dy = 0, rot = 0;
    const tl = timeline(1450, el => {
      let lift, sq = 1;
      if (el < 140) { lift = -0.06 * smoothstep(el / 140); sq = 1 - 0.1 * smoothstep(el / 140); } // on se tasse
      else if (el < 460) lift = lerp(-0.06, 1, easeOutBack((el - 140) / 320));                    // boing
      else if (el < 1100) lift = 1 + 0.04 * Math.sin((el - 460) / 70) * (1 - (el - 460) / 640);   // en haut, ça vibre
      else lift = 1 - easeOutBounce((el - 1100) / 350);                                            // retour
      const spin = el < 480 ? 0 : el < 1000 ? 360 * easeInOutCubic((el - 480) / 520) : 360;
      dy = -D * lift;
      dx = Math.sin(el / 90) * g.w * 0.05 * clamp(lift, 0, 1);
      rot = spin % 360;
      head.style.transform = `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(${2 - sq}, ${sq})`;
      const top = g.cy + g.size * 0.36 + dy;
      let d = `M${g.cx} ${base}`, e = '';
      for (let i = 1; i <= LOOPS * 2; i++) {
        const t = i / (LOOPS * 2);
        const x = lerp(g.cx, g.cx + dx, t) + (i < LOOPS * 2 ? (i % 2 ? AMP : -AMP) : 0);
        const y = lerp(base, top, t);
        d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
        if (i % 2) e += `M${(x - 1).toFixed(1)} ${(y - 1).toFixed(1)}l-3 -1`;
      }
      coil.setAttribute('d', d);
      shine.setAttribute('d', e);
    });
    return {
      done: tl.done, els: [head, svg],
      pose: () => ({ dx, dy, rot }),
      stop: () => { tl.stop(); peekImg.classList.remove('is-headless'); },
    };
  }

  function easeOutBounce(t) {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  }

  // 3. Orbite : un mini Iridium tourne autour de la tête comme une lune (il
  //    passe derrière), émet des pings, et une pastille « 1 » apparaît sur le
  //    front, comme une notification pas lue.
  function lureOrbite(g) {
    const badge = lureEl('div', 'fz-badge fz-hit');
    badge.textContent = '1';
    hittable(badge);
    Object.assign(badge.style, { left: g.cx + g.size * 0.26 + 'px', top: g.cy - g.size * 0.3 + 'px' });
    const pop = badge.animate([
      { transform: 'scale(0)' }, { transform: 'scale(1.35)', offset: 0.6 }, { transform: 'scale(1)' },
    ], { duration: reduced ? 1 : 380, delay: reduced ? 0 : 250, easing: 'ease-out', fill: 'forwards' });
    if (!reduced) badge.animate([
      { boxShadow: '0 2px 6px rgba(0,0,0,.3), 0 0 0 0 rgba(229,72,77,.6)' },
      { boxShadow: '0 2px 6px rgba(0,0,0,.3), 0 0 0 9px rgba(229,72,77,0)' },
    ], { duration: 900, delay: 650, iterations: Infinity });
    if (reduced) return { done: Promise.resolve(), els: [badge], stop: () => { pop.cancel(); } };

    const sat = lureEl('div', 'fz-mini');
    sat.innerHTML = SAT_SVG;
    const pings = [];
    const green = `rgb(${formatColor('bin').join(',')})`;
    const RX = g.size * 0.62, RY = g.size * 0.15, TILT = (-14 * Math.PI) / 180, TURNS = 1.75, DUR = 1500;
    let nextPing = 200;
    const tl = timeline(DUR, el => {
      const a = -Math.PI / 2 + TAU * TURNS * easeInOutCubic(el / DUR) + Math.PI;
      const ex = RX * Math.cos(a), ey = RY * Math.sin(a);
      const x = g.cx + ex * Math.cos(TILT) - ey * Math.sin(TILT);
      const y = g.cy - g.size * 0.36 + ex * Math.sin(TILT) + ey * Math.cos(TILT);
      const front = Math.sin(a) > 0;
      const depth = 0.75 + 0.25 * Math.sin(a);
      sat.style.zIndex = front ? '2' : '-1';
      sat.style.opacity = String(clamp(el / 150, 0, 1) * clamp((DUR - el) / 200, 0, 1));
      sat.style.transform = `translate(${x}px, ${y}px) rotate(${(Math.cos(a) * 25).toFixed(1)}deg) scale(${depth})`;
      if (el >= nextPing && el < DUR - 250) {
        nextPing += 380;
        const p = lureEl('div', 'fz-ping');
        Object.assign(p.style, { left: x + 'px', top: y + 'px', color: green, zIndex: front ? '2' : '-1' });
        p.animate([{ opacity: 0.9, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(3.2)' }], { duration: 650, easing: 'ease-out', fill: 'forwards' });
        pings.push(p);
      }
    });
    badge.style.zIndex = '3';
    return {
      done: tl.done, els: [badge, sat, ...pings], stop: () => { tl.stop(); pings.forEach(p => p.remove()); },
    };
  }

  // Place `el` au-dessus du crâne (vers l'intérieur de l'écran, quel que soit
  // le bord), redressé à l'horizontale. `gap` : marge au crâne en px.
  function placeUp(el, g, gap) {
    const box = lureEl('div', 'fz-up');
    box.appendChild(el);
    const bw = el.offsetWidth, bh = el.offsetHeight;
    Object.assign(el.style, { marginLeft: -bw / 2 + 'px', marginTop: -bh / 2 + 'px' });
    const r = (spot.r * Math.PI) / 180;
    const reach = Math.abs(Math.sin(r)) * bw / 2 + Math.abs(Math.cos(r)) * bh / 2;
    const ax = g.cx + g.size * 0.12, top = g.cy - g.size * 0.47;
    Object.assign(box.style, { left: ax + 'px', top: top - gap - reach + 'px' });
    el.style.transform = `rotate(${-spot.r}deg)`;
    return box;
  }

  // 5. Psst : une bulle de pensée tape « psst » en binaire, bit à bit, puis
  //    le décode comme le convertisseur. La bulle reste à l'endroit quel que
  //    soit le bord.
  function lurePsst(g) {
    const WORD = 'psst';
    const bytes = [...WORD].map(ch => ch.charCodeAt(0).toString(2).padStart(8, '0'));
    const lines = [bytes.slice(0, 2).join(' '), bytes.slice(2).join(' ')];
    const bubble = document.createElement('div');
    bubble.className = 'fz-bubble fz-hit';
    hittable(bubble);
    bubble.textContent = lines.join('\n');
    const think = placeUp(bubble, g, 34);
    // taille figée : le texte décodé tient dans la bulle des bits
    Object.assign(bubble.style, { width: bubble.offsetWidth + 'px', height: bubble.offsetHeight + 'px' });
    const top = g.cy - g.size * 0.47, ax = g.cx + g.size * 0.12;
    const dots = [[6, 4], [18, 6], [30, 8]].map(([d, sz]) => {
      const el = lureEl('div', 'fz-dot');
      Object.assign(el.style, { left: lerp(g.cx, ax, d / 34) - sz / 2 + 'px', top: top - d - sz / 2 + 'px', width: sz + 'px', height: sz + 'px' });
      return el;
    });
    const anims = [];
    dots.forEach((d, i) => anims.push(d.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 160, delay: i * 90, easing: 'ease-out', fill: 'forwards' })));
    anims.push(bubble.animate([
      { opacity: 0, transform: `rotate(${-spot.r}deg) scale(.4)` },
      { opacity: 1, transform: `rotate(${-spot.r}deg) scale(1)` },
    ], { duration: 220, delay: 270, easing: 'ease-out', fill: 'forwards' }));
    const total = bytes.join('').length;
    let shown = -1, decoded = false;
    const tl = timeline(1500, el => {
      if (el < 1000) {
        const n = Math.floor(clamp((el - 330) / 620, 0, 1) * total);
        if (n !== shown) {
          shown = n;
          let k = 0;
          bubble.textContent = lines.map(l => [...l].map(ch => (ch === ' ' ? ' ' : k++ < n ? ch : '·')).join('')).join('\n');
        }
      } else if (!decoded) {
        decoded = true;
        bubble.classList.add('is-text');
        bubble.textContent = WORD + ' !';
        anims.push(bubble.animate([
          { transform: `rotate(${-spot.r}deg) scale(1)` },
          { transform: `rotate(${-spot.r - 8}deg) scale(1.15)` },
          { transform: `rotate(${-spot.r + 6}deg) scale(1.1)` },
          { transform: `rotate(${-spot.r}deg) scale(1)` },
        ], { duration: 360, easing: 'ease-out', composite: 'replace' }));
      }
    });
    return { done: tl.done, els: [think, ...dots], stop: () => { tl.stop(); anims.forEach(a => a.cancel()); } };
  }

  // 6. Formats : le visage passe par les 5 formats de l'app, écrit avec
  //    l'encodage de « freulere », dans la couleur du format, avec
  //    l'étiquette du panneau (TXT, DEC…) à côté.
  const NAME = 'freulere';
  const FORMATS = [
    ['text', 'TXT', () => NAME],
    ['dec', 'DEC', () => [...NAME].map(c => String(c.charCodeAt(0)).padStart(3, '0')).join('')],
    ['bin', 'BIN', () => [...NAME].map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join('')],
    ['hex', 'HEX', () => [...NAME].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')],
    ['b64', 'B64', () => btoa(NAME)],
  ];
  function lureFormats(g) {
    const GRID = 15, cell = g.size / GRID;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = lureEl('canvas', 'fz-lure fz-hit', g);
    hittable(c);
    c.width = c.height = Math.round(g.size * dpr);
    c.style.opacity = '0';
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${cell * 1.4}px Consolas, Monaco, "Courier New", monospace`;
    const faces = FORMATS.map(([key, label, seq]) => ({
      key, label, col: formatColor(key), cells: headCells(g.size / 2, g.size / 2, GRID, cell, seq()),
    }));
    const tag = document.createElement('span');
    tag.className = 'fz-tag';
    tag.textContent = 'TXT';
    const tagBox = placeUp(tag, g, 6);
    const anims = [];
    let cur = -1;
    const show = i => {
      cur = i;
      const on = i >= 0 && i < faces.length;
      peekImg.classList.toggle('is-headless', on);
      c.style.opacity = on ? '1' : '0';
      tag.style.opacity = on ? '1' : '0';
      if (!on) return;
      const f = faces[i];
      ctx.clearRect(0, 0, g.size, g.size);
      for (const k of f.cells) {
        ctx.fillStyle = `rgb(${mix(k.col, f.col, 0.55).map(v => v | 0).join(',')})`;
        ctx.fillText(k.ch, k.x, k.y);
      }
      tag.textContent = f.label;
      tag.style.background = `rgb(${f.col.join(',')})`;
      // bascule façon afficheur à palettes
      anims.push(c.animate([{ transform: 'scaleY(.15)' }, { transform: 'scaleY(1)' }], { duration: 110, easing: 'ease-out' }));
      anims.push(tag.animate([
        { transform: `rotate(${-spot.r}deg) scale(1.3)` }, { transform: `rotate(${-spot.r}deg) scale(1)` },
      ], { duration: 160, easing: 'ease-out' }));
    };
    const STEP = 230, START = 150;
    const tl = timeline(1450, el => {
      const i = el < START ? -1 : Math.floor((el - START) / STEP);
      if (i !== cur) show(i);
    });
    return {
      done: tl.done, els: [c, tagBox],
      stop: () => { tl.stop(); anims.forEach(a => a.cancel()); show(-1); },
    };
  }

  // 7. Copy : le visage est sélectionné comme du texte, un bouton Copy de
  //    l'app apparaît, un curseur clique dessus (« Copied ») et une copie de
  //    la tête s'envole.
  function lureCopy(g) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sel = lureEl('canvas', 'fz-lure', g);
    sel.width = sel.height = Math.round(g.size * dpr);
    const sctx = sel.getContext('2d');
    sctx.scale(dpr, dpr);
    const ROWS = 7, rh = g.size / ROWS;
    const drawSel = p => { // p ∈ [0,1] : avancée du glisser-sélectionner
      sctx.clearRect(0, 0, g.size, g.size);
      sctx.globalCompositeOperation = 'source-over';
      sctx.fillStyle = 'rgba(56, 140, 255, .38)'; // bleu de sélection de texte
      const at = p * ROWS, row = Math.floor(at);
      for (let r = 0; r < Math.min(row, ROWS); r++) sctx.fillRect(0, r * rh, g.size, rh + 0.5);
      if (row < ROWS) sctx.fillRect(0, row * rh, g.size * (at - row), rh + 0.5);
      // seulement sur le visage
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(headImg, 0, 0, g.size, g.size);
    };
    drawSel(0);

    const btn = document.createElement('span');
    btn.className = 'icon-btn fz-copy fz-hit';
    btn.innerHTML = `<svg class="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`
      + `<svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>`
      + `<span class="btn-label">Copied</span>`;
    hittable(btn);
    const btnBox = placeUp(btn, g, 10); // mesuré avec le libellé le plus long
    btn.querySelector('.btn-label').textContent = 'Copy';
    const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cursor.setAttribute('class', 'fz-cursor');
    cursor.setAttribute('viewBox', '0 0 16 22');
    cursor.innerHTML = '<path d="M1 1v17l4.5-4 3 7 3-1.3-3-6.8H15Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>';
    btn.parentNode.appendChild(cursor);
    const ghost = lureEl('img', 'fz-ghost', g);
    ghost.src = headImg.src;
    ghost.alt = '';

    const R = `rotate(${-spot.r}deg)`;
    const anims = [];
    let phase = 0;
    const tl = timeline(1500, el => {
      drawSel(el < 1250 ? clamp((el - 60) / 420, 0, 1) : 1);
      if (el >= 1250) sel.style.opacity = String(1 - clamp((el - 1250) / 200, 0, 1));
      if (phase === 0 && el >= 420) {
        phase = 1;
        anims.push(btn.animate([{ opacity: 0, transform: R + ' scale(.5)' }, { opacity: 1, transform: R + ' scale(1)' }], { duration: 180, easing: 'ease-out', fill: 'forwards' }));
        // le curseur arrive d'en bas à droite (dans le repère redressé)
        anims.push(cursor.animate([
          { opacity: 0, transform: `${R} translate(38px, 30px)` },
          { opacity: 1, transform: `${R} translate(30px, 24px)`, offset: 0.2 },
          { opacity: 1, transform: `${R} translate(2px, 0px)` },
        ], { duration: 380, delay: 80, easing: 'ease-in-out', fill: 'forwards' }));
      }
      if (phase === 1 && el >= 900) {
        phase = 2;
        anims.push(btn.animate([{ transform: R + ' scale(.88)' }, { transform: R + ' scale(1)' }], { duration: 160, easing: 'ease-out', composite: 'replace' }));
        anims.push(cursor.animate([{ transform: `${R} translate(2px, 0) scale(.85)` }, { transform: `${R} translate(2px, 0) scale(1)` }], { duration: 160, composite: 'replace' }));
        btn.classList.add('is-copied');
        btn.querySelector('.btn-label').textContent = 'Copied';
        // la copie part vers le presse-papiers
        anims.push(ghost.animate([
          { opacity: 0.7, transform: 'translateY(0) scale(1)' },
          { opacity: 0, transform: `translateY(${-g.size * 0.9}px) scale(.45)` },
        ], { duration: 520, easing: 'ease-in', fill: 'forwards' }));
      }
    });
    return { done: tl.done, els: [sel, btnBox, ghost], stop: () => { tl.stop(); anims.forEach(a => a.cancel()); } };
  }

  // Un appât qui plante (canvas illisible en file://…) ne doit pas casser le peek.
  function startLure() {
    const before = new Set(wrap.children);
    try {
      return nextLure()(lureGeom());
    } catch (err) {
      console.warn('[freulere]', err);
      [...wrap.children].forEach(el => { if (!before.has(el)) el.remove(); });
      peekImg.classList.remove('is-headless');
      return { done: Promise.resolve(), els: [], stop() {} };
    }
  }

  const LURES = {
    glitch: lureGlitch, ressort: lureRessort, orbite: lureOrbite,
    psst: lurePsst, formats: lureFormats, copy: lureCopy, // prototypes
  };
  const POOL = ['glitch', 'ressort', 'orbite'];
  let lastLure = null;
  function nextLure() {
    const forced = params.get('lure');
    let name;
    if (reduced) name = 'orbite'; // sans mouvement : seulement la pastille
    else if (LURES[forced]) name = forced;
    else {
      const pool = forced === 'tous' ? Object.keys(LURES) : POOL;
      do { name = pool[Math.floor(Math.random() * pool.length)]; } while (name === lastLure && pool.length > 1);
    }
    lastLure = name;
    return LURES[name];
  }

  function caught(extra) {
    const pose = headPose(extra);
    // La tête se détache : on masque la tête du peek (le canvas la reprend
    // au même endroit) et le corps repart dans le bord.
    const from = getComputedStyle(wrap).transform;
    peekImg.classList.add('is-headless');
    animateTransform(wrap, from, HIDDEN, 420, EASE_IN).then(() => {
      anchor.style.visibility = 'hidden';
      peekImg.classList.remove('is-headless');
    });
    hovering.clear();
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

  // L'animation s'interrompt (et l'état d'origine est restauré avant que
  // l'action de l'utilisateur ne s'applique) dès qu'il veut se servir de l'app :
  // saisie dans un champ, focus dans un champ, clic sur un contrôle (Copy,
  // Clear all, séparateur, thème…) ou Échap. Faire défiler la page, au doigt
  // comme à la molette, ne l'interrompt pas.
  function session() {
    const restore = snapshot();
    const s = { aborted: false, restored: false };
    const doRestore = () => { if (!s.restored) { s.restored = true; restore(); } };
    const abort = () => { if (!s.aborted) { s.aborted = true; doRestore(); } };
    const handlers = {
      beforeinput: e => { if (e.isTrusted) abort(); },
      focusin: e => { if (e.target && e.target.tagName === 'TEXTAREA') abort(); },
      click: e => { if (e.isTrusted && e.target.closest && e.target.closest('button, input, select, label, a')) abort(); },
      keydown: e => { if (e.key === 'Escape') abort(); },
    };
    Object.entries(handlers).forEach(([type, fn]) => document.addEventListener(type, fn, true));
    s.end = () => {
      Object.entries(handlers).forEach(([type, fn]) => document.removeEventListener(type, fn, true));
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

  function makeSatellite() {
    const el = document.createElement('div');
    el.className = 'fz-sat';
    el.innerHTML = `${SAT_SVG}<div class="fz-flare"></div><div class="fz-hud"></div>`;
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
  // de la cible j (c'est là qu'on écrit dans le vrai champ). offset() décale
  // les cibles si la page défile pendant le vol.
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
      const off = o.offset();
      o.onFrame(el, ctx);
      for (const f of flashes) {
        const k = (el - f.at) / 280;
        if (k >= 1) continue;
        ctx.globalAlpha = 0.35 * (1 - k);
        ctx.fillStyle = `rgb(${o.flash.join(',')})`;
        ctx.fillRect(f.t.x + off.x - f.t.w / 2 - 1, f.t.y + off.y - f.t.h / 2, f.t.w + 2, f.t.h);
      }
      for (const p of parts) {
        if (el < p.start || el >= p.start + p.d) continue;
        const u = (el - p.start) / p.d, e = easeInOutCubic(u), bump = Math.sin(u * Math.PI);
        const col = u < 0.5 ? mix(p.s.col, o.mid, u * 2) : mix(o.mid, p.t.col, (u - 0.5) * 2);
        cv.glyph(u < 0.5 ? p.s.ch : p.t.ch,
          lerp(p.s.x, p.t.x + off.x, e) + bump * p.arc * 0.5, lerp(p.s.y, p.t.y + off.y, e) - bump * Math.abs(p.arc),
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
      // si la page défile pendant le downlink, les bits suivent le champ
      const tr0 = bin.getBoundingClientRect();
      let tr = tr0;
      let landed = 0;
      await flyGlyphs(cv, sess, {
        sources, targets, spread: DSPREAD, dur: DDUR, mid: green, flash: green, arc: 6,
        offset: () => { tr = bin.getBoundingClientRect(); return { x: tr.left - tr0.left, y: tr.top - tr0.top }; },
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
