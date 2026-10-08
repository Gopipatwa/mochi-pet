(function () {
  'use strict';
  const api = window.api;
  const $ = (s, r = document) => r.querySelector(s);

  /** Tiny DOM builder. Text always goes through textContent/createTextNode, never innerHTML. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(kid)); }
    return el;
  }

  // ---- state & patching ------------------------------------------------------------------------
  const state = { settings: null, runtime: null };
  let bindings = []; let uid = 0; let currentTab = 'general'; let previews = [];
  const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  function setLocal(path, val) {
    const keys = path.split('.'); let o = state.settings;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = val;
  }
  function mergeInto(t, s) { for (const k of Object.keys(s)) { if (isObj(s[k]) && isObj(t[k])) mergeInto(t[k], s[k]); else t[k] = s[k]; } return t; }
  function toPartial(path, val) {
    const keys = path.split('.'); const root = {}; let o = root;
    keys.forEach((k, i) => { if (i === keys.length - 1) o[k] = val; else o = o[k] = {}; });
    return root;
  }
  let pending = {}; let flushTimer = 0;
  function patch(path, val) {
    setLocal(path, val);
    mergeInto(pending, toPartial(path, val));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { const p = pending; pending = {}; api.invoke('settings:patch', p); }, 35);
    if (path === 'theme.id') applyTheme();
    if (path === 'general.petName') updateChrome();
    refreshAll();
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function applyTheme() { Themes.apply(document.documentElement, Themes.get(state.settings.theme.id)); }
  function refreshAll() { for (const b of bindings) b(); updateChrome(); }

  // ---- controls ---------------------------------------------------------------------------------
  function visibleIf(def) {
    if (!def.showIf) return true;
    const [key, want] = def.showIf; const v = get(state.settings, key);
    return Array.isArray(want) ? want.includes(v) : v === want;
  }

  function control(def, id) {
    const key = def.key; const v0 = () => get(state.settings, key);
    switch (def.type) {
      case 'toggle': {
        const input = h('input', { type: 'checkbox', id });
        input.addEventListener('change', () => patch(key, input.checked));
        bindings.push(() => { input.checked = !!v0(); });
        return h('label', { class: 'switch' }, input, h('span'));
      }
      case 'range': {
        const scale = def.scale || 1;
        const input = h('input', { type: 'range', id, min: def.min, max: def.max, step: def.step || 1 });
        const out = h('span', { class: 'val' });
        const fmt = def.fmt || ((v) => `${v}${def.unit || ''}`);
        input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); patch(key, Number(input.value) * scale); });
        bindings.push(() => { input.value = v0() / scale; out.textContent = fmt(Number(input.value)); });
        return h('div', { class: 'ctl' }, input, out);
      }
      case 'number': {
        const scale = def.scale || 1;
        const input = h('input', { type: 'number', id, min: def.min, max: def.max, step: def.step || 1 });
        input.addEventListener('change', () => {
          const n = Math.min(def.max, Math.max(def.min, Number(input.value) || def.min));
          input.value = n; patch(key, n * scale);
        });
        bindings.push(() => { input.value = v0() / scale; });
        return h('div', { class: 'ctl' }, input, def.unit && h('span', { class: 'val' }, def.unit));
      }
      case 'text': {
        const input = h('input', { type: 'text', id, class: 'wide', maxlength: def.max || 40, placeholder: def.placeholder });
        input.addEventListener('input', () => patch(key, input.value));
        bindings.push(() => { if (document.activeElement !== input) input.value = v0(); });
        return input;
      }
      case 'time': {
        const input = h('input', { type: 'time', id });
        input.addEventListener('change', () => { if (input.value) patch(key, input.value); });
        bindings.push(() => { input.value = v0(); });
        return input;
      }
      case 'select': {
        const sel = h('select', { id }, def.options.map(([v, l]) => h('option', { value: v }, l)));
        sel.addEventListener('change', () => patch(key, sel.value));
        bindings.push(() => { sel.value = v0(); });
        return sel;
      }
      case 'color': {
        const input = h('input', { type: 'color', id });
        input.addEventListener('input', () => patch(key, input.value));
        bindings.push(() => { input.value = v0(); });
        return input;
      }
      case 'swatches': {
        const box = h('div', { class: 'swatches', role: 'group', 'aria-label': def.label });
        const btns = def.colors.map(([c, name]) => {
          const b = h('button', { type: 'button', class: 'swatch', title: name, 'aria-label': name }); b.style.background = c;
          b.addEventListener('click', () => patch(key, c)); box.append(b); return [c, b];
        });
        bindings.push(() => { for (const [c, b] of btns) b.setAttribute('aria-pressed', String(v0() === c)); });
        return box;
      }
      case 'numlist': {
        const input = h('input', { type: 'text', id, class: 'wide', placeholder: '10, 2' });
        input.addEventListener('change', () => {
          const list = [...new Set(input.value.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 240))].slice(0, 5);
          patch(key, list.length ? list : [10]); input.value = (list.length ? list : [10]).join(', ');
        });
        bindings.push(() => { if (document.activeElement !== input) input.value = v0().join(', '); });
        return input;
      }
      default: return h('span');
    }
  }

  function row(def) {
    const id = `c${++uid}`;
    const el = h('div', { class: 'row' },
      h('div', { class: 'lbl' }, h(def.type === 'swatches' ? 'div' : 'label', { class: 't', for: def.type === 'swatches' ? null : id }, def.label), def.hint && h('div', { class: 'hint' }, def.hint)),
      h('div', { class: 'ctl' }, control(def, id)));
    if (def.showIf) bindings.push(() => { el.hidden = !visibleIf(def); });
    return el;
  }
  const card = (rows, extra) => h('div', { class: 'card' }, rows.map(row), extra);
  const section = (title, hint) => [h('h1', { text: title }), hint && h('p', { class: 'lead', text: hint })];
  const button = (label, onclick, cls = '') => h('button', { type: 'button', class: `btn ${cls}`, onclick }, label);

  // ---- preview ----------------------------------------------------------------------------------
  function previewCfg() {
    const s = state.settings;
    return { size: 108, look: s.look, theme: Themes.get(s.theme.id), outfit: Seasons.outfit(s), season: Seasons.current(s.seasonal.mode, s.seasonal.hemisphere), particles: s.seasonal.particles };
  }
  function preview(tip = 'Hover, click and triple-click me!') {
    const canvas = h('canvas', { 'aria-label': 'Live preview of your pet' });
    const wrap = h('div', { class: 'preview' }, canvas, h('div', { class: 'tip' }, tip));
    queueMicrotask(() => previews.push(attachPreview(canvas, previewCfg)));
    return wrap;
  }

  /** A grid of small static portraits. Each item overrides part of the current look for its own portrait. */
  function avatarGrid(items, isOn, onPick, opts = {}) {
    const grid = h('div', { class: 'avatar-grid', role: 'group' });
    const cards = items.map((it) => {
      const canvas = h('canvas', { 'aria-hidden': 'true' });
      const b = h('button', { type: 'button', class: 'avatar-card', 'aria-pressed': 'false', 'aria-label': it.label }, canvas, h('b', { text: it.label }));
      b.addEventListener('click', () => onPick(it));
      grid.append(b);
      return { it, canvas, b };
    });
    let timer = 0;
    const paint = () => {
      const s = state.settings; const theme = Themes.get(s.theme.id);
      for (const { it, canvas } of cards) Mochi.snapshot(canvas, { size: 40, look: { ...s.look, ...(opts.base ? opts.base() : {}), ...it.look }, theme, outfit: [], season: null, particles: false }, opts);
    };
    requestAnimationFrame(paint);
    bindings.push(() => {
      for (const { it, b } of cards) b.setAttribute('aria-pressed', String(isOn(it)));
      clearTimeout(timer); timer = setTimeout(paint, 140);
    });
    return grid;
  }

  // ---- tabs --------------------------------------------------------------------------------------
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const COLORS = [['#5bc8b0', 'Teal'], ['#f5a33a', 'Orange'], ['#7b61ff', 'Purple'], ['#3b82f6', 'Blue'], ['#f97316', 'Tangerine'], ['#f472b6', 'Pink'], ['#4ade80', 'Green'], ['#ef4444', 'Red'], ['#fbbf24', 'Yellow'], ['#94a3b8', 'Slate']];
  const ACC_NAMES = {
    hat: 'Top hat', glasses: 'Round glasses', bowtie: 'Bow tie', headphones: 'Headphones', antenna: 'Antenna', scarf: 'Scarf', crown: 'Crown',
    santaHat: 'Santa hat', beanie: 'Winter beanie', flowerCrown: 'Flower crown', bunnyEars: 'Bunny ears', sunglasses: 'Sunglasses',
    strawHat: 'Straw hat', leaf: 'Autumn leaf', witchHat: 'Witch hat', partyHat: 'Party hat', hearts: 'Floating hearts',
  };
  const EYES = [['classic', 'Classic'], ['sparkly', 'Sparkly'], ['sleepy', 'Sleepy'], ['googly', 'Googly']];
  const HAPPY_EYES = [['arcs', 'Happy arcs'], ['stars', 'Star eyes'], ['hearts', 'Heart eyes']];
  const SEASON_OF = { santaHat: 'Christmas', beanie: 'Winter', flowerCrown: 'Spring', bunnyEars: 'Easter', sunglasses: 'Summer', strawHat: 'Summer', leaf: 'Autumn', witchHat: 'Halloween', partyHat: 'New Year', hearts: 'Valentine' };

  const TABS = [
    { id: 'general', label: 'General', render(m) {
      m.append(...section('General', 'The basics: who you are and how the pet behaves.'),
        card([
          { type: 'text', key: 'general.name', label: 'Your name', hint: 'Used in greetings as {name}.' },
          { type: 'text', key: 'general.petName', label: 'Pet name', hint: 'Shown in notifications and the tray.' },
        ]),
        h('h2', { text: 'Size & sound' }),
        card([
          { type: 'range', key: 'general.size', min: 70, max: 280, step: 2, unit: ' px', label: 'Pet size' },
          { type: 'toggle', key: 'general.sounds', label: 'Sounds', hint: 'Soft chimes for reminders and meetings.' },
          { type: 'range', key: 'general.volume', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, label: 'Volume', showIf: ['general.sounds', true] },
        ]),
        h('h2', { text: 'Behavior' }),
        card([
          { type: 'number', key: 'general.sleepAfterSec', min: 1, max: 60, scale: 60, unit: 'min', label: 'Falls asleep after', hint: 'Of no keyboard or mouse activity. He wakes up when you come back.' },
          { type: 'toggle', key: 'general.alwaysOnTop', label: 'Stay on top of other windows' },
          { type: 'toggle', key: 'general.startWithWindows', label: 'Start with Windows', hint: state.runtime.packaged ? 'Launches in the tray when you sign in.' : 'Only takes effect in the packaged .exe.' },
        ]),
        h('h2', { text: 'Settings file' }),
        h('div', { class: 'card pad' },
          h('div', { class: 'btns', style: null },
            button('Export settings...', async () => { const r = await api.invoke('settings:export'); if (r.ok) toast('Settings exported'); }),
            button('Import settings...', async () => { const r = await api.invoke('settings:import'); toast(r.ok ? 'Settings imported' : (r.error || 'Import cancelled')); }),
            button('Reset everything', () => { if (confirm('Reset all settings to their defaults?')) api.invoke('settings:reset'); }, 'danger')),
          h('div', { class: 'hint', text: 'Everything is stored locally as JSON in your user data folder. Nothing ever leaves this computer.' })));
    } },

    { id: 'look', label: 'Look', render(m) {
      m.append(...section('Look', 'Pick a character, a shape and a style, then color it.'), preview(),
        h('h2', { text: 'Characters' }),
        avatarGrid(Shapes.PRESETS.map((p) => ({ key: p.id, label: p.name, look: { shape: p.shape, style: p.style, colorMode: 'fixed', fixedColor: p.color } })),
          (it) => { const l = state.settings.look; return l.shape === it.look.shape && l.style === it.look.style && l.fixedColor === it.look.fixedColor && l.colorMode === 'fixed'; },
          (it) => { for (const [k, v] of Object.entries(it.look)) patch(`look.${k}`, v); }),
        h('h2', { text: 'Shape' }),
        avatarGrid(Shapes.list.map((sh) => ({ key: sh.id, label: sh.name, look: { shape: sh.id } })), (it) => state.settings.look.shape === it.key, (it) => patch('look.shape', it.key)),
        h('h2', { text: 'Gender style' }),
        avatarGrid(Shapes.STYLES.map((st) => ({ key: st.id, label: st.name, look: { style: st.id } })), (it) => state.settings.look.style === it.key, (it) => patch('look.style', it.key)),
        h('h2', { text: 'Eyes' }),
        avatarGrid(EYES.map(([id, label]) => ({ key: id, label, look: { eyes: id } })), (it) => state.settings.look.eyes === it.key, (it) => patch('look.eyes', it.key)),
        h('h2', { text: 'Eyes when happy' }),
        avatarGrid(HAPPY_EYES.map(([id, label]) => ({ key: id, label, look: { happyEyes: id } })), (it) => state.settings.look.happyEyes === it.key, (it) => patch('look.happyEyes', it.key), { happy: true }),
        h('h2', { text: 'Color' }),
        card([
          { type: 'select', key: 'look.colorMode', label: 'Color mode', hint: 'Mood changes with how he feels, time follows sunrise to night, season follows the calendar.', options: [['fixed', 'Fixed color'], ['picker', 'Color picker'], ['rainbow', 'Slow rainbow'], ['mood', 'Mood based'], ['time', 'Time of day'], ['season', 'Seasonal']] },
          { type: 'swatches', key: 'look.fixedColor', label: 'Color', colors: COLORS, showIf: ['look.colorMode', 'fixed'] },
          { type: 'color', key: 'look.customColor', label: 'Custom color', showIf: ['look.colorMode', 'picker'] },
          { type: 'range', key: 'look.rainbowSeconds', min: 15, max: 300, step: 5, unit: ' s', label: 'Rainbow cycle length', showIf: ['look.colorMode', 'rainbow'] },
        ]),
        h('h2', { text: 'Details' }),
        card([
          { type: 'range', key: 'look.jelly', min: 0, max: 1, step: 0.05, fmt: (v) => (v < 0.2 ? 'Firm' : v < 0.5 ? 'Bouncy' : v < 0.8 ? 'Jelly' : 'Liquid'), label: 'Jelly / liquid wobble', hint: 'How much his body ripples and sloshes when he hops, stops, gets poked or dragged.' },
          { type: 'range', key: 'look.smoothness', min: 0, max: 1, step: 0.05, fmt: (v) => (v < 0.35 ? 'Tight' : v < 0.7 ? 'Mochi' : 'Jelly'), label: 'Squishiness', hint: 'How wobbly the springs are after a hop or a squish.' },
          { type: 'toggle', key: 'look.cheeks', label: 'Blushing cheeks' },
          { type: 'toggle', key: 'look.shadow', label: 'Ground shadow' },
        ]));
    } },

    { id: 'movement', label: 'Movement', render(m) {
      const moving = ['wander', 'taskbar', 'follow', 'corner'];
      m.append(...section('Movement', 'Where he goes and how often.'),
        card([
          { type: 'select', key: 'movement.mode', label: 'Mode', options: [['still', 'Stay still'], ['wander', 'Wander around the screen'], ['taskbar', 'Walk along the taskbar'], ['windows', 'Sit on top of my windows'], ['follow', 'Follow the cursor'], ['corner', 'Sit in a corner']] },
          { type: 'toggle', key: 'movement.peek', label: 'Peek over the edge', hint: 'Now and then he ducks down behind a window and peeks up at you.', showIf: ['movement.mode', 'windows'] },
          { type: 'select', key: 'movement.corner', label: 'Corner', showIf: ['movement.mode', 'corner'], options: [['bottomRight', 'Bottom right'], ['bottomLeft', 'Bottom left'], ['topRight', 'Top right'], ['topLeft', 'Top left']] },
          { type: 'range', key: 'movement.speed', min: 20, max: 400, step: 5, unit: ' px/s', label: 'Walking speed', showIf: ['movement.mode', moving] },
          { type: 'range', key: 'movement.frequency', min: 3, max: 120, step: 1, unit: ' s', label: 'Moves about every', hint: 'Time he rests between walks.', showIf: ['movement.mode', ['wander', 'taskbar', 'windows']] },
          { type: 'select', key: 'movement.area', label: 'Allowed area', hint: 'With several monitors he can roam across all of them.', showIf: ['movement.mode', ['wander', 'taskbar', 'windows', 'follow']], options: [['all', 'All monitors'], ['primary', 'Primary monitor only'], ['current', 'Stay on the current monitor']] },
          { type: 'toggle', key: 'movement.locked', label: 'Never move (lock)', hint: 'He stays exactly where he is and cannot be dragged.' },
        ]),
        h('h2', { text: 'Fullscreen apps' }),
        card([{ type: 'select', key: 'movement.fullscreen', label: 'When a fullscreen app is running', hint: 'Games, videos and presentations. Reminders wait and appear afterwards.', options: [['hide', 'Hide and pause'], ['ignore', 'Keep showing']] }]));
    } },

    { id: 'reminders', label: 'Reminders', render(m) {
      m.append(...section('Reminders', 'Gentle nudges as speech bubbles.'),
        card([
          { type: 'toggle', key: 'reminders.paused', label: 'Pause all reminders' },
          { type: 'toggle', key: 'reminders.dnd', label: 'Do not disturb', hint: 'Stay completely quiet: no bubbles, sounds or notifications.' },
          { type: 'toggle', key: 'reminders.notify', label: 'Windows notifications', hint: 'Also show a system notification. Always used while the pet is hidden.' },
          { type: 'toggle', key: 'reminders.sound', label: 'Play a sound' },
          { type: 'time', key: 'reminders.activeStart', label: 'Active from', hint: 'Reminders only appear between these hours (meetings always do).' },
          { type: 'time', key: 'reminders.activeEnd', label: 'Active until' },
          { type: 'number', key: 'reminders.snoozeMinutes', min: 1, max: 240, unit: 'min', label: 'Snooze length' },
          { type: 'number', key: 'reminders.bubbleSeconds', min: 5, max: 300, unit: 's', label: 'Bubble stays for' },
        ]),
        h('h2', { text: 'Your reminders' }), reminderList(),
        h('div', { class: 'btns' },
          button('+ Add reminder', () => {
            state.settings.reminders.items.push({ id: `c${Date.now().toString(36)}`, builtin: false, enabled: true, text: 'New reminder', type: 'interval', everyMin: 60, times: [], days: [0, 1, 2, 3, 4, 5, 6] });
            patch('reminders.items', state.settings.reminders.items); showTab('reminders', true);
          }, 'primary'),
          button('Test reminder', () => api.invoke('test:fire', 'reminder'))),
        h('h2', { text: 'Upcoming meetings' }), meetingsBlock());
    } },

    { id: 'greetings', label: 'Greetings', render(m) {
      const buckets = [['morning', 'Morning', '5:00 - 11:59'], ['afternoon', 'Afternoon', '12:00 - 16:59'], ['evening', 'Evening', '17:00 - 21:59'], ['night', 'Late night', '22:00 - 4:59']];
      m.append(...section('Greetings', 'Shown when he starts and the first time he wakes up each day. Use {name} for your name and {pet} for his.'),
        card([{ type: 'toggle', key: 'greetings.enabled', label: 'Say hello' }, { type: 'text', key: 'general.name', label: 'Your name' }]),
        ...buckets.flatMap(([k, label, hours]) => {
          const ta = h('textarea', { 'aria-label': `${label} greetings`, spellcheck: 'false' });
          ta.addEventListener('input', () => patch(`greetings.${k}`, ta.value.split('\n').map((s) => s.trim()).filter(Boolean)));
          bindings.push(() => { if (document.activeElement !== ta) ta.value = state.settings.greetings[k].join('\n'); });
          return [h('h2', { text: `${label}  (${hours})` }), h('div', { class: 'card pad' }, ta, h('div', { class: 'hint' }, 'One greeting per line. He picks one at random.'))];
        }),
        h('div', { class: 'btns' }, button('Preview a greeting', () => api.invoke('test:fire', 'greeting'), 'primary')));
    } },

    { id: 'friends', label: 'Friends & Fun', render(m) {
      const buddyBase = () => ({ colorMode: 'fixed', fixedColor: state.settings.buddy.color });
      const lines = h('textarea', { 'aria-label': 'Teasing lines', spellcheck: 'false' });
      lines.addEventListener('input', () => patch('teasing.lines', lines.value.split('\n').map((x) => x.trim()).filter(Boolean)));
      bindings.push(() => { if (document.activeElement !== lines) lines.value = state.settings.teasing.lines.join('\n'); });
      m.append(...section('Friends & Fun', 'A small friend who walks beside him, and a playful streak.'),
        h('h2', { text: 'Buddy (second pet)' }),
        card([
          { type: 'toggle', key: 'buddy.enabled', label: 'Bring a buddy', hint: 'A smaller friend that follows him around, laughs when he gets dizzy and reacts when he is poked.' },
          { type: 'range', key: 'buddy.scale', min: 0.35, max: 0.9, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, label: 'Buddy size', hint: 'Relative to his size.', showIf: ['buddy.enabled', true] },
          { type: 'select', key: 'buddy.side', label: 'Walks on his', options: [['right', 'Right side'], ['left', 'Left side']], showIf: ['buddy.enabled', true] },
          { type: 'swatches', key: 'buddy.color', label: 'Buddy color', colors: COLORS, showIf: ['buddy.enabled', true] },
        ]),
        h('h2', { text: 'Buddy shape' }),
        avatarGrid(Shapes.list.map((sh) => ({ key: sh.id, label: sh.name, look: { shape: sh.id } })), (it) => state.settings.buddy.shape === it.key, (it) => patch('buddy.shape', it.key), { base: buddyBase }),
        h('h2', { text: 'Buddy gender style' }),
        avatarGrid(Shapes.STYLES.map((st) => ({ key: st.id, label: st.name, look: { style: st.id } })), (it) => state.settings.buddy.style === it.key, (it) => patch('buddy.style', it.key), { base: buddyBase }),
        h('h2', { text: 'Teasing' }),
        card([
          { type: 'toggle', key: 'teasing.enabled', label: 'Let him tease me', hint: 'Playful only: it never blocks the mouse and you can still grab him by holding the button.' },
          { type: 'select', key: 'teasing.level', label: 'How cheeky', options: [['mild', 'Mild - now and then'], ['cheeky', 'Cheeky - often']], showIf: ['teasing.enabled', true] },
          { type: 'toggle', key: 'teasing.tongue', label: 'Stick his tongue out', showIf: ['teasing.enabled', true] },
          { type: 'toggle', key: 'teasing.dodge', label: 'Dodge when I swipe at him', hint: 'If the cursor lunges at him he hops out of reach and says something smug.', showIf: ['teasing.enabled', true] },
        ]),
        h('h2', { text: 'Cheeky lines' }),
        h('div', { class: 'card pad' }, lines, h('div', { class: 'hint' }, 'One per line. He picks at random. {name} is your name.')),
        h('div', { class: 'btns' }, button('Tease me now', () => api.invoke('test:fire', 'tease'), 'primary')));
    } },

    { id: 'themes', label: 'Themes', render(m) {
      const grid = h('div', { class: 'grid' });
      for (const t of Themes.list) {
        const b = h('button', { type: 'button', class: 'theme-card', 'aria-pressed': 'false' },
          h('div', { class: 'dots' }, t.swatch.map((c) => { const i = h('i'); i.style.background = c; return i; })),
          h('b', { text: t.name }), h('small', { text: t.id === 'auto' ? 'Light by day, pastel at dusk, dark at night' : 'Pet, bubble and settings' }));
        b.addEventListener('click', () => patch('theme.id', t.id));
        bindings.push(() => b.setAttribute('aria-pressed', String(state.settings.theme.id === t.id)));
        grid.append(b);
      }
      m.append(...section('Themes', 'A theme restyles the pet, the speech bubble and this window.'), preview('Try each theme - the pet changes too'), grid);
    } },

    { id: 'accessories', label: 'Accessories', render(m) {
      const now = h('div', { class: 'now' });
      bindings.push(() => {
        const s = state.settings; const season = Seasons.current(s.seasonal.mode, s.seasonal.hemisphere);
        const worn = Seasons.outfit(s).map((o) => ACC_NAMES[o.id]);
        now.replaceChildren('Season right now: ', h('b', { text: season ? Seasons.INFO[season].name : 'none' }), '. Wearing: ', h('b', { text: worn.length ? worn.join(', ') : 'nothing' }), '.');
      });
      const accGrid = (ids, base) => {
        const grid = h('div', { class: 'grid' });
        for (const id of ids) {
          const input = h('input', { type: 'checkbox', 'aria-label': ACC_NAMES[id] });
          const color = h('input', { type: 'color', 'aria-label': `${ACC_NAMES[id]} color` });
          const c = h('div', { class: 'acc-card' }, h('div', null, h('div', { class: 'nm', text: ACC_NAMES[id] }), SEASON_OF[id] && h('div', { class: 'hint', text: SEASON_OF[id] })), h('div', { class: 'ctl' }, color, h('label', { class: 'switch' }, input, h('span'))));
          input.addEventListener('change', () => patch(`${base}.${id}.enabled`, input.checked));
          color.addEventListener('input', () => patch(`${base}.${id}.color`, color.value));
          bindings.push(() => { const a = get(state.settings, `${base}.${id}`); input.checked = a.enabled; color.value = a.color; c.classList.toggle('on', a.enabled); });
          grid.append(c);
        }
        return grid;
      };
      m.append(...section('Accessories', 'Toggle, recolor and watch the live preview.'), preview('Your accessories appear here live'), now,
        h('h2', { text: 'Wardrobe' }), accGrid(['hat', 'glasses', 'bowtie', 'headphones', 'antenna', 'scarf', 'crown'], 'accessories'),
        h('h2', { text: 'Seasonal outfits' }),
        card([
          { type: 'select', key: 'seasonal.mode', label: 'Season', hint: 'Auto follows the calendar, including Halloween, Christmas, New Year, Valentine and Easter.', options: [['auto', 'Automatic (by date)'], ['off', 'Off'], ['winter', 'Winter'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['halloween', 'Halloween'], ['christmas', 'Christmas'], ['newyear', 'New Year'], ['valentine', 'Valentine'], ['easter', 'Easter']] },
          { type: 'select', key: 'seasonal.hemisphere', label: 'Hemisphere', options: [['north', 'Northern'], ['south', 'Southern']], showIf: ['seasonal.mode', 'auto'] },
          { type: 'toggle', key: 'seasonal.particles', label: 'Falling snow, petals, leaves and more' },
        ]),
        h('p', { class: 'hint', text: 'Seasonal pieces only fill free spots: anything you wear above always wins.' }),
        accGrid(['santaHat', 'beanie', 'flowerCrown', 'bunnyEars', 'sunglasses', 'strawHat', 'leaf', 'witchHat', 'partyHat', 'hearts'], 'seasonal.items'));
    } },
  ];

  // ---- reminders list ------------------------------------------------------------------------------
  function reminderList() {
    const host = h('div', { class: 'card' });
    const items = state.settings.reminders.items;
    if (!items.length) host.append(h('div', { class: 'empty', text: 'No reminders yet. Add one below.' }));
    const save = () => patch('reminders.items', state.settings.reminders.items);
    items.forEach((it, idx) => {
      const en = h('input', { type: 'checkbox', 'aria-label': 'Enabled' }); en.checked = it.enabled;
      en.addEventListener('change', () => { it.enabled = en.checked; save(); });
      const text = h('input', { type: 'text', value: it.text, maxlength: 200, 'aria-label': 'Reminder text' });
      text.addEventListener('input', () => { it.text = text.value; save(); });
      const type = h('select', { 'aria-label': 'Schedule type' }, h('option', { value: 'interval' }, 'Every...'), h('option', { value: 'times' }, 'At fixed times'));
      type.value = it.type;
      const every = h('input', { type: 'number', min: 1, max: 1440, value: it.everyMin, 'aria-label': 'Minutes between reminders' });
      const everyWrap = h('span', null, every, ' minutes');
      const times = h('input', { type: 'text', value: it.times.join(', '), placeholder: '12:30, 18:00', 'aria-label': 'Times (HH:MM, comma separated)' });
      const timesWrap = h('span', null, times);
      const sync = () => { everyWrap.hidden = it.type !== 'interval'; timesWrap.hidden = it.type !== 'times'; };
      type.addEventListener('change', () => { it.type = type.value; sync(); save(); });
      every.addEventListener('change', () => { it.everyMin = Math.min(1440, Math.max(1, Number(every.value) || 60)); every.value = it.everyMin; save(); });
      times.addEventListener('change', () => { it.times = times.value.split(/[,\s]+/).filter((t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t)).map((t) => t.padStart(5, '0')); times.value = it.times.join(', '); save(); });
      const days = h('span', { class: 'days', role: 'group', 'aria-label': 'Days of the week' }, DAYS.map((d, i) => {
        const b = h('button', { type: 'button', class: 'day', title: d, 'aria-label': d, 'aria-pressed': String(it.days.includes(i)) }, d[0]);
        b.addEventListener('click', () => { it.days = it.days.includes(i) ? it.days.filter((x) => x !== i) : [...it.days, i].sort(); b.setAttribute('aria-pressed', String(it.days.includes(i))); save(); });
        return b;
      }));
      sync();
      const del = it.builtin ? h('span', { class: 'badge' }, 'built in') : button('Delete', () => { items.splice(idx, 1); save(); showTab('reminders', true); }, 'danger small');
      host.append(h('div', { class: 'item' }, h('label', { class: 'switch' }, en, h('span')), h('div', { class: 'main' }, text, h('div', { class: 'opts' }, type, everyWrap, timesWrap, days)), del));
    });
    return host;
  }

  // ---- meetings --------------------------------------------------------------------------------------
  function meetingsBlock() {
    const wrap = h('div');
    const rows = card([
      { type: 'toggle', key: 'meetings.enabled', label: 'Meeting reminders', hint: 'Get a heads-up before a meeting starts.' },
      { type: 'numlist', key: 'meetings.leadMinutes', label: 'Minutes before', hint: 'Comma separated, e.g. "10, 2" for two nudges.' },
      { type: 'toggle', key: 'meetings.alsoAtStart', label: 'Also tell me when it starts' },
    ].map((d) => d));
    const icsInfo = h('div', { class: 'mono' });
    bindings.push(() => { icsInfo.textContent = state.settings.meetings.icsPath || 'No calendar linked'; });
    const upcoming = h('ul', { class: 'upcoming' });
    const loadUpcoming = async () => {
      const list = await api.invoke('meetings:upcoming');
      upcoming.replaceChildren(...(list.length ? list.map((r) => h('li', null, h('span', { text: r.title }), h('span', { class: 'mono', text: new Date(r.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) }))) : [h('li', { class: 'empty', text: 'Nothing coming up in the next two weeks.' })]));
    };
    loadUpcoming(); bindings.push(() => { clearTimeout(loadUpcoming.t); loadUpcoming.t = setTimeout(loadUpcoming, 400); });

    const title = h('input', { type: 'text', class: 'wide', placeholder: 'Meeting title', maxlength: 100, 'aria-label': 'Meeting title' });
    const when = h('input', { type: 'datetime-local', 'aria-label': 'Start' });
    const d0 = new Date(Date.now() + 3600000); d0.setMinutes(0, 0, 0);
    when.value = new Date(d0 - d0.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const rep = h('select', { 'aria-label': 'Repeat' }, [['none', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Every week']].map(([v, l]) => h('option', { value: v }, l)));
    const list = h('div');
    const renderList = () => {
      const items = state.settings.meetings.items;
      list.replaceChildren(...(items.length ? items.map((mt, i) => h('div', { class: 'item' }, h('span', { class: 'badge' }, mt.repeat === 'none' ? 'once' : mt.repeat), h('div', null, h('div', { text: mt.title }), h('div', { class: 'mono', text: mt.start.replace('T', '  ') })), button('Delete', () => { items.splice(i, 1); patch('meetings.items', items); renderList(); }, 'danger small'))) : [h('div', { class: 'empty', text: 'No meetings added by hand.' })]));
    };
    renderList();

    wrap.append(rows,
      h('h2', { text: 'Add a meeting' }),
      h('div', { class: 'card pad' },
        h('div', { class: 'form-row' }, title, when, rep, button('Add', () => {
          if (!when.value) { toast('Pick a date and time'); return; }
          const items = state.settings.meetings.items;
          items.push({ id: `m${Date.now().toString(36)}`, title: title.value.trim() || 'Meeting', start: when.value.slice(0, 16), repeat: rep.value });
          patch('meetings.items', items); title.value = ''; renderList(); toast('Meeting added');
        }, 'primary')), list),
      h('h2', { text: 'Calendar file (.ics)' }),
      h('div', { class: 'card pad' },
        h('div', { class: 'hint', text: 'Export your calendar from Outlook, Google or Apple as an .ics file and link it. Mochi re-reads it every 5 minutes, fully offline.' }),
        h('div', { class: 'btns' },
          button('Link .ics file...', async () => { const r = await api.invoke('meetings:pick-ics'); if (r.ok) toast(`Linked: ${r.count} events found`); }, 'primary'),
          button('Unlink', () => api.invoke('meetings:clear-ics'))), icsInfo),
      h('h2', { text: 'Coming up' }), h('div', { class: 'card pad' }, upcoming),
      h('div', { class: 'btns' }, button('Test meeting reminder', () => api.invoke('test:fire', 'meeting'))));
    return wrap;
  }

  // ---- chrome ----------------------------------------------------------------------------------------------
  function updateChrome() {
    const s = state.settings;
    $('#brand-name').textContent = s.general.petName;
    document.title = `${s.general.petName} Settings`;
    const pa = $('#q-paused'); const dn = $('#q-dnd');
    pa.textContent = s.reminders.paused ? 'Reminders paused' : 'Pause reminders'; pa.setAttribute('aria-pressed', String(s.reminders.paused));
    dn.textContent = s.reminders.dnd ? 'Do not disturb: on' : 'Do not disturb'; dn.setAttribute('aria-pressed', String(s.reminders.dnd));
  }

  function showTab(id, keepScroll = false) {
    const main = $('#main'); const scroll = main.scrollTop;
    currentTab = id;
    for (const p of previews) p.stop(); previews = [];
    bindings = []; main.replaceChildren();
    const tab = TABS.find((t) => t.id === id) || TABS[0];
    const sec = h('section', { 'aria-labelledby': 'tab-title' }); tab.render(sec);
    sec.querySelector('h1').id = 'tab-title';
    main.append(sec);
    refreshAll();
    for (const b of document.querySelectorAll('.tab-btn')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
    main.scrollTop = keepScroll ? scroll : 0;
  }

  function init(initial) {
    state.settings = initial.settings; state.runtime = initial.runtime;
    $('#ver').textContent = `v${state.runtime.version}`;
    const tabs = $('#tabs');
    for (const t of TABS) tabs.append(h('button', { type: 'button', class: 'tab-btn', role: 'tab', 'data-tab': t.id, onclick: () => showTab(t.id) }, h('span', { class: 'txt' }, t.label)));
    $('#q-paused').addEventListener('click', () => patch('reminders.paused', !state.settings.reminders.paused));
    $('#q-dnd').addEventListener('click', () => patch('reminders.dnd', !state.settings.reminders.dnd));
    attachPreview($('#brand-canvas'), () => ({ size: 30, look: state.settings.look, theme: Themes.get(state.settings.theme.id), outfit: [], season: null, particles: false }));
    applyTheme(); updateChrome(); showTab(TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : 'general');

    api.on('settings:changed', ({ settings, origin }) => {
      if (origin === 'settings') return;
      state.settings = settings; applyTheme();
      showTab(origin.startsWith('tab:') ? origin.slice(4) : currentTab, !origin.startsWith('tab:'));
    });
    api.on('runtime:changed', (r) => { state.runtime = r; });
    setInterval(() => { if (state.settings.theme.id === 'auto') applyTheme(); }, 60000);
  }

  api.invoke('app:get-state').then((st) => { if (st) init(st); });
})();
