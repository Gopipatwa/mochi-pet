(function () {
  'use strict';
  const api = window.api;
  const FOOT_PAD = 18;
  const $ = (s) => document.querySelector(s);
  const canvas = $('#stage'); const ctx = canvas.getContext('2d');
  const bubble = $('#bubble'); const bubbleText = $('#bubble-text'); const bubbleActions = $('#bubble-actions'); const snoozeBtn = $('#snooze-btn');

  const mochi = new Mochi();
  const isBuddy = api.role === 'buddy'; // the second, smaller pet: no bubble, not draggable, just good company
  let hoverSince = 0; let lastTease = 0; const pokes = [];
  let settings = null; let runtime = { sleeping: false };
  let awakeOverride = false; let awakeTimer = 0;

  // ---- settings -> look ----------------------------------------------------------------------
  function applySettings(s) {
    settings = s;
    const theme = Themes.get(s.theme.id);
    Themes.apply(document.documentElement, theme);
    if (isBuddy) {
      const b = s.buddy;
      mochi.configure({
        size: Math.max(40, Math.round(s.general.size * b.scale)), theme, outfit: [], season: null, particles: false,
        look: { ...s.look, shape: b.shape, style: b.style, colorMode: 'fixed', fixedColor: b.color },
      });
      return;
    }
    const outfit = Seasons.outfit(s);
    mochi.configure({
      size: s.general.size, look: s.look, theme, outfit,
      season: Seasons.current(s.seasonal.mode, s.seasonal.hemisphere), particles: s.seasonal.particles,
    });
    const R = s.general.size / 2;
    const top = Math.max(0.95, ...outfit.map((o) => Accessories.TOP[o.id] || 0)) + Shapes.get(s.look.shape).topExtra;
    bubble.style.bottom = `${Math.round(FOOT_PAD + R * (1.04 + top + 0.22))}px`;
    snoozeBtn.textContent = `Snooze ${s.reminders.snoozeMinutes}m`;
  }

  function syncSleep() { mochi.setSleeping(runtime.sleeping && !awakeOverride); }

  // ---- canvas ------------------------------------------------------------------------------------
  function fit() {
    const d = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * d); canvas.height = Math.round(window.innerHeight * d);
  }
  window.addEventListener('resize', fit); fit();

  let last = performance.now();
  function loop(now) {
    const dt = (now - last) / 1000; last = now;
    mochi.update(dt);
    const d = window.devicePixelRatio || 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    mochi.draw(ctx, window.innerWidth, window.innerHeight);
    requestAnimationFrame(loop);
  }

  // ---- hit testing / click-through ---------------------------------------------------------------
  // The app switches click-through for the pet itself (from the real cursor position, instantly).
  // The page only reports when the cursor is on the speech bubble, whose buttons must be clickable.
  let hoverBubble = false;
  function setBubbleHot(v) { if (v !== hoverBubble) { hoverBubble = v; api.send('pet:ignore-mouse', !v); } }

  /** Frames carry the global cursor position, so hover works even while the pet walks under a still cursor. */
  function onFrame(f) {
    mochi.setFrame(f);
    mochi.setPeek(f.peek);
    const br = bubble.classList.contains('show') ? bubble.getBoundingClientRect() : null;
    setBubbleHot(!!br && f.cx >= br.left && f.cx <= br.right && f.cy >= br.top && f.cy <= br.bottom);
    const overPet = mochi.hitTest(f.cx, f.cy);
    mochi.setHover(overPet && !pressed);
    if (!isBuddy) {
      const now = performance.now();
      if (overPet && !pressed && !runtime.sleeping) { if (!hoverSince) hoverSince = now; else if (now - hoverSince > 5000) { hoverSince = 0; tease(false); } } else hoverSince = 0;
    }
  }

  let pressed = null; let dragStarted = false;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('#bubble') || !mochi.hitTest(e.clientX, e.clientY, 22)) return;
    pressed = { x: e.screenX, y: e.screenY };
    dragStarted = false;
    document.body.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if (!pressed || dragStarted) return;
    if (!isBuddy && Math.hypot(e.screenX - pressed.x, e.screenY - pressed.y) > 5) { dragStarted = true; api.send('pet:drag-start'); }
  });
  document.addEventListener('pointerup', (e) => {
    if (!pressed) return;
    if (dragStarted) api.send('pet:drag-end');
    else if (e.button === 0) onClick();
    pressed = null; dragStarted = false;
  });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!isBuddy && mochi.hitTest(e.clientX, e.clientY, 22)) api.send('pet:context-menu');
  });

  // ---- clicks, emotes and teasing ----------------------------------------------------------------
  const POKED = ['Okay okay, I felt that!', 'Stop poking me! Hehe.', 'Boop count: too many.', 'Rude! ...do it again.'];

  function onClick() {
    mochi.click();
    if (isBuddy) return;
    api.send('pet:emote', mochi.dizzyT > 0 ? 'dizzy' : 'click');
    const now = performance.now(); pokes.push(now);
    while (pokes.length && now - pokes[0] > 8000) pokes.shift();
    if (pokes.length >= 5 && settings && settings.teasing.enabled && now - lastTease > 30000) { pokes.length = 0; tease(true); }
  }

  /** A playful moment: tongue out and a cheeky line, only if teasing is switched on. */
  function tease(poked) {
    if (!settings || !settings.teasing.enabled || runtime.sleeping) return;
    const now = performance.now();
    if (now - lastTease < (settings.teasing.level === 'cheeky' ? 25000 : 90000) && !poked) return;
    lastTease = now;
    if (settings.teasing.tongue) mochi.tongue();
    const lines = poked ? POKED : settings.teasing.lines;
    if (lines.length) enqueue({ id: `tease-${Date.now()}`, kind: 'greeting', text: lines[Math.floor(Math.random() * lines.length)].replaceAll('{name}', settings.general.name), ttl: 5, actions: [], sound: false });
    api.send('pet:emote', 'giggle');
  }

  // ---- speech bubble ------------------------------------------------------------------------------
  const queue = []; let current = null; let ttlTimer = 0;
  const isImportant = (sp) => sp.kind === 'reminder' || sp.kind === 'meeting';

  function enqueue(sp) {
    if (current && current.id === sp.id) { current = sp; render(sp); armTimer(sp); return; }
    if (queue.some((q) => q.id === sp.id)) return;
    if (current && !isImportant(current) && isImportant(sp)) { finish('dismiss', true); queue.unshift(sp); } else queue.push(sp);
    if (!current) showNext();
  }

  function render(sp) {
    bubbleText.textContent = sp.text;
    bubbleActions.hidden = sp.actions.length === 0;
    for (const b of bubbleActions.querySelectorAll('button')) b.hidden = !sp.actions.includes(b.dataset.action);
  }

  function armTimer(sp) {
    clearTimeout(ttlTimer);
    ttlTimer = setTimeout(() => finish('dismiss'), Math.max(3, sp.ttl) * 1000);
  }

  function showNext() {
    if (current || !queue.length) return;
    current = queue.shift();
    render(current); armTimer(current);
    requestAnimationFrame(() => bubble.classList.add('show'));
    if (isImportant(current)) {
      awakeOverride = true; clearTimeout(awakeTimer); syncSleep();
      mochi.setAlert(true); mochi.alertT = 2.3;
      if (current.sound && settings) Sound.play(current.kind, settings.general.volume);
    } else {
      mochi.happyT = 1.6; mochi.armWaveT = 1.2; mochi.sq.kick(-2.5); mochi.hopY.kick(-110);
    }
  }

  function finish(action, silent = false) {
    if (!current) return;
    const sp = current; current = null;
    clearTimeout(ttlTimer);
    bubble.classList.remove('show');
    api.send('pet:bubble-action', { id: sp.id, action });
    if (action === 'done') { mochi.happyT = 1.3; mochi.sq.kick(-3); mochi.hopY.kick(-140); }
    mochi.setAlert(false);
    clearTimeout(awakeTimer); awakeTimer = setTimeout(() => { awakeOverride = false; syncSleep(); }, 6000);
    if (!silent) setTimeout(showNext, 450);
  }

  bubbleActions.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (b) finish(b.dataset.action);
  });
  bubble.addEventListener('click', (e) => { if (!e.target.closest('button') && current && !isImportant(current)) finish('dismiss'); });

  // ---- wiring ---------------------------------------------------------------------------------------
  api.on('settings:changed', ({ settings: s }) => applySettings(s));
  api.on('runtime:changed', (r) => { runtime = r; syncSleep(); });
  api.on('pet:frame', onFrame);
  api.on('pet:landed', ({ impact }) => mochi.land(impact));
  api.on('pet:speak', enqueue);
  api.on('pet:tease', () => { if (!isBuddy) mochi.tongue(); });
  api.on('pet:friend', ({ kind }) => { // the buddy reacts to what happens to the main pet
    if (!isBuddy) return;
    if (kind === 'click') { mochi.sq.kick(-1.6); mochi.hopY.kick(-60); } else mochi.giggle();
  });

  api.invoke('app:get-state').then((state) => {
    if (!state) return;
    runtime = state.runtime; applySettings(state.settings); syncSleep();
    requestAnimationFrame((t) => { last = t; loop(t); });
    api.send('pet:ready');
  });

  // auto theme + seasonal outfits follow the clock
  setInterval(() => { if (settings) applySettings(settings); }, 60000);
})();
