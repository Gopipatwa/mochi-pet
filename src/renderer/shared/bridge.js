/* The pages talk to the app only through `window.api` (invoke / send / on). This maps it onto Tauri's
   invoke and event APIs. The contract is documented in src/shared/ipc.d.ts. */
(function () {
  'use strict';
  if (window.api || !window.__TAURI__) return;
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  window.api = {
    invoke: (channel, ...args) => invoke('ipc_invoke', { channel, args }),
    send: (channel, ...args) => { invoke('ipc_send', { channel, args }).catch(() => {}); },
    role: window.__TAURI__.window.getCurrentWindow().label === 'buddy' ? 'buddy' : 'main',
    on(channel, cb) {
      let off = null; let dead = false;
      listen(`mochi:${channel}`, (e) => cb(e.payload)).then((fn) => { if (dead) fn(); else off = fn; });
      return () => { dead = true; if (off) off(); };
    },
  };
})();
