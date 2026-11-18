/* Web start-up: sign-in screen, then the same window.nbApi the desktop app used, now backed by our own API. */
(function () {
  'use strict';
  const APP_SCRIPTS = ['store.js', 'ui.js', 'page.js', 'layered.js', 'board.js', 'atlaslist.js', 'journal.js', 'account.js', 'app.js'];
  let me = null;

  const { call } = window.nbWeb;

  /* ---------- the storage layer the app already expects (window.nbApi) ---------- */
  const FRIENDLY = {
    'plan_limit:storage': 'Your storage is full. Paid plans with more space are coming soon.',
    'plan_limit:papers': 'You reached the paper limit of your plan. Paid plans are coming soon.',
    'plan_limit:boards': 'You reached the board limit of your plan. Paid plans are coming soon.',
    file_too_large: 'That file is too big (the limit is 4 MB).',
    data_too_large: 'Your notes have reached the maximum size.',
    too_many: 'Too many tries. Please wait a little and try again.',
    unauthorized: 'You were signed out. Please reload the page and sign in again.'
  };
  async function failure(res) {
    let code = '';
    try { code = (await res.json()).error || ''; } catch (e) { /* not JSON */ }
    const e = new Error(code || ('HTTP ' + res.status));
    e.userMessage = FRIENDLY[code] || '';
    return e;
  }

  // Big photos are shrunk in the browser first (max 1600 px, JPEG) so they use little space.
  async function maybeShrink(ext, bytes) {
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext) || bytes.length < 300 * 1024) return { ext, bytes };
    try {
      const bmp = await createImageBitmap(new Blob([bytes]));
      const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * s));
      const h = Math.max(1, Math.round(bmp.height * s));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      x.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
      if (blob && blob.size < bytes.length) return { ext: 'jpg', bytes: new Uint8Array(await blob.arrayBuffer()) };
    } catch (e) { /* keep the original */ }
    return { ext, bytes };
  }
  const toBase64 = (bytes) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(new Blob([bytes]));
  });

  function buildApi() {
    window.nbApi = {
      mediaBase: '',
      mediaUrl: (name) => '/api/media/' + encodeURIComponent(name),
      plan: () => me.plan,
      account: () => me,

      async loadData() {
        const r = await call('/api/data');
        if (r.status === 204) return null;
        if (!r.ok) throw await failure(r);
        return r.text();
      },
      async saveData(text) {
        const r = await call('/api/data', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: text });
        if (!r.ok) throw await failure(r);
        return true;
      },
      // Last-moment save when the tab closes (the browser cannot wait, so this is best effort).
      saveDataSync(text) {
        try {
          fetch('/api/data', { method: 'PUT', keepalive: true, credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'X-Requested-With': 'notice' }, body: text });
        } catch (e) { /* nothing more we can do */ }
        return true;
      },
      async saveMedia(ext, bytes) {
        const clean = String(ext || '').toLowerCase();
        const s = await maybeShrink(clean, bytes);
        const r = await call('/api/media?ext=' + encodeURIComponent(s.ext), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: await toBase64(s.bytes) });
        if (!r.ok) throw await failure(r);
        return (await r.json()).name;
      },
      async deleteMedia(name) {
        try { return (await call('/api/media/' + encodeURIComponent(name), { method: 'DELETE' })).ok; } catch (e) { return false; }
      },
      async signOut() {
        if (window.NB && NB.flush) await NB.flush();
        await call('/api/auth/logout', { method: 'POST' });
        location.reload();
      },
      async deleteAccount() {
        if (!confirm('Delete your account and ALL your notes, photos and recordings? This cannot be undone.')) return;
        if (prompt('Type DELETE to confirm.') !== 'DELETE') return;
        const r = await call('/api/account', { method: 'DELETE' });
        if (!r.ok) { alert('Could not delete the account. Please try again.'); return; }
        location.reload();
      }
    };
  }

  /* ---------- start ---------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
      document.body.appendChild(s);
    });
  }
  async function boot() {
    let r;
    try { r = await call('/api/me'); } catch (e) {
      document.getElementById('app').textContent = 'Could not reach the server. Please check your connection and reload.';
      return;
    }
    if (r.status === 401) { window.nbWeb.showLogin((await r.json()).termsVersion); return; }
    if (!r.ok) { document.getElementById('app').textContent = 'Something went wrong. Please reload the page.'; return; }
    me = await r.json();
    buildApi();
    for (const f of APP_SCRIPTS) await loadScript(f);
    // app.js starts itself on DOMContentLoaded, which already happened - trigger it now.
    document.dispatchEvent(new Event('DOMContentLoaded'));
  }
  boot();
})();
