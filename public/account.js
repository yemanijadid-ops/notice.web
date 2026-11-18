/* Settings > Account: who you are, how much space you use, plans (coming soon), guest upgrade, recovery code. */
(function () {
  'use strict';
  const NB = window.NB;
  const { h } = NB;
  const W = window.nbWeb;

  const mb = (n) => (n / 1048576 < 10 ? (n / 1048576).toFixed(1) : Math.round(n / 1048576)) + ' MB';
  const size = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : mb(n));
  const big = (n) => (n >= 100000 ? 'Unlimited' : String(n));

  NB.accountSection = function () {
    const me = window.nbApi.account();
    const isGuest = me.kind === 'guest';
    const used = me.usage.storageBytes, cap = me.limits.maxStorageBytes;
    const pct = Math.min(100, Math.round((used / cap) * 100));
    const note = h('p', { class: 'settings-note', text: '' });
    const say = (s) => { note.textContent = s; };

    const meter = h('div', { class: 'meter', role: 'img', 'aria-label': 'Storage used ' + pct + ' percent' },
      h('div', { class: 'meter-fill', style: { width: pct + '%' } }));

    const plan = (key, name, line, current) => h('div', { class: 'plan-card' + (current ? ' current' : '') },
      h('b', { text: name }), h('small', { text: line }),
      h('span', { class: 'soon-tag', text: current ? 'Your plan' : 'Coming soon' }));

    const plans = h('div', { class: 'plan-list' },
      plan('free', 'Free', '15 papers · 1 board · 100 MB of photos and voice', me.plan === 'free' || me.plan === 'guest'),
      plan('pro', 'Pro', 'Unlimited papers · 3 boards · about 1.5 GB', me.plan === 'pro'),
      plan('max', 'Max', 'Everything in Pro, with more space', me.plan === 'max'));

    const parts = [
      h('div', { class: 'acct-line' }, h('b', { text: isGuest ? 'Guest' : me.email }),
        h('small', { text: isGuest ? 'Guest notes are deleted after 30 days without a visit.' : 'Plan: ' + (me.plan[0].toUpperCase() + me.plan.slice(1)) })),
      h('div', { class: 'acct-line' }, h('small', { text: 'Space used: ' + size(used) + ' of ' + size(cap) + ' · Papers on boards: up to ' + big(me.limits.maxPapers) + ' · Boards: ' + me.limits.maxBoards }), meter),
      plans,
      h('p', { class: 'settings-note', text: 'Paid plans are coming soon. Nothing is charged today.' })
    ];

    const row = h('div', { class: 'row' });
    if (isGuest) {
      row.append(h('button', { type: 'button', class: 'btn small primary', text: 'Create an account to keep your notes', onclick: upgradeForm }));
    } else {
      row.append(h('button', { type: 'button', class: 'btn small', text: 'New recovery code', onclick: newCodeForm }));
    }
    row.append(
      h('button', { type: 'button', class: 'btn small', text: 'Sign out', onclick: () => window.nbApi.signOut() }),
      h('button', { type: 'button', class: 'btn small danger', text: 'Delete account', onclick: () => window.nbApi.deleteAccount() }));
    parts.push(row, note);

    function field(type, ph) { const i = document.createElement('input'); i.type = type; i.placeholder = ph; i.className = 'acct-input'; i.autocomplete = type === 'email' ? 'email' : 'new-password'; return i; }

    function upgradeForm() {
      const email = field('email', 'Email'), pw = field('password', 'Password (8+ characters)'), pw2 = field('password', 'Repeat password');
      const m = NB.modal({ title: 'Create your account', body: h('div', { class: 'acct-form' },
        h('p', { class: 'settings-note', text: 'Everything you made as a guest stays. You will get a recovery code to save.' }), email, pw, pw2),
        buttons: [{ label: 'Cancel' }, { label: 'Create account', kind: 'primary', onClick: () => { go(); return false; } }] });
      async function go() {
        const em = email.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(em)) { NB.toast('That email does not look right.'); return; }
        if (pw.value.length < 8) { NB.toast('Please use at least 8 characters.'); return; }
        if (pw.value !== pw2.value) { NB.toast('The two passwords are not the same.'); return; }
        try {
          const key = await W.deriveKey(em, pw.value);
          const r = await W.postJson('/api/auth/upgrade', { email: em, key });
          await NB.flush();
          document.querySelectorAll('.modal-backdrop').forEach((n) => n.remove());
          W.showRecoveryCode(r.recoveryCode, () => location.reload());
        } catch (e) { NB.toast(e.code === 'email_taken' ? 'There is already an account with this email.' : e.code === 'too_many' ? 'Too many tries. Please wait a little.' : 'Could not create the account. Please try again.'); }
      }
      return m;
    }

    function newCodeForm() {
      const pw = field('password', 'Your password'); pw.autocomplete = 'current-password';
      NB.modal({ title: 'New recovery code', body: h('div', { class: 'acct-form' },
        h('p', { class: 'settings-note', text: 'Type your password. The old recovery code will stop working.' }), pw),
        buttons: [{ label: 'Cancel' }, { label: 'Get new code', kind: 'primary', onClick: () => { go(); return false; } }] });
      async function go() {
        try {
          const key = await W.deriveKey(window.nbApi.account().email, pw.value);
          const r = await W.postJson('/api/auth/newcode', { key });
          document.querySelectorAll('.modal-backdrop').forEach((n) => n.remove());
          W.showRecoveryCode(r.recoveryCode, () => location.reload());
        } catch (e) { NB.toast(e.code === 'bad_credentials' ? 'Wrong password.' : 'Could not do that. Please try again.'); }
      }
    }

    return h('div', { class: 'field' }, h('span', { text: 'Account' }), h('div', { class: 'acct' }, ...parts));
  };
})();
