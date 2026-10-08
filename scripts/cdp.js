'use strict';
// Dev helper: evaluate JS in a running app window over the DevTools protocol.
// Start the app with --remote-debugging-port=9223, then:  node scripts/cdp.js <title-substring> "<expression>"
const [, , titlePart = '', expr = 'document.title'] = process.argv;
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
  const t = targets.find((x) => x.type === 'page' && x.title.includes(titlePart));
  if (!t) { console.log('no target', targets.map((x) => x.title)); return; }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id === 1) { console.log(JSON.stringify(d.result?.result?.value ?? d.result ?? d.error, null, 1)); ws.close(); }
  };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
})();
