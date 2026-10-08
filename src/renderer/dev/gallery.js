/* Dev-only: renders the README screenshots. Open gallery.html#characters | eyes | moods | seasons | themes | buddy */
(function () {
  'use strict';
  const view = location.hash.slice(1) || 'characters';
  const dark = Themes.get('dark');
  Themes.apply(document.body, dark); // speech-bubble colours
  const base = { colorMode: 'fixed', fixedColor: '#f5a33a', customColor: '#7b61ff', rainbowSeconds: 60, cheeks: true, shadow: true, smoothness: 0.5, jelly: 0.8, shape: 'blob', style: 'neutral', eyes: 'classic', happyEyes: 'arcs' };
  const title = (t) => { const h = document.createElement('h1'); h.textContent = t; document.body.append(h); };
  const grid = (cols) => { const g = document.createElement('div'); g.className = 'grid'; g.style.gridTemplateColumns = `repeat(${cols}, 1fr)`; document.body.append(g); return g; };

  function card(parent, label, sub, o = {}) {
    const el = document.createElement('div'); el.className = 'card';
    if (o.bubble) { const b = document.createElement('div'); b.className = 'bubble'; b.textContent = o.bubble; el.append(b); }
    const c = document.createElement('canvas'); c.style.height = `${o.h || 180}px`; el.append(c);
    if (o.edge) { const e = document.createElement('div'); e.className = 'edge'; e.style.top = `${10 + (o.h || 180) - 18}px`; e.append(document.createElement('i')); el.append(e); }
    const b = document.createElement('b'); b.textContent = label; el.append(b);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
    parent.append(el);
    Mochi.snapshot(c, { size: o.size || 86, look: { ...base, ...(o.look || {}) }, theme: o.theme || dark, outfit: o.outfit || [], season: null, particles: false }, o.opts || {});
    return el;
  }

  if (view === 'characters') {
    title('15 characters, 13 shapes, 3 gender styles');
    const g = grid(5);
    for (const p of Shapes.PRESETS) card(g, p.name, `${Shapes.get(p.shape).name} · ${p.style}`, { look: { shape: p.shape, style: p.style, fixedColor: p.color }, size: 92, h: 190 });
  } else if (view === 'eyes') {
    title('Eye styles, and what his eyes become when he is happy');
    const g = grid(4);
    card(g, 'Classic', 'base eyes', { size: 90 });
    card(g, 'Sparkly', 'base eyes', { size: 90, look: { eyes: 'sparkly', style: 'female', fixedColor: '#f472b6' } });
    card(g, 'Sleepy', 'base eyes', { size: 90, look: { eyes: 'sleepy', fixedColor: '#7b8cde' } });
    card(g, 'Googly', 'base eyes, pupils slosh around', { size: 90, look: { eyes: 'googly', fixedColor: '#4ade80' } });
    card(g, 'Happy arcs', 'when happy', { size: 90, opts: { happy: true } });
    card(g, 'Star eyes', 'when happy', { size: 90, look: { happyEyes: 'stars', fixedColor: '#a78bfa' }, opts: { happy: true } });
    card(g, 'Heart eyes', 'when happy', { size: 90, look: { happyEyes: 'hearts', style: 'female', fixedColor: '#f472b6' }, opts: { happy: true } });
    card(g, 'Sparkly + hearts', 'the full cute combo', { size: 90, look: { eyes: 'sparkly', happyEyes: 'hearts', shape: 'cat', style: 'female' }, opts: { happy: true } });
  } else if (view === 'moods') {
    title('Moods, reactions and the liquid wobble');
    const g = grid(4);
    card(g, 'Idle', 'breathing, blinking, following your cursor', { size: 88 });
    card(g, 'Sleeping', 'falls asleep when you are away', { size: 88, look: { fixedColor: '#7b8cde' }, opts: { setup: (m) => m.setSleeping(true), frames: 160 } });
    card(g, 'Dizzy', 'three fast clicks', { size: 88, look: { fixedColor: '#9bd44a' }, opts: { setup: (m) => m.dizzy(), frames: 14 } });
    card(g, 'Teasing', 'tongue out and a wink', { size: 88, look: { style: 'male', fixedColor: '#38bdf8' }, opts: { setup: (m) => m.tongue(5), frames: 12 }, bubble: "You can't catch me!" });
    card(g, 'Peeking', 'over the edge of your windows', { size: 88, look: { shape: 'cat', style: 'female', eyes: 'sparkly' }, opts: { setup: (m) => m.setPeek(true), frames: 90 }, edge: true });
    card(g, 'Picked up', 'hangs and sloshes like jelly', { size: 88, look: { shape: 'slime', fixedColor: '#6ee06e' }, opts: { setup: (m) => m.setFrame({ cx: 0, cy: 0, vx: 380, vy: 0, walking: false, dragging: true }), frames: 22 } });
    card(g, 'Slime', 'translucent, with bubbles and drips', { size: 88, look: { shape: 'slime', style: 'female', fixedColor: '#f472b6' } });
    card(g, 'Ghost', 'floats instead of standing', { size: 88, look: { shape: 'ghost', fixedColor: '#cbd5e1', eyes: 'googly' } });
  } else if (view === 'seasons') {
    title('Seasonal outfits (picked by the calendar) and accessories');
    const g = grid(5);
    const o = (id, color) => [{ id, color }];
    card(g, 'Christmas', 'santa hat', { size: 84, h: 200, outfit: o('santaHat', '#dc2626'), look: { fixedColor: '#ef4444' } });
    card(g, 'Halloween', 'witch hat', { size: 84, h: 200, outfit: o('witchHat', '#4c1d95'), look: { fixedColor: '#fb923c' } });
    card(g, 'Spring', 'flower crown', { size: 84, h: 200, outfit: o('flowerCrown', '#f472b6'), look: { fixedColor: '#f9a8d4', style: 'female' } });
    card(g, 'Summer', 'sunglasses and straw hat', { size: 84, h: 200, outfit: [{ id: 'strawHat', color: '#e8c070' }, { id: 'sunglasses', color: '#1f2937' }], look: { fixedColor: '#fbbf24' } });
    card(g, 'Autumn', 'leaf', { size: 84, h: 200, outfit: o('leaf', '#ea580c'), look: { fixedColor: '#ea7a2c' } });
    card(g, 'Easter', 'bunny ears', { size: 84, h: 200, outfit: o('bunnyEars', '#fbcfe8'), look: { fixedColor: '#fbcfe8' } });
    card(g, 'New Year', 'party hat', { size: 84, h: 200, outfit: o('partyHat', '#a855f7'), look: { fixedColor: '#a78bfa' } });
    card(g, 'Valentine', 'floating hearts', { size: 84, h: 200, outfit: o('hearts', '#fb7185'), look: { fixedColor: '#fb7185', style: 'female' } });
    card(g, 'Winter', 'beanie and scarf', { size: 84, h: 200, outfit: [{ id: 'beanie', color: '#3b82f6' }, { id: 'scarf', color: '#ef4444' }], look: { fixedColor: '#8ec5ff' } });
    card(g, 'Everyday', 'crown, glasses, bow tie, headphones', { size: 84, h: 200, outfit: [{ id: 'crown', color: '#fbbf24' }, { id: 'glasses', color: '#2b2b38' }, { id: 'bowtie', color: '#ef4444' }, { id: 'headphones', color: '#6366f1' }] });
  } else if (view === 'themes') {
    title('Six themes: they restyle the pet, the speech bubble and the settings window');
    const g = grid(3);
    const lines = { light: 'Time to drink some water!', dark: 'Stretch break?', pastel: 'You are doing great!', neon: 'Eye break: 20 seconds', retro: 'Lunch time!', auto: 'Light by day, dark at night' };
    for (const id of ['light', 'dark', 'pastel', 'neon', 'retro']) {
      const th = Themes.get(id); const el = card(g, th.name, 'pet + bubble + settings', { theme: th, size: 80, h: 170, bubble: lines[id], look: { fixedColor: ['#f5a33a', '#8b7bff', '#f9a8d4', '#22d3ee', '#e0674f'][['light', 'dark', 'pastel', 'neon', 'retro'].indexOf(id)] } });
      Themes.apply(el, th); el.style.background = th.ui.panel; el.style.borderColor = th.ui.border; el.style.color = th.ui.text;
    }
  } else if (view === 'buddy') {
    title('A buddy that walks beside him, and he sits on top of your windows');
    const desk = document.createElement('div'); desk.className = 'desk';
    desk.innerHTML = '<div class="win"><i></i></div><div class="bar"></div>';
    const c = document.createElement('canvas'); desk.append(c); document.body.append(desk);
    // two pets drawn onto one canvas: the leader perched on the window edge, the buddy beside him
    const W = 1100; const H = 330; const d = window.devicePixelRatio || 1; c.width = W * d; c.height = H * d;
    const ctx = c.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
    const mk = (size, look, setup) => { const m = new Mochi(); m.configure({ size, look: { ...base, ...look }, theme: dark, outfit: [], season: null, particles: false }); m.cursor = { x: 600, y: 120 }; if (setup) setup(m); for (let i = 0; i < 60; i++) m.update(1 / 60); return m; };
    const leader = mk(100, { shape: 'cat', style: 'female', fixedColor: '#f5a33a', eyes: 'sparkly', happyEyes: 'hearts' }, (m) => { m.happyT = 99; });
    const buddy = mk(56, { shape: 'slime', style: 'neutral', fixedColor: '#6ee06e' }, (m) => { m.happyT = 99; });
    const layer = (m, x, feetY) => { const t = document.createElement('canvas'); t.width = 340 * d; t.height = 300 * d; const tc = t.getContext('2d'); tc.setTransform(d, 0, 0, d, 0, 0); m.draw(tc, 340, 300 - 0); ctx.drawImage(t, x - 170, feetY - 282, 340, 300); };
    layer(leader, 330, 128 + 18); layer(buddy, 430, 128 + 18);
    ctx.fillStyle = '#e8eaf2'; ctx.font = '600 13px "Segoe UI"'; ctx.textAlign = 'center';
    ctx.fillText('he sits on a window edge, with his buddy beside him', 380, H - 12);
  } else {
    title(`unknown view: ${view}`);
  }
})();
