/* Notice Board API on Cloudflare Workers + D1.
   Static files (the app) are served by Cloudflare itself; this Worker only handles /api/*.

   Accounts: email + password, or a guest account. Passwords are stretched in the browser (PBKDF2) and the
   Worker only ever sees that derived key, never the password itself, so the free plan's 10 ms CPU limit is no problem.
   There is no email sending yet, so each account gets a one-time recovery code instead of a "reset by email" link. */

const SESSION_DAYS = 30;
const GUEST_KEEP_DAYS = 30;              // guests who do not come back for this long are deleted
const MAX_DATA_BYTES = 1500000;          // one D1 row must stay well under 2 MB
const MAX_MEDIA_BYTES = 4 * 1024 * 1024; // per photo / voice note (the browser shrinks photos first)
const CHUNK_CHARS = 700000;              // base64 characters per D1 row (multiple of 4)
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav'
};
const KEY_RE = /^[0-9a-f]{64}$/;                    // the key the browser derives from the password
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]{1,190}(\.[^\s@.]{1,63})+$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no look-alikes

/* ---------- small helpers ---------- */
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }
});
const fail = (status, code) => json({ error: code }, status);

function toB64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randomToken = (n) => toB64Url(crypto.getRandomValues(new Uint8Array(n)));
const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(str) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function getCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const clientIp = (req) => req.headers.get('cf-connecting-ip') || 'local';
const normEmail = (e) => String(e || '').trim().toLowerCase();

function decodeBase64(b64) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function readJson(req) {
  try {
    const t = await req.text();
    if (t.length > 4096) return null;
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (e) { return null; }
}
function makeRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let s = '';
  for (const x of bytes) s += CODE_ALPHABET[x % 32]; // 256 is a multiple of 32, so every symbol is equally likely
  return s.match(/.{5}/g).join('-');
}
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* ---------- simple abuse limits (kept in D1) ---------- */
async function tooMany(env, key, max, windowMs) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM abuse WHERE key = ? AND ts > ?').bind(key, Date.now() - windowMs).first();
  return (r ? r.n : 0) >= max;
}
const hit = (env, key) => env.DB.prepare('INSERT INTO abuse (key, ts) VALUES (?, ?)').bind(key, Date.now()).run();

/* ---------- sessions ---------- */
async function startSession(env, userId, headers) {
  const token = randomToken(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(userId, Date.now()),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(token), userId, Date.now() + SESSION_DAYS * DAY)
  ]);
  headers.append('Set-Cookie', cookie('nb_session', token, SESSION_DAYS * 86400));
}
async function currentUser(env, req) {
  const tok = getCookie(req, 'nb_session');
  if (!tok) return null;
  const now = Date.now();
  const u = await env.DB.prepare(
    'SELECT u.id, u.kind, u.email, u.plan, u.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
  ).bind(await sha256Hex(tok), now).first();
  if (u && now - u.last_seen > 6 * HOUR) await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, u.id).run();
  return u;
}
async function planFor(env, user) {
  return (await env.DB.prepare('SELECT * FROM plans WHERE key = ?').bind(user.plan).first())
    || (await env.DB.prepare("SELECT * FROM plans WHERE key = 'free'").first());
}
async function usedBytes(env, userId) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM media WHERE user_id = ?').bind(userId).first();
  return r ? r.n : 0;
}

/* ---------- accounts ---------- */
// Stores the login for a user: a random salt plus a hash of the browser-derived key, and a fresh recovery code.
async function credentials(key) {
  const salt = randomHex(16);
  const code = makeRecoveryCode();
  return { salt, hash: await sha256Hex(salt + key), code, codeHash: await sha256Hex(cleanCode(code)) };
}
const isUniqueError = (e) => /UNIQUE/i.test(String((e && e.message) || e));

async function signup(req, env) {
  const b = await readJson(req);
  if (!b || b.terms !== env.TERMS_VERSION) return fail(400, 'terms_required');
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email) || !KEY_RE.test(String(b.key || ''))) return fail(400, 'bad_input');
  const ip = clientIp(req);
  if (await tooMany(env, 'signup:' + ip, 10, HOUR)) return fail(429, 'too_many');
  const c = await credentials(b.key);
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, kind, email, pass_salt, pass_hash, recovery_hash, plan, terms_accepted_at, terms_version, last_seen)
       VALUES (?, 'user', ?, ?, ?, ?, 'free', ?, ?, ?)`
    ).bind(id, email, c.salt, c.hash, c.codeHash, new Date().toISOString(), env.TERMS_VERSION, Date.now()).run();
  } catch (e) {
    if (isUniqueError(e)) return fail(409, 'email_taken');
    throw e;
  }
  await hit(env, 'signup:' + ip);
  const headers = new Headers();
  await startSession(env, id, headers);
  return json({ recoveryCode: c.code }, 200, { 'set-cookie': headers.get('set-cookie') });
}

async function login(req, env) {
  const b = await readJson(req);
  const email = normEmail(b && b.email);
  if (!b || !EMAIL_RE.test(email) || !KEY_RE.test(String(b.key || ''))) return fail(400, 'bad_input');
  const ip = clientIp(req);
  if (await tooMany(env, 'fail:e:' + email, 8, 15 * MINUTE) || await tooMany(env, 'fail:ip:' + ip, 40, 15 * MINUTE)) return fail(429, 'too_many');
  const u = await env.DB.prepare("SELECT id, pass_salt, pass_hash FROM users WHERE email = ? AND kind = 'user'").bind(email).first();
  const given = await sha256Hex((u ? u.pass_salt : '0'.repeat(32)) + b.key); // same work whether or not the email exists
  if (!u || !safeEqual(given, u.pass_hash)) {
    await hit(env, 'fail:e:' + email); await hit(env, 'fail:ip:' + ip);
    return fail(401, 'bad_credentials');
  }
  const headers = new Headers();
  await startSession(env, u.id, headers);
  return json({ ok: true }, 200, { 'set-cookie': headers.get('set-cookie') });
}

async function guest(req, env) {
  const b = await readJson(req);
  if (!b || b.terms !== env.TERMS_VERSION) return fail(400, 'terms_required');
  const ip = clientIp(req);
  if (await tooMany(env, 'guest:' + ip, 5, HOUR)) return fail(429, 'too_many');
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, kind, plan, terms_accepted_at, terms_version, last_seen) VALUES (?, 'guest', 'guest', ?, ?, ?)"
  ).bind(id, new Date().toISOString(), env.TERMS_VERSION, Date.now()).run();
  await hit(env, 'guest:' + ip);
  const headers = new Headers();
  await startSession(env, id, headers);
  return json({ ok: true }, 200, { 'set-cookie': headers.get('set-cookie') });
}

// A guest turns into a full account and keeps everything they made.
async function upgrade(req, env, user) {
  if (user.kind !== 'guest') return fail(400, 'not_a_guest');
  const b = await readJson(req);
  const email = normEmail(b && b.email);
  if (!b || !EMAIL_RE.test(email) || !KEY_RE.test(String(b.key || ''))) return fail(400, 'bad_input');
  const ip = clientIp(req);
  if (await tooMany(env, 'signup:' + ip, 10, HOUR)) return fail(429, 'too_many');
  const c = await credentials(b.key);
  try {
    await env.DB.prepare("UPDATE users SET kind = 'user', plan = 'free', email = ?, pass_salt = ?, pass_hash = ?, recovery_hash = ? WHERE id = ? AND kind = 'guest'")
      .bind(email, c.salt, c.hash, c.codeHash, user.id).run();
  } catch (e) {
    if (isUniqueError(e)) return fail(409, 'email_taken');
    throw e;
  }
  await hit(env, 'signup:' + ip);
  return json({ recoveryCode: c.code });
}

// Forgot the password: the recovery code sets a new one (and issues a new recovery code).
async function recover(req, env) {
  const b = await readJson(req);
  const email = normEmail(b && b.email);
  const code = cleanCode(b && b.recoveryCode);
  if (!b || !EMAIL_RE.test(email) || !KEY_RE.test(String(b.key || '')) || code.length !== 20) return fail(400, 'bad_input');
  const ip = clientIp(req);
  if (await tooMany(env, 'fail:e:' + email, 8, 15 * MINUTE) || await tooMany(env, 'fail:ip:' + ip, 40, 15 * MINUTE)) return fail(429, 'too_many');
  const u = await env.DB.prepare("SELECT id, recovery_hash FROM users WHERE email = ? AND kind = 'user'").bind(email).first();
  const given = await sha256Hex(code);
  if (!u || !u.recovery_hash || !safeEqual(given, u.recovery_hash)) {
    await hit(env, 'fail:e:' + email); await hit(env, 'fail:ip:' + ip);
    return fail(401, 'bad_recovery');
  }
  const c = await credentials(b.key);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_salt = ?, pass_hash = ?, recovery_hash = ? WHERE id = ?').bind(c.salt, c.hash, c.codeHash, u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id) // anyone who had the old password is signed out
  ]);
  const headers = new Headers();
  await startSession(env, u.id, headers);
  return json({ recoveryCode: c.code }, 200, { 'set-cookie': headers.get('set-cookie') });
}

// Signed in and want a fresh recovery code (e.g. the old one was lost): needs the password again.
async function newCode(req, env, user) {
  if (user.kind !== 'user') return fail(400, 'not_a_user');
  const b = await readJson(req);
  if (!b || !KEY_RE.test(String(b.key || ''))) return fail(400, 'bad_input');
  if (await tooMany(env, 'fail:e:' + user.email, 8, 15 * MINUTE)) return fail(429, 'too_many');
  const u = await env.DB.prepare('SELECT pass_salt, pass_hash FROM users WHERE id = ?').bind(user.id).first();
  if (!u || !safeEqual(await sha256Hex(u.pass_salt + b.key), u.pass_hash)) { await hit(env, 'fail:e:' + user.email); return fail(401, 'bad_credentials'); }
  const code = makeRecoveryCode();
  await env.DB.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').bind(await sha256Hex(cleanCode(code)), user.id).run();
  return json({ recoveryCode: code });
}

/* ---------- data ---------- */
async function putData(req, env, user) {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_DATA_BYTES) return fail(413, 'data_too_large');
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return fail(400, 'bad_json'); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return fail(400, 'bad_json');

  const papers = Array.isArray(doc.papers) ? doc.papers.length : 0;   // papers on the boards (removed ones live in "archive")
  const boards = Array.isArray(doc.boards) ? doc.boards.length : 0;
  const plan = await planFor(env, user);
  const old = await env.DB.prepare('SELECT papers_count, boards_count FROM user_data WHERE user_id = ?').bind(user.id).first();
  // Someone already over a limit (e.g. after a downgrade) can still edit and delete, but not add more.
  if (papers > plan.max_papers && papers > (old ? old.papers_count : 0)) return fail(403, 'plan_limit:papers');
  if (boards > plan.max_boards && boards > (old ? old.boards_count : 0)) return fail(403, 'plan_limit:boards');

  await env.DB.prepare(
    `INSERT INTO user_data (user_id, data, papers_count, boards_count, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, papers_count = excluded.papers_count,
       boards_count = excluded.boards_count, updated_at = excluded.updated_at`
  ).bind(user.id, text, papers, boards, new Date().toISOString()).run();
  return json({ ok: true });
}

/* ---------- media ---------- */
async function postMedia(req, url, env, user) {
  const ext = String(url.searchParams.get('ext') || '').toLowerCase();
  if (!MIME[ext]) return fail(400, 'bad_type');
  const limitChars = Math.ceil(MAX_MEDIA_BYTES * 4 / 3) + 8;
  if (Number(req.headers.get('content-length') || 0) > limitChars) return fail(413, 'file_too_large');
  const body = (await req.text()).trim();
  if (!body.length) return fail(400, 'empty');
  if (body.length > limitChars) return fail(413, 'file_too_large');
  const pad = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  const bytes = Math.floor(body.length * 3 / 4) - pad; // measured here, never trusted from the browser

  const plan = await planFor(env, user);
  if ((await usedBytes(env, user.id)) + bytes > plan.max_storage_bytes) return fail(403, 'plan_limit:storage');

  const name = randomHex(10) + '.' + ext;
  const count = Math.ceil(body.length / CHUNK_CHARS);
  const stmts = [env.DB.prepare('INSERT INTO media (user_id, name, bytes, mime, chunks) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, name, bytes, MIME[ext], count)];
  for (let i = 0; i < count; i++) {
    stmts.push(env.DB.prepare('INSERT INTO media_chunks (user_id, name, idx, data) VALUES (?, ?, ?, ?)')
      .bind(user.id, name, i, body.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS)));
  }
  await env.DB.batch(stmts);
  return json({ name, bytes });
}

async function getMedia(req, env, user, name) {
  const rows = await env.DB.prepare(
    `SELECT m.mime AS mime, c.data AS data FROM media m JOIN media_chunks c ON c.user_id = m.user_id AND c.name = m.name
     WHERE m.user_id = ? AND m.name = ? ORDER BY c.idx`
  ).bind(user.id, name).all();
  const list = rows.results || [];
  if (!list.length) return new Response('Not found', { status: 404 });
  const bytes = decodeBase64(list.map((r) => r.data).join(''));
  const headers = {
    'content-type': list[0].mime, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox', 'cache-control': 'private, max-age=31536000, immutable'
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] === '' ? Math.max(0, bytes.length - Number(m[2])) : Number(m[1]);
    let end = m[1] === '' || m[2] === '' ? bytes.length - 1 : Math.min(Number(m[2]), bytes.length - 1);
    if (start > end || start >= bytes.length) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${bytes.length}` } });
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
  }
  return new Response(bytes, { status: 200, headers });
}

/* ---------- router ---------- */
async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Everything that can change something needs our own header (a website on another domain cannot send it).
  if (method !== 'GET' && req.headers.get('x-requested-with') !== 'notice') return fail(403, 'bad_request');

  if (method === 'POST') {
    if (path === '/api/auth/signup') return signup(req, env);
    if (path === '/api/auth/login') return login(req, env);
    if (path === '/api/auth/guest') return guest(req, env);
    if (path === '/api/auth/recover') return recover(req, env);
  }

  const user = await currentUser(env, req);
  if (path === '/api/me' && method === 'GET') {
    if (!user) return json({ error: 'unauthorized', termsVersion: env.TERMS_VERSION }, 401);
    const plan = await planFor(env, user);
    return json({
      kind: user.kind, email: user.email, plan: user.plan,
      limits: { maxPapers: plan.max_papers, maxBoards: plan.max_boards, maxStorageBytes: plan.max_storage_bytes },
      usage: { storageBytes: await usedBytes(env, user.id) }
    });
  }
  if (!user) return fail(401, 'unauthorized');

  if (path === '/api/auth/upgrade' && method === 'POST') return upgrade(req, env, user);
  if (path === '/api/auth/newcode' && method === 'POST') return newCode(req, env, user);

  if (path === '/api/data') {
    if (method === 'GET') {
      const row = await env.DB.prepare('SELECT data FROM user_data WHERE user_id = ?').bind(user.id).first();
      if (!row) return new Response(null, { status: 204 });
      return new Response(row.data, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (method === 'PUT') return putData(req, env, user);
  }
  if (path === '/api/media' && method === 'POST') return postMedia(req, url, env, user);
  const mm = /^\/api\/media\/([a-f0-9]{20}\.[a-z0-9]{1,5})$/.exec(path);
  if (mm) {
    if (method === 'GET') return getMedia(req, env, user, mm[1]);
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM media WHERE user_id = ? AND name = ?').bind(user.id, mm[1]).run();
      return json({ ok: true });
    }
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(getCookie(req, 'nb_session') || '')).run();
    return json({ ok: true }, 200, { 'set-cookie': cookie('nb_session', '', 0) });
  }
  if (path === '/api/account' && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run(); // everything of theirs goes with it
    return json({ ok: true }, 200, { 'set-cookie': cookie('nb_session', '', 0) });
  }
  return fail(404, 'not_found');
}

// Runs once a day (see wrangler.jsonc): forgets old guests, old sessions and old rate-limit marks.
export async function cleanup(env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM users WHERE kind = 'guest' AND last_seen < ?").bind(now - GUEST_KEEP_DAYS * DAY),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM abuse WHERE ts < ?').bind(now - DAY)
  ]);
}

export default {
  async fetch(req, env) {
    try { return await route(req, env); } catch (e) { console.error(e); return fail(500, 'server_error'); }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  }
};
