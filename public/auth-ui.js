/* Sign-in screen, the Pledge, and the recovery-code screen. English and Persian side by side. */
(function () {
  'use strict';

  /* ---------- tiny helpers ---------- */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    kids.forEach((k) => { if (k != null) n.append(k); });
    return n;
  }
  function call(path, opts) {
    const o = opts || {};
    return fetch(path, { credentials: 'same-origin', ...o, headers: { 'X-Requested-With': 'notice', ...(o.headers || {}) } });
  }
  async function postJson(path, body) {
    const r = await call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await r.json(); } catch (e) { /* empty */ }
    if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.code = data.error || ''; throw e; }
    return data;
  }

  // The browser turns the password into a long key; only that key is sent. (The server never sees the password.)
  const ITERATIONS = 300000;
  async function deriveKey(email, password) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('notice-board:' + email.trim().toLowerCase()), iterations: ITERATIONS }, base, 256);
    return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- words (English first, Persian second) ---------- */
  const T = {
    en: {
      tagline: 'Your pinboard and journal, anywhere.',
      signin: 'Sign in', create: 'Create account', email: 'Email', password: 'Password', password2: 'Repeat password',
      newPassword: 'New password',
      forgot: 'Forgot password?', back: 'Back to sign in', guest: 'Continue as guest',
      guestNote: 'Guests can try everything with smaller limits. Guest notes are deleted after 30 days without a visit. Make an account any time to keep them.',
      or: 'or',
      pledgeTitle: 'Our little pledge',
      pledgeAgree: 'I have read the pledge and I agree to the',
      terms: 'Terms', and: 'and', privacy: 'Privacy Policy',
      recoveryCode: 'Recovery code', recover: 'Reset password',
      errTerms: 'Please tick the pledge box first.',
      errEmail: 'That email does not look right.',
      errShort: 'Please use a password with at least 8 characters.',
      errMatch: 'The two passwords are not the same.',
      errCode: 'Please type your recovery code.',
      bad_credentials: 'Wrong email or password.',
      bad_recovery: 'That email and recovery code do not match.',
      email_taken: 'There is already an account with this email. Try signing in.',
      too_many: 'Too many tries. Please wait a little and try again.',
      bad_input: 'Something is not right in the form. Please check it.',
      terms_required: 'Please tick the pledge box first.',
      fallback: 'Something went wrong. Please try again.',
      working: 'One moment…',
      codeTitle: 'Save your recovery code',
      codeText: 'This is the only way to get back in if you forget your password. We cannot send emails yet and we cannot see your password, so nobody can reset it for you. Write the code down or save it somewhere safe.',
      copy: 'Copy', copied: 'Copied', saved: 'I saved my recovery code', go: 'Continue',
      switchTo: 'فارسی'
    },
    fa: {
      tagline: 'تخته و دفترچه‌ی شما، همه‌جا.',
      signin: 'ورود', create: 'ساخت حساب', email: 'ایمیل', password: 'رمز عبور', password2: 'تکرار رمز عبور',
      newPassword: 'رمز عبور جدید',
      forgot: 'رمزم را فراموش کرده‌ام', back: 'بازگشت به ورود', guest: 'ورود به‌عنوان مهمان',
      guestNote: 'مهمان‌ها می‌توانند همه‌چیز را با محدودیت کمتر امتحان کنند. یادداشت‌های مهمان بعد از ۳۰ روز بدون بازدید پاک می‌شود. هر وقت خواستید حساب بسازید تا بماند.',
      or: 'یا',
      pledgeTitle: 'عهدنامه‌ی کوچک ما',
      pledgeAgree: 'عهدنامه را خوانده‌ام و با',
      terms: 'شرایط استفاده', and: 'و', privacy: 'حریم خصوصی',
      pledgeAgree2: 'موافقم.',
      recoveryCode: 'کد بازیابی', recover: 'تغییر رمز',
      errTerms: 'اول تیک عهدنامه را بزنید.',
      errEmail: 'این ایمیل درست به نظر نمی‌رسد.',
      errShort: 'رمز عبور باید حداقل ۸ نویسه باشد.',
      errMatch: 'دو رمز عبور یکی نیستند.',
      errCode: 'لطفاً کد بازیابی را بنویسید.',
      bad_credentials: 'ایمیل یا رمز عبور اشتباه است.',
      bad_recovery: 'ایمیل و کد بازیابی با هم نمی‌خوانند.',
      email_taken: 'با این ایمیل قبلاً حساب ساخته شده. وارد شوید.',
      too_many: 'تلاش بیش از حد. کمی صبر کنید و دوباره امتحان کنید.',
      bad_input: 'در فرم مشکلی هست. لطفاً دوباره بررسی کنید.',
      terms_required: 'اول تیک عهدنامه را بزنید.',
      fallback: 'مشکلی پیش آمد. دوباره امتحان کنید.',
      working: 'کمی صبر کنید…',
      codeTitle: 'کد بازیابی را نگه دارید',
      codeText: 'اگر رمزتان را فراموش کنید، این کد تنها راه برگشت است. هنوز ایمیل نمی‌فرستیم و رمز شما را هم نمی‌بینیم، پس هیچ‌کس نمی‌تواند برایتان رمز را عوض کند. کد را یادداشت کنید یا جای امنی نگه دارید.',
      copy: 'کپی', copied: 'کپی شد', saved: 'کد بازیابی را ذخیره کردم', go: 'ادامه',
      switchTo: 'English'
    }
  };

  const PLEDGE = {
    en: [
      ['Your notes are yours.', 'What you pin and write belongs to you. We only keep it so the app can show it back to you.'],
      ['No ads, no selling.', 'We do not sell your data and we do not show ads.'],
      ['We do not read your notes.', 'We only look at your data if it is needed to keep the app running, or if the law requires it.'],
      ['Be kind.', 'Please do not use the app for anything illegal or harmful, or to store things that hurt other people.'],
      ['Passwords stay secret.', 'We never see your password. If you lose both your password and your recovery code, we cannot open your account again.'],
      ['Guests are temporary.', 'Guest notes are deleted after 30 days without a visit. Create an account to keep yours.'],
      ['Free for now, plans coming soon.', 'Everything is free today. Paid plans with more space are coming, and nothing is charged without you clearly saying yes.'],
      ['This is a first version.', 'It may have bugs. Please keep a copy of anything you cannot lose. The app comes as it is.'],
      ['You can leave any time.', 'Delete your account in Settings and everything of yours is deleted with it.']
    ],
    fa: [
      ['یادداشت‌ها مال شماست.', 'هر چیزی که روی تخته می‌زنید و می‌نویسید متعلق به شماست. ما فقط نگهش می‌داریم تا برنامه دوباره نشانتان بدهد.'],
      ['بدون تبلیغ، بدون فروش.', 'اطلاعات شما را نمی‌فروشیم و تبلیغ نشان نمی‌دهیم.'],
      ['یادداشت‌هایتان را نمی‌خوانیم.', 'فقط اگر برای کار کردن برنامه لازم باشد یا قانون بخواهد سراغ اطلاعات می‌رویم.'],
      ['مهربان باشیم.', 'لطفاً از برنامه برای کار غیرقانونی یا آسیب‌زننده، یا نگه‌داری چیزهایی که به دیگران آسیب می‌زند استفاده نکنید.'],
      ['رمزها پنهان می‌مانند.', 'ما رمز شما را هرگز نمی‌بینیم. اگر هم رمز و هم کد بازیابی را گم کنید، نمی‌توانیم حسابتان را دوباره باز کنیم.'],
      ['مهمان موقتی است.', 'یادداشت‌های مهمان بعد از ۳۰ روز بدون بازدید پاک می‌شود. برای ماندگاری حساب بسازید.'],
      ['فعلاً رایگان، اشتراک‌ها به‌زودی.', 'الان همه‌چیز رایگان است. اشتراک‌های پولی با فضای بیشتر به‌زودی می‌آیند و بدون موافقت روشن شما چیزی پرداخت نمی‌شود.'],
      ['این نسخه‌ی اول است.', 'ممکن است ایراد داشته باشد. از چیزهای مهم یک نسخه نگه دارید. برنامه به همین شکلی که هست ارائه می‌شود.'],
      ['هر وقت خواستید بروید.', 'حسابتان را از تنظیمات پاک کنید تا همه‌ی اطلاعاتتان هم پاک شود.']
    ]
  };

  function savedLang() {
    try { const v = localStorage.getItem('nb_lang'); if (v === 'en' || v === 'fa') return v; } catch (e) { /* ignore */ }
    return /^fa/i.test(navigator.language || '') ? 'fa' : 'en';
  }
  function rememberLang(l) { try { localStorage.setItem('nb_lang', l); } catch (e) { /* ignore */ } }

  /* ---------- sign-in screen ---------- */
  function showLogin(termsVersion) {
    const app = document.getElementById('app');
    let lang = savedLang();
    let mode = 'signin'; // signin | signup | recover
    let busy = false;

    function render() {
      const t = T[lang];
      const rtl = lang === 'fa';
      app.textContent = '';
      const msg = el('div', { class: 'msg', role: 'alert' });
      const say = (s) => { msg.textContent = s || ''; };

      const email = el('input', { type: 'email', autocomplete: 'email', placeholder: t.email, 'aria-label': t.email, dir: 'ltr' });
      const pw = el('input', { type: 'password', autocomplete: mode === 'signin' ? 'current-password' : 'new-password',
        placeholder: mode === 'recover' ? t.newPassword : t.password, 'aria-label': t.password, dir: 'ltr' });
      const pw2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: t.password2, 'aria-label': t.password2, dir: 'ltr' });
      const code = el('input', { type: 'text', autocomplete: 'off', placeholder: t.recoveryCode, 'aria-label': t.recoveryCode, dir: 'ltr', spellcheck: 'false' });
      const agree = el('input', { type: 'checkbox', id: 'terms' });

      const primaryLabel = mode === 'signin' ? t.signin : mode === 'signup' ? t.create : t.recover;
      const primary = el('button', { type: 'submit', class: 'primary', text: primaryLabel });
      const guestBtn = el('button', { type: 'button', class: 'guest', text: t.guest });

      function setBusy(b) {
        busy = b;
        [primary, guestBtn].forEach((x) => { x.disabled = b; });
        if (b) say(t.working);
      }
      function explain(e) { say(t[e && e.code] || t.fallback); }
      function needAgree() { if (!agree.checked) { say(t.errTerms); return true; } return false; }

      function afterAuth(data) {
        if (data && data.recoveryCode) showRecoveryCode(data.recoveryCode, () => location.reload());
        else location.reload();
      }

      async function submit(ev) {
        ev.preventDefault();
        if (busy) return;
        const em = email.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(em)) { say(t.errEmail); return; }
        if (mode !== 'signin' && pw.value.length < 8) { say(t.errShort); return; }
        if (mode === 'signin' && !pw.value) { say(t.errShort); return; }
        if (mode === 'signup') {
          if (pw.value !== pw2.value) { say(t.errMatch); return; }
          if (needAgree()) return;
        }
        if (mode === 'recover' && !code.value.trim()) { say(t.errCode); return; }
        setBusy(true);
        try {
          const key = await deriveKey(em, pw.value);
          if (mode === 'signin') afterAuth(await postJson('/api/auth/login', { email: em, key }));
          else if (mode === 'signup') afterAuth(await postJson('/api/auth/signup', { email: em, key, terms: termsVersion }));
          else afterAuth(await postJson('/api/auth/recover', { email: em, key, recoveryCode: code.value }));
        } catch (e) { setBusy(false); explain(e); }
      }
      guestBtn.addEventListener('click', async () => {
        if (busy || needAgree()) return;
        setBusy(true);
        try { await postJson('/api/auth/guest', { terms: termsVersion }); location.reload(); } catch (e) { setBusy(false); explain(e); }
      });

      const tab = (m, label) => el('button', { type: 'button', class: 'tab' + (mode === m ? ' on' : ''), text: label,
        onclick: () => { mode = m; render(); } });

      const pledgeBox = el('details', { class: 'pledge' },
        el('summary', { text: t.pledgeTitle }),
        el('ol', {}, ...PLEDGE[lang].map(([b, s]) => el('li', {}, el('b', { text: b + ' ' }), s))));
      pledgeBox.open = mode === 'signup';

      const agreeLine = lang === 'fa'
        ? el('span', {}, t.pledgeAgree + ' ', el('a', { href: 'terms.html', target: '_blank', rel: 'noopener', text: t.terms }), ' ' + t.and + ' ',
            el('a', { href: 'privacy.html', target: '_blank', rel: 'noopener', text: t.privacy }), ' ' + t.pledgeAgree2)
        : el('span', {}, t.pledgeAgree + ' ', el('a', { href: 'terms.html', target: '_blank', rel: 'noopener', text: t.terms }), ' ' + t.and + ' ',
            el('a', { href: 'privacy.html', target: '_blank', rel: 'noopener', text: t.privacy }), '.');

      const fields = [email, pw];
      if (mode === 'signup') fields.push(pw2);
      if (mode === 'recover') fields.splice(1, 0, code);

      const form = el('form', { onsubmit: submit, novalidate: 'novalidate' },
        el('div', { class: 'langrow' }, el('button', { type: 'button', class: 'linkbtn', text: t.switchTo,
          onclick: () => { lang = lang === 'en' ? 'fa' : 'en'; rememberLang(lang); render(); } })),
        el('h1', { text: 'Notice Board' }),
        el('p', { class: 'sub', text: t.tagline }),
        mode === 'recover' ? null : el('div', { class: 'tabs', role: 'tablist' }, tab('signin', t.signin), tab('signup', t.create)),
        ...fields,
        mode === 'signup' ? pledgeBox : null,
        (mode === 'signup' || true) ? el('label', { class: 'terms' }, agree, agreeLine) : null,
        primary,
        msg,
        el('div', { class: 'links' },
          mode === 'signin' ? el('button', { type: 'button', class: 'linkbtn', text: t.forgot, onclick: () => { mode = 'recover'; render(); } }) : null,
          mode === 'recover' ? el('button', { type: 'button', class: 'linkbtn', text: t.back, onclick: () => { mode = 'signin'; render(); } }) : null,
          mode !== 'signup' && mode !== 'recover' ? null : null),
        mode === 'recover' ? null : el('div', { class: 'or', text: t.or }),
        mode === 'recover' ? null : guestBtn,
        mode === 'recover' ? null : el('p', { class: 'guestnote', text: t.guestNote }),
        mode === 'signin' || mode === 'recover' ? null : null);

      // The pledge is also readable before choosing a tab.
      if (mode === 'signin') form.insertBefore(pledgeBox, form.querySelector('label.terms'));
      app.append(el('div', { class: 'nb-login' + (rtl ? ' rtl' : ''), dir: rtl ? 'rtl' : 'ltr', lang: lang }, form));
    }
    render();
  }

  /* ---------- recovery-code screen ---------- */
  function showRecoveryCode(codeText, done) {
    const lang = savedLang();
    const t = T[lang];
    const app = document.getElementById('app') || document.body;
    const ok = el('input', { type: 'checkbox', id: 'saved' });
    const go = el('button', { type: 'button', class: 'primary', text: t.go, disabled: 'disabled' });
    ok.addEventListener('change', () => { if (ok.checked) go.removeAttribute('disabled'); else go.setAttribute('disabled', 'disabled'); });
    go.addEventListener('click', () => { if (ok.checked) done(); });
    const copy = el('button', { type: 'button', text: t.copy });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(codeText); copy.textContent = t.copied; } catch (e) { /* select by hand */ }
    });
    const rtl = lang === 'fa';
    const box = el('div', { class: 'nb-login' + (rtl ? ' rtl' : ''), dir: rtl ? 'rtl' : 'ltr', lang },
      el('div', { class: 'card' },
        el('h1', { text: t.codeTitle }),
        el('p', { class: 'sub', text: t.codeText }),
        el('div', { class: 'code', dir: 'ltr', text: codeText }),
        copy,
        el('label', { class: 'terms' }, ok, el('span', { text: t.saved })),
        go));
    if (app === document.body) { document.querySelector('.nb-login') && document.querySelector('.nb-login').remove(); document.body.append(box); }
    else { app.textContent = ''; app.append(box); }
  }

  window.nbWeb = { el, call, postJson, deriveKey, showLogin, showRecoveryCode, T, savedLang };
})();
