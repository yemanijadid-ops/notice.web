import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { makeDb } from './fake-d1.mjs';

const db = makeDb();
const env = { DB: db, TERMS_VERSION: 'v1' };
const ORIGIN = 'https://nb.test';
let cookies = {};
let ipN = 0;
const KEY = (c) => c.repeat(64); // stands in for the key the browser derives from a password

async function api(path, { method = 'GET', body, headers = {}, csrf = true, jar = true } = {}) {
  const h = { 'cf-connecting-ip': '10.0.0.' + (ipN % 200), ...headers };
  if (jar && Object.keys(cookies).length) h.cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  if (csrf && method !== 'GET') h['x-requested-with'] = 'notice';
  const res = await worker.fetch(new Request(ORIGIN + path, { method, body, headers: h, redirect: 'manual' }), env);
  for (const sc of res.headers.getSetCookie()) {
    const [pair, ...attrs] = sc.split(';');
    const i = pair.indexOf('=');
    const k = pair.slice(0, i), v = pair.slice(i + 1);
    if (/Max-Age=0/i.test(attrs.join(';')) || v === '') delete cookies[k]; else cookies[k] = v;
  }
  return res;
}
const b64 = (n, fill = 7) => Buffer.alloc(n, fill).toString('base64');
const results = [];
const test = async (name, fn) => { await fn(); results.push(name); };

await test('not signed in', async () => {
  const r = await api('/api/me');
  assert.equal(r.status, 401);
  assert.equal((await r.json()).termsVersion, 'v1');
  assert.equal((await api('/api/data')).status, 401);
});

let recovery;
await test('sign up needs the pledge, a real email and a key', async () => {
  const post = (body) => api('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await post({ email: 'me@example.com', key: KEY('a') })).status, 400);
  assert.equal((await post({ email: 'me@example.com', key: KEY('a'), terms: 'old' })).status, 400);
  assert.equal((await post({ email: 'nope', key: KEY('a'), terms: 'v1' })).status, 400);
  assert.equal((await post({ email: 'me@example.com', key: 'short', terms: 'v1' })).status, 400);
  assert.equal(cookies.nb_session, undefined);
});

await test('sign up works, stores only hashes, and signs in', async () => {
  const r = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: ' Me@Example.com ', key: KEY('a'), terms: 'v1' }) });
  assert.equal(r.status, 200);
  recovery = (await r.json()).recoveryCode;
  assert.match(recovery, /^([A-Z2-9]{5}-){3}[A-Z2-9]{5}$/);
  assert.ok(cookies.nb_session);
  const me = await (await api('/api/me')).json();
  assert.equal(me.email, 'me@example.com');
  assert.equal(me.kind, 'user');
  assert.equal(me.plan, 'free');
  assert.equal(me.limits.maxPapers, 15);
  const u = db.raw.prepare('SELECT * FROM users').get();
  assert.equal(u.terms_version, 'v1');
  const dump = JSON.stringify(u);
  assert.ok(!dump.includes(KEY('a')) && !dump.includes(recovery.replace(/-/g, '')), 'no key or code stored in the clear');
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(cookies.nb_session).n, 0);
  // same email again (any capitalisation) is refused
  const dup = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'ME@example.com', key: KEY('b'), terms: 'v1' }) });
  assert.equal(dup.status, 409);
});

await test('log out and log in again; wrong password fails', async () => {
  assert.equal((await api('/api/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await api('/api/me')).status, 401);
  const login = (email, key) => api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, key }) });
  const bad = await login('me@example.com', KEY('b'));
  assert.equal(bad.status, 401);
  assert.equal((await login('nobody@example.com', KEY('a'))).status, 401);
  assert.equal(cookies.nb_session, undefined);
  assert.equal((await login('ME@example.com', KEY('a'))).status, 200);
  assert.equal((await api('/api/me')).status, 200);
});

await test('password guessing is slowed down', async () => {
  cookies = {};
  const login = () => api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'victim@example.com', key: KEY('c') }) });
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await login()).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(401));
  assert.equal(codes[9], 429);
  db.raw.prepare('DELETE FROM abuse').run();
  // log back in for the next tests
  assert.equal((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'me@example.com', key: KEY('a') }) })).status, 200);
});

await test('recovery code resets the password once, and signs other sessions out', async () => {
  const old = { ...cookies };
  cookies = {};
  const rec = (code, key) => api('/api/auth/recover', { method: 'POST', body: JSON.stringify({ email: 'me@example.com', recoveryCode: code, key }) });
  assert.equal((await rec('AAAAA-BBBBB-CCCCC-DDDDD', KEY('d'))).status, 401);
  const ok = await rec(recovery.toLowerCase(), KEY('d'));
  assert.equal(ok.status, 200);
  const fresh = (await ok.json()).recoveryCode;
  assert.notEqual(fresh, recovery);
  assert.equal((await api('/api/me')).status, 200);
  const mine = { ...cookies };
  cookies = old;
  assert.equal((await api('/api/me')).status, 401, 'old session must be gone');
  assert.equal((await rec(recovery, KEY('e'))).status, 401, 'old code must not work twice');
  cookies = {};
  assert.equal((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'me@example.com', key: KEY('a') }) })).status, 401);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'me@example.com', key: KEY('d') }) })).status, 200);
  recovery = fresh;
});

await test('new recovery code needs the password', async () => {
  const nc = (key) => api('/api/auth/newcode', { method: 'POST', body: JSON.stringify({ key }) });
  assert.equal((await nc(KEY('a'))).status, 401);
  const r = await nc(KEY('d'));
  assert.equal(r.status, 200);
  assert.notEqual((await r.json()).recoveryCode, recovery);
});

await test('csrf header is required for changes', async () => {
  const r = await api('/api/data', { method: 'PUT', body: '{}', csrf: false });
  assert.equal(r.status, 403);
});

await test('data save and load, including Persian text', async () => {
  assert.equal((await api('/api/data')).status, 204);
  const doc = { version: 1, papers: [], boards: [], note: 'سلام دنیا' };
  assert.equal((await api('/api/data', { method: 'PUT', body: JSON.stringify(doc) })).status, 200);
  const back = await (await api('/api/data')).json();
  assert.deepEqual(back, doc);
  assert.equal((await api('/api/data', { method: 'PUT', body: 'not json' })).status, 400);
  assert.equal((await api('/api/data', { method: 'PUT', body: '[1]' })).status, 400);
  const huge = JSON.stringify({ papers: [], pad: 'x'.repeat(1600000) });
  assert.equal((await api('/api/data', { method: 'PUT', body: huge })).status, 413);
});

await test('plan limits: papers and boards', async () => {
  const papers = (n) => JSON.stringify({ papers: Array.from({ length: n }, (_, i) => ({ id: i })), boards: [] });
  assert.equal((await api('/api/data', { method: 'PUT', body: papers(15) })).status, 200);
  const r = await api('/api/data', { method: 'PUT', body: papers(16) });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'plan_limit:papers');
  const r2 = await api('/api/data', { method: 'PUT', body: JSON.stringify({ papers: [], boards: [{}, {}] }) });
  assert.equal((await r2.json()).error, 'plan_limit:boards');
  // a downgraded user over the limit can still edit and delete
  db.raw.prepare("UPDATE users SET plan='pro'").run();
  assert.equal((await api('/api/data', { method: 'PUT', body: papers(30) })).status, 200);
  db.raw.prepare("UPDATE users SET plan='free'").run();
  assert.equal((await api('/api/data', { method: 'PUT', body: papers(29) })).status, 200);
  assert.equal((await api('/api/data', { method: 'PUT', body: papers(31) })).status, 403);
  assert.equal((await api('/api/data', { method: 'PUT', body: papers(5) })).status, 200);
});

let mediaName;
await test('media: upload, download, range, delete', async () => {
  const payload = Buffer.from(Array.from({ length: 1500000 }, (_, i) => i % 251)); // spans 3 chunks
  const r = await api('/api/media?ext=webm', { method: 'POST', body: payload.toString('base64') });
  assert.equal(r.status, 200);
  const { name, bytes } = await r.json();
  mediaName = name;
  assert.equal(bytes, 1500000);
  assert.match(name, /^[a-f0-9]{20}\.webm$/);
  assert.equal(db.raw.prepare('SELECT chunks FROM media WHERE name=?').get(name).chunks, 3);

  const g = await api('/api/media/' + name);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('content-type'), 'audio/webm');
  assert.ok(Buffer.from(await g.arrayBuffer()).equals(payload));

  const part = await api('/api/media/' + name, { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/1500000');
  assert.ok(Buffer.from(await part.arrayBuffer()).equals(payload.subarray(100, 200)));
  const tail = await api('/api/media/' + name, { headers: { range: 'bytes=-10' } });
  assert.ok(Buffer.from(await tail.arrayBuffer()).equals(payload.subarray(1499990)));
  assert.equal((await api('/api/media/' + name, { headers: { range: 'bytes=9999999-' } })).status, 416);
});

await test('media: bad type, too big, quota', async () => {
  assert.equal((await api('/api/media?ext=svg', { method: 'POST', body: b64(10) })).status, 400);
  assert.equal((await api('/api/media?ext=exe', { method: 'POST', body: b64(10) })).status, 400);
  assert.equal((await api('/api/media?ext=png', { method: 'POST', body: '' })).status, 400);
  const big = await api('/api/media?ext=png', { method: 'POST', body: b64(4 * 1024 * 1024 + 100) });
  assert.equal(big.status, 413);
  // fill the 100 MB free quota with 4 MB files (1.5 MB already used)
  let ok = 0, last;
  for (let i = 0; i < 30; i++) {
    last = await api('/api/media?ext=png', { method: 'POST', body: b64(4 * 1024 * 1024) });
    if (last.status !== 200) break;
    ok++;
  }
  assert.equal(last.status, 403);
  assert.equal((await last.json()).error, 'plan_limit:storage');
  assert.ok(ok >= 20 && ok <= 25, 'filled with ' + ok);
  const me = await (await api('/api/me')).json();
  assert.ok(me.usage.storageBytes <= me.limits.maxStorageBytes);
});

await test('media: deleting frees space and removes pieces', async () => {
  assert.equal((await api('/api/media/' + mediaName, { method: 'DELETE' })).status, 200);
  assert.equal((await api('/api/media/' + mediaName)).status, 404);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM media_chunks WHERE name=?').get(mediaName).n, 0);
});

await test("another user cannot see someone else's data or files", async () => {
  const owner = { ...cookies };
  const names = db.raw.prepare('SELECT name FROM media LIMIT 1').get().name;
  cookies = {};
  await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'other@example.com', key: KEY('f'), terms: 'v1' }) });
  assert.equal((await api('/api/data')).status, 204);
  assert.equal((await api('/api/media/' + names)).status, 404);
  assert.equal((await api('/api/media/' + names, { method: 'DELETE' })).status, 200); // no effect on the owner
  cookies = owner;
  assert.equal((await api('/api/media/' + names)).status, 200);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
});

await test('delete account removes everything', async () => {
  assert.equal((await api('/api/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'me@example.com', key: KEY('d') }) })).status, 200);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
  assert.equal((await api('/api/account', { method: 'DELETE' })).status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM users WHERE email='me@example.com'").get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM user_data').get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM media').get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM media_chunks').get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1); // only the other user's
  assert.equal((await api('/api/me')).status, 401);
});

await test('guest: needs the pledge, smaller limits, can upgrade and keep data', async () => {
  cookies = {};
  assert.equal((await api('/api/auth/guest', { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ terms: 'v1' }) })).status, 200);
  const me = await (await api('/api/me')).json();
  assert.equal(me.kind, 'guest');
  assert.equal(me.email, null);
  assert.equal(me.limits.maxPapers, 10);
  assert.equal(me.limits.maxStorageBytes, 20 * 1024 * 1024);
  const papers = (n) => JSON.stringify({ papers: Array.from({ length: n }, (_, i) => ({ id: i })), boards: [] });
  assert.equal((await api('/api/data', { method: 'PUT', body: papers(10) })).status, 200);
  assert.equal((await api('/api/data', { method: 'PUT', body: papers(11) })).status, 403);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: '', key: KEY('a') }) })).status, 400);
  // guests have no password to change and cannot ask for a recovery code
  assert.equal((await api('/api/auth/newcode', { method: 'POST', body: JSON.stringify({ key: KEY('a') }) })).status, 400);
  const up = await api('/api/auth/upgrade', { method: 'POST', body: JSON.stringify({ email: 'g@example.com', key: KEY('9') }) });
  assert.equal(up.status, 200);
  assert.ok((await up.json()).recoveryCode);
  const after = await (await api('/api/me')).json();
  assert.equal(after.kind, 'user');
  assert.equal(after.plan, 'free');
  assert.equal(after.limits.maxPapers, 15);
  assert.equal(JSON.parse(await (await api('/api/data')).text()).papers.length, 10, 'notes kept');
  assert.equal((await api('/api/auth/upgrade', { method: 'POST', body: JSON.stringify({ email: 'x@example.com', key: KEY('9') }) })).status, 400);
});

await test('guest spam is limited per address', async () => {
  cookies = {};
  const same = { 'cf-connecting-ip': '9.9.9.9' };
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ terms: 'v1' }), headers: same })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
});

await test('daily cleanup forgets old guests only', async () => {
  const { cleanup } = await import('../src/worker.js');
  const old = Date.now() - 31 * 86400000;
  db.raw.prepare("UPDATE users SET last_seen = ? WHERE kind = 'guest'").run(old);
  db.raw.prepare("UPDATE users SET last_seen = ? WHERE email = 'g@example.com'").run(old); // a full account is never auto-deleted
  const before = db.raw.prepare('SELECT COUNT(*) n FROM users').get().n;
  await cleanup(env);
  const guestsLeft = db.raw.prepare("SELECT COUNT(*) n FROM users WHERE kind='guest'").get().n;
  assert.equal(guestsLeft, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM users WHERE email='g@example.com'").get().n, 1);
  assert.ok(before > db.raw.prepare('SELECT COUNT(*) n FROM users').get().n);
});

console.log(results.map((r) => '  ok  ' + r).join('\n'));
console.log(results.length + ' tests passed');
