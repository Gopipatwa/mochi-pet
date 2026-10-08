/* Dev-only: lets the renderer pages run in a plain browser tab (no Tauri) for visual testing.
   Default settings come from src-tauri/src/defaults.json, the same file the app embeds. */
(function () {
  'use strict';
  if (window.api) return;
  let defaults = null; const settings = {};
  const ready = fetch('/defaults.json').then((r) => r.json()).then((d) => { defaults = d; Object.assign(settings, structuredClone(d)); });
  const runtime = { paused: false, dnd: false, fullscreen: false, sleeping: false, petVisible: true, version: 'dev', packaged: false };
  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((cb) => cb(p));
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  function assign(t, s) { for (const k of Object.keys(s)) { if (isObj(s[k]) && isObj(t[k])) assign(t[k], s[k]); else t[k] = s[k]; } return t; }
  let walking = false; let walkVx = 0; let cursor = { x: 0, y: 0 }; let dragging = false; let peek = false;

  function frame() { emit('pet:frame', { cx: cursor.x, cy: cursor.y, vx: walkVx, vy: 0, walking, dragging, peek }); }
  window.addEventListener('pointermove', (e) => { cursor = { x: e.clientX, y: e.clientY }; frame(); });
  setInterval(frame, 100);

  window.__mock = {
    peek(v) { peek = v; frame(); },
    emit,
    walk(v) { walking = v !== 0; walkVx = v; frame(); },
    drag(on) { dragging = on; walkVx = on ? 400 : 0; frame(); },
    sleep(on) { runtime.sleeping = on; emit('runtime:changed', { ...runtime }); },
    speak(p) { emit('pet:speak', p); },
    land(i) { emit('pet:landed', { impact: i }); },
    patch(p) { assign(settings, p); emit('settings:changed', { settings, origin: 'mock' }); },
  };

  window.api = {
    role: new URLSearchParams(location.search).get('role') === 'buddy' ? 'buddy' : 'main',
    async invoke(ch, ...a) {
      await ready;
      switch (ch) {
        case 'app:get-state': return { settings, runtime };
        case 'settings:patch': assign(settings, a[0]); emit('settings:changed', { settings, origin: 'settings' }); return settings;
        case 'settings:reset': Object.assign(settings, structuredClone(defaults)); emit('settings:changed', { settings, origin: 'reset' }); return settings;
        case 'meetings:upcoming': return [{ title: 'Design review', at: Date.now() + 25 * 60000, source: 'manual' }, { title: 'Standup', at: Date.now() + 20 * 3600000, source: 'calendar' }];
        case 'test:fire': window.__mock.speak({ id: `t${Date.now()}`, kind: a[0] === 'greeting' ? 'greeting' : a[0], text: a[0] === 'meeting' ? '📅 Weekly sync starts in 10 min' : a[0] === 'greeting' ? 'Good evening, Friend!' : 'Time to drink some water! 💧', ttl: 30, actions: a[0] === 'greeting' ? [] : ['done', 'snooze'], sound: false }); return undefined;
        default: return { ok: false };
      }
    },
    send(ch, ...a) {
      if (ch === 'pet:ready') window.__mock.speak({ id: 'g1', kind: 'greeting', text: 'Good evening, Friend! 🌙', ttl: 60, actions: [], sound: false });
      if (ch === 'pet:drag-start') window.__mock.drag(true);
      if (ch === 'pet:drag-end') window.__mock.drag(false);
      void a;
    },
    on(ch, cb) { (listeners[ch] = listeners[ch] || []).push(cb); return () => {}; },
  };
})();
