// Full browser test: the real app + real worker + fake D1, with the real Content-Security-Policy from public/_headers.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import worker from '../src/worker.js';
import { makeDb } from './fake-d1.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const PORT = 8766, BASE = `http://localhost:${PORT}`;
const PUB = new URL('../public/', import.meta.url).pathname;
const csp = /Content-Security-Policy:\s*(.+)/.exec(readFileSync(PUB + '_headers', 'utf8'))[1].trim();
const db = makeDb();
const env = { DB: db, TERMS_VERSION: '2026-11-18' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.txt': 'text/plain' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body, redirect: 'manual' }), env);
    const h = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
    h['set-cookie'] = r.headers.getSetCookie();
    res.writeHead(r.status, h); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  let f = join(PUB, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!f.startsWith(PUB) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'content-security-policy': csp });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
// 401 (before sign-in / after sign-out) and 413 (the deliberate oversize upload) are expected; anything else, CSP violations included, is a problem
page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|413)/.test(m.text())) problems.push('console: ' + m.text()); });
const steps = [];
const step = (s) => steps.push(s);

await page.goto(BASE + '/');
await page.waitForSelector('.nb-login');
await page.click('.tabs .tab:nth-child(2)');
await page.fill('input[type=email]', 'e2e@example.com');
await page.fill('input[autocomplete=new-password] >> nth=0', 'correct horse');
await page.fill('input[autocomplete=new-password] >> nth=1', 'correct horse');
await page.click('.nb-login button.primary');
assert.match(await page.textContent('.nb-login .msg'), /pledge/);
step('sign-up is blocked until the pledge box is ticked');

await page.click('.nb-login .linkbtn >> nth=0'); // switch to Persian
assert.equal(await page.getAttribute('.nb-login', 'dir'), 'rtl');
assert.match(await page.textContent('.nb-login'), /عهدنامه/);
await page.click('.nb-login .linkbtn >> nth=0'); // and back
step('Persian / English switch works (right-to-left layout)');

await page.fill('input[type=email]', 'e2e@example.com');
await page.fill('input[autocomplete=new-password] >> nth=0', 'correct horse');
await page.fill('input[autocomplete=new-password] >> nth=1', 'correct horse');
await page.check('#terms');
await page.click('.nb-login button.primary');
await page.waitForSelector('.nb-login .code');
const code = await page.textContent('.nb-login .code');
assert.match(code, /^([A-Z2-9]{5}-){3}[A-Z2-9]{5}$/);
assert.ok(await page.isDisabled('.nb-login button.primary'));
await page.check('#saved');
await Promise.all([page.waitForSelector('.topbar'), page.click('.nb-login button.primary')]);
assert.deepEqual(await page.locator('.tab').allInnerTexts(), ['Atlas', 'Board', 'Journal']);
step('sign-up (password stretched in the browser) shows the recovery code, then lands in the app');
const storedHash = db.raw.prepare('SELECT pass_hash FROM users').get().pass_hash;
assert.ok(!storedHash.includes('correct'));

await page.waitForTimeout(1200); // the app saves a brand-new board after 500 ms
const row = db.raw.prepare('SELECT data FROM user_data').get();
assert.ok(row && JSON.parse(row.data).version === 1);
step('first save reached the database');

await page.reload();
await page.waitForSelector('.topbar');
step('reload keeps the session and loads saved data');

const media = await page.evaluate(async () => {
  // a noisy 2400x2400 PNG, well over the 300 KB shrink threshold
  const c = document.createElement('canvas'); c.width = 2400; c.height = 2400;
  const x = c.getContext('2d'); const img = x.createImageData(2400, 2400);
  // smooth colours with a bit of grain, like a photo
  for (let p = 0, i = 0; i < img.data.length; i += 4, p++) { const px = p % 2400, py = (p / 2400) | 0, g = (Math.random() * 12) | 0; img.data[i] = (px / 2400 * 255 + g) % 256; img.data[i + 1] = (py / 2400 * 255 + g) % 256; img.data[i + 2] = ((px + py) / 4800 * 255 + g) % 256; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  const png = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
  const name = await window.nbApi.saveMedia('png', png);
  const el = new Image(); el.src = window.nbApi.mediaUrl(name);
  await new Promise((r) => { el.onload = r; el.onerror = r; });
  const voice = await window.nbApi.saveMedia('webm', new Uint8Array(50000).fill(3));
  const part = await fetch(window.nbApi.mediaUrl(voice), { headers: { Range: 'bytes=0-99' } });
  let tooBig = '';
  try { await window.nbApi.saveMedia('png', new Uint8Array(1000).fill(1)); await window.nbApi.saveMedia('gif', new Uint8Array(5 * 1024 * 1024).fill(1)); } catch (e) { tooBig = e.userMessage; }
  return { name, pngBytes: png.length, w: el.naturalWidth, voice, rangeStatus: part.status, rangeLen: (await part.arrayBuffer()).byteLength, tooBig };
});
assert.match(media.name, /\.jpg$/, 'big PNG should be shrunk to JPEG');
const stored = db.raw.prepare('SELECT bytes FROM media WHERE name = ?').get(media.name).bytes;
assert.ok(stored < media.pngBytes / 3, `shrunk ${media.pngBytes} -> ${stored}`);
assert.equal(media.w, 1600);
assert.equal(media.rangeStatus, 206);
assert.equal(media.rangeLen, 100);
assert.match(media.tooBig, /too big/);
step(`photo shrunk ${(media.pngBytes / 1e6).toFixed(1)} MB -> ${(stored / 1e3).toFixed(0)} KB, shows under the CSP; voice range request works; oversize file gives a friendly message`);

await page.screenshot({ path: new URL('./app.png', import.meta.url).pathname });
// settings: account section and "coming soon" plans
await page.click('.gear');
await page.waitForSelector('.settings-modal');
const acct = await page.textContent('.acct');
assert.match(acct, /e2e@example.com/);
assert.match(acct, /Coming soon/);
assert.match(acct, /Nothing is charged today/);
step('settings shows the account, space used and plans as coming soon');
await page.keyboard.press('Escape');

await page.evaluate(() => window.nbApi.signOut());
await page.waitForSelector('.nb-login');
step('sign out returns to the login screen');

await page.fill('input[type=email]', 'e2e@example.com');
await page.fill('input[autocomplete=current-password]', 'wrong password');
await page.click('.nb-login button.primary');
await page.waitForFunction(() => /Wrong email or password/.test(document.querySelector('.nb-login .msg').textContent));
await page.fill('input[autocomplete=current-password]', 'correct horse');
await Promise.all([page.waitForSelector('.topbar'), page.click('.nb-login button.primary')]);
step('wrong password is refused, right password signs in again');
await page.evaluate(() => window.nbApi.signOut());
await page.waitForSelector('.nb-login');

// guest
await page.check('#terms');
await Promise.all([page.waitForSelector('.topbar'), page.click('.nb-login button.guest')]);
assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM users WHERE kind='guest'").get().n, 1);
step('guest login works');

console.log(steps.map((s) => '  ok  ' + s).join('\n'));
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console errors, no CSP violations');
await browser.close(); server.close();
if (problems.length) process.exit(1);
