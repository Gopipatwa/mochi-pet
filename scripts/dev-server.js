'use strict';
// Static server for previewing the renderer pages in a normal browser (dev only), with a mock API.
// Usage: npm run preview   then open http://127.0.0.1:5173/renderer/dev/pet.html or .../settings.html
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
const defaults = path.join(__dirname, '..', 'src-tauri', 'src', 'defaults.json'); // single source of default settings
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/defaults.json' ? defaults : path.join(root, url);
  if (!file.startsWith(root) && file !== defaults) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  });
}).listen(Number(process.argv[2]) || 5173, '127.0.0.1', () => console.log('preview server on http://127.0.0.1:5173'));
