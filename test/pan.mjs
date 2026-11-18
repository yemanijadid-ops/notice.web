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
const env = { DB: db, TERMS_VERSION: '2026-11-06', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec',
  GOOGLE_AUTH_URL: BASE + '/__google', GOOGLE_TOKEN_URL: BASE + '/__token' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.txt': 'text/plain' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  if (url.pathname === '/__google') { // fake Google consent screen: approve immediately
    res.writeHead(302, { Location: `${BASE}/api/auth/google/callback?code=fake&state=${url.searchParams.get('state')}` }); return res.end();
  }
  if (url.pathname === '/__token') {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const claims = { iss: 'https://accounts.google.com', aud: 'cid', sub: 'g-e2e', email: 'e2e@example.com', name: 'E2E', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 };
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id_token: `h.${b64(claims)}.s` }));
  }
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
await page.goto(BASE + '/');
await page.check('#terms');
await Promise.all([page.waitForSelector('.board-viewport'), page.click('.nb-login button.primary')]);
await page.waitForTimeout(1500);
const out = process.argv[2];
const info = async () => page.evaluate(() => {
  const c = document.querySelector('.cork').getBoundingClientRect();
  const p = document.querySelector('.paper').getBoundingClientRect();
  const v = document.querySelector('.board-viewport').getBoundingClientRect();
  return { corkLeft: Math.round(c.left), corkTop: Math.round(c.top), corkW: Math.round(c.width), corkH: Math.round(c.height), paperLeft: Math.round(p.left), paperTop: Math.round(p.top), vw: Math.round(v.width), vh: Math.round(v.height) };
});
console.log('before', JSON.stringify(await info()));
await page.screenshot({ path: out + '/before.png' });
await page.mouse.move(900, 600); await page.mouse.down(); await page.mouse.move(700, 500, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(1500);
console.log('after ', JSON.stringify(await info()));
await page.screenshot({ path: out + '/after.png' });
await browser.close(); server.close();
