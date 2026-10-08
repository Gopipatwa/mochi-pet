'use strict';
// Regenerates docs/screenshots/*.png for the README by rendering the dev gallery and settings pages in
// headless Edge. Everything is synthetic, so nothing from a real desktop ends up in the images.
//   npm run screenshots
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'screenshots');
const edge = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!edge) { console.error('Edge or Chrome not found. Set EDGE_PATH.'); process.exit(1); }

const PORT = 5199;
const shots = [
  ['characters', 'gallery.html#characters', 1240, 820],
  ['eyes', 'gallery.html#eyes', 1100, 600],
  ['moods', 'gallery.html#moods', 1100, 600],
  ['seasons', 'gallery.html#seasons', 1240, 480],
  ['themes', 'gallery.html#themes', 1100, 660],
  ['buddy-and-windows', 'gallery.html#buddy', 1150, 440],
  ['settings-look', 'settings.html#look', 1100, 820],
  ['settings-friends', 'settings.html#friends', 1100, 820],
  ['settings-reminders', 'settings.html#reminders', 1100, 820],
  ['settings-accessories', 'settings.html#accessories', 1100, 820],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Edge writes the PNG and then lingers, so wait for the file to settle and close it ourselves. */
async function capture(name, page, w, h) {
  const file = path.join(out, `${name}.png`);
  fs.rmSync(file, { force: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-shots-')); // fresh profile so no running browser is reused
  const child = spawn(edge, [
    '--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${w},${h}`, '--virtual-time-budget=5000',
    `--screenshot=${file}`, `http://127.0.0.1:${PORT}/renderer/dev/${page}`,
  ], { stdio: 'ignore' });
  let size = -1;
  for (let i = 0; i < 80; i++) { // up to 20 s
    await sleep(250);
    const now = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (now > 0 && now === size) break;
    size = now;
  }
  child.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* temp dir */ }
  console.log(fs.existsSync(file) ? `ok   ${name}.png` : `FAIL ${name}`);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js'), String(PORT)], { stdio: 'ignore' });
  await sleep(800);
  for (const s of shots) await capture(...s);
  server.kill();
})();
