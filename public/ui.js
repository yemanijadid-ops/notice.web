/* Small UI toolkit: element builder, icons, modal, toast, colour picker. */
(function () {
  'use strict';
  const NB = (window.NB = window.NB || {});
  NB.Store = window.NBStore;

  NB.clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      el.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
  }

  NB.h = function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, sv);
            else el.style[sk] = sv;
          }
        } else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    append(el, kids);
    return el;
  };
  const h = NB.h;

  /* ---------- icons ---------- */
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    edit: '<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
    trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M4 17l5-5 4 4 3-3 4 4"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    thread: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 7c6 0 4 10 10 10"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    note: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>',
    text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    chevL: '<path d="M15 5l-7 7 7 7"/>',
    chevR: '<path d="M9 5l7 7-7 7"/>',
    grip: '<circle cx="8" cy="9" r="1.2" fill="currentColor"/><circle cx="12" cy="9" r="1.2" fill="currentColor"/><circle cx="16" cy="9" r="1.2" fill="currentColor"/><circle cx="8" cy="14" r="1.2" fill="currentColor"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/><circle cx="16" cy="14" r="1.2" fill="currentColor"/>',
    atlas: '<path d="M6 3h10a2 2 0 0 1 2 2v13H8a2 2 0 0 0-2 2V3z"/><path d="M6 20a2 2 0 0 0 2 2h10"/><path d="M10 8h5M10 12h5"/>',
    undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 8"/>',
    pin: '<circle cx="12" cy="9" r="5.5" fill="currentColor" stroke="none"/><path d="M12 15v7"/>'
  };
  NB.icon = function (name) {
    const s = document.createElement('span');
    s.className = 'ico';
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
    return s;
  };

  /* ---------- toast ---------- */
  NB.toast = function (msg) {
    const t = h('div', { class: 'toast', text: msg });
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  };

  /* ---------- modal ---------- */
  // buttons: [{label, kind: 'primary'|'danger'|'', onClick(api) -> return false to keep the dialog open}]
  NB.modal = function ({ title, body, buttons = [], wide = false, onClose }) {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const footer = h('div', { class: 'modal-foot' });
    const panel = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog' },
      title ? h('h2', { class: 'modal-title', text: title }) : null,
      h('div', { class: 'modal-body' }, body),
      buttons.length ? footer : null);
    backdrop.append(panel);
    let closed = false;
    const api = { panel, close };
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (onClose) onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }
    let primaryBtn = null;
    buttons.forEach((b) => {
      const btn = h('button', {
        type: 'button',
        class: 'btn' + (b.kind ? ' ' + b.kind : ''),
        text: b.label,
        onclick: () => {
          if (b.onClick && b.onClick(api) === false) return;
          close();
        }
      });
      if (b.kind === 'primary' || b.kind === 'danger') primaryBtn = primaryBtn || btn;
      footer.append(btn);
    });
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'color' && primaryBtn && !e.isComposing) {
        e.preventDefault();
        primaryBtn.click();
      }
    });
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    return api;
  };

  NB.confirm = function (message, okLabel = 'Delete') {
    return new Promise((resolve) => {
      let answered = false;
      NB.modal({
        body: h('p', { class: 'confirm-text', text: message }),
        buttons: [
          { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
          { label: okLabel, kind: 'danger', onClick: () => { answered = true; resolve(true); } }
        ],
        onClose: () => { if (!answered) resolve(false); }
      });
    });
  };

  NB.lightbox = function (src) {
    const back = h('div', { class: 'lightbox', onclick: () => back.remove() }, h('img', { src }));
    const onKey = (e) => { if (e.key === 'Escape') { back.remove(); document.removeEventListener('keydown', onKey, true); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', () => document.removeEventListener('keydown', onKey, true));
    document.body.append(back);
  };

  /* ---------- colour picker: a row of swatches plus an optional custom colour ---------- */
  NB.colorPicker = function ({ colors, value, custom = true, onChange }) {
    let cur = value;
    const wrap = h('div', { class: 'swatches' });
    const buttons = colors.map((c) => {
      const b = h('button', {
        type: 'button', class: 'swatch', title: c, style: { background: c },
        onclick: () => set(c)
      });
      wrap.append(b);
      return { c, b };
    });
    let customInput = null;
    if (custom) {
      customInput = h('input', {
        type: 'color', class: 'swatch custom', title: 'Pick any color',
        value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888',
        oninput: (e) => set(e.target.value)
      });
      wrap.append(customInput);
    }
    function paint() {
      let matched = false;
      buttons.forEach(({ c, b }) => {
        const on = c.toLowerCase() === String(cur).toLowerCase();
        b.classList.toggle('on', on);
        if (on) matched = true;
      });
      if (customInput) customInput.classList.toggle('on', !matched);
    }
    function set(c) {
      cur = c;
      paint();
      if (onChange) onChange(c);
    }
    paint();
    return { el: wrap, get: () => cur, set };
  };

  NB.shortDate = function (dateStr) {
    const d = NB.Store.parseDateStr(dateStr);
    if (!d) return '';
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('en-US', opts);
  };

  NB.autoGrow = function (ta) {
    if (!ta.scrollHeight) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  };
})();
