/* The notice board (papers, pins, threads) and each paper's Atlas page. */
(function () {
  'use strict';
  const NB = window.NB;
  const { h, clamp } = NB;
  const S = NB.Store;
  const SVGNS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }

  /* ---------- marks on the cork ---------- */
  // Old pin holes (some in the corners of long-gone posters), cork flecks and faint stains.
  // They are part of the board surface, so they travel with the papers when you pan:
  // that is what makes the papers feel pinned to the board instead of floating over it.
  function boardMarks(ext, seedText) {
    let s = 2166136261;
    for (const ch of String(seedText)) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
    const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const between = (a, z) => a + rnd() * (z - a);
    const svg = svgEl('svg', { class: 'cork-marks', width: ext.w, height: ext.h, viewBox: '0 0 ' + ext.w + ' ' + ext.h });
    svg.style.left = ext.x + 'px'; svg.style.top = ext.y + 'px';
    const defs = svgEl('defs');
    [['stain-dark', '10,4,2', .34], ['stain-light', '235,170,100', .16]].forEach(([id, rgb, a]) => {
      const g = svgEl('radialGradient', { id: id });
      g.append(svgEl('stop', { offset: '0', 'stop-color': 'rgb(' + rgb + ')', 'stop-opacity': a }), svgEl('stop', { offset: '1', 'stop-color': 'rgb(' + rgb + ')', 'stop-opacity': 0 }));
      defs.append(g);
    });
    svg.append(defs);
    const add = (name, attrs) => svg.append(svgEl(name, attrs));
    for (let i = 0; i < 26; i++) { // large faint stains and sun-faded patches
      const rx = between(90, 340), ry = rx * between(.5, 1);
      add('ellipse', { cx: between(0, ext.w), cy: between(0, ext.h), rx: rx, ry: ry, fill: 'url(#' + (i % 3 ? 'stain-dark' : 'stain-light') + ')' });
    }
    for (let i = 0; i < Math.round(ext.w * ext.h / 9000); i++) { // cork flecks
      const light = rnd() < .5;
      add('ellipse', { cx: between(0, ext.w), cy: between(0, ext.h), rx: between(1.2, 4.5), ry: between(.8, 2.6),
        transform: 'rotate(' + Math.round(between(0, 180)) + ' 0 0)', 'transform-origin': 'center',
        fill: light ? 'rgba(232,160,90,.28)' : 'rgba(18,7,3,.4)' });
    }
    const hole = (x, y) => {
      const r = between(1.3, 2.3);
      add('circle', { cx: x + .7, cy: y + .9, r: r + .7, fill: 'none', stroke: 'rgba(255,190,130,.16)', 'stroke-width': 1 });
      add('circle', { cx: x, cy: y, r: r, fill: 'rgba(8,3,1,.82)' });
    };
    for (let i = 0; i < Math.round(ext.w * ext.h / 70000); i++) { // posters that used to hang here: four holes in a rectangle
      const x = between(60, ext.w - 400), y = between(60, ext.h - 460), w = between(110, 300), hh = between(150, 380);
      [[0, 0], [w, 0], [0, hh], [w, hh]].forEach(([dx, dy]) => { if (rnd() < .8) hole(x + dx + between(-3, 3), y + dy + between(-3, 3)); });
    }
    for (let i = 0; i < Math.round(ext.w * ext.h / 90000); i++) hole(between(20, ext.w - 20), between(20, ext.h - 20)); // single holes
    return svg;
  }

  /* ---------- the paper form (new + edit) ---------- */
  // onSave(fields) is called with {title, summary, pin, tint, journalDate}
  NB.paperModal = function (paper, onSave) {
    const data = NB.state.data;
    const draft = paper
      ? { pin: paper.pin, tint: paper.tint }
      : { pin: data.settings.lastPin || S.PIN_COLORS[0], tint: S.TINTS[0] };

    const title = h('input', { type: 'text', maxlength: '50', dir: 'auto', placeholder: 'Name of the paper', value: paper ? paper.title : '' });
    const summary = h('textarea', { rows: '2', maxlength: '90', dir: 'auto', placeholder: 'A short note shown on the paper (1-2 lines)' });
    summary.value = paper ? paper.summary : '';
    const pinPicker = NB.colorPicker({ colors: S.PIN_COLORS, value: draft.pin, onChange: (c) => { draft.pin = c; } });
    const tintPicker = NB.colorPicker({ colors: S.TINTS, value: draft.tint, custom: false, onChange: (c) => { draft.tint = c; } });
    const date = h('input', { type: 'date', value: paper && paper.journalDate ? paper.journalDate : '' });

    const body = h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', { text: 'Name' }), title),
      h('label', { class: 'field' }, h('span', { text: 'Short description' }), summary),
      h('div', { class: 'field' }, h('span', { text: 'Pin color' }), pinPicker.el),
      h('div', { class: 'field' }, h('span', { text: 'Paper' }), tintPicker.el),
      h('div', { class: 'field' }, h('span', { text: 'Link to a journal day (optional)' }),
        h('div', { class: 'row' }, date,
          h('button', { type: 'button', class: 'btn small', text: 'Today', onclick: () => { date.value = S.localDateStr(); } }),
          h('button', { type: 'button', class: 'btn small', text: 'Clear', onclick: () => { date.value = ''; } }))));

    NB.modal({
      title: paper ? 'Edit paper' : 'New paper',
      body,
      buttons: [
        { label: 'Cancel' },
        {
          label: paper ? 'Save' : 'Pin it', kind: 'primary',
          onClick: () => {
            const t = title.value.trim();
            if (!t) { NB.toast('Give the paper a name first.'); title.focus(); return false; }
            data.settings.lastPin = draft.pin;
            onSave({
              title: t, summary: summary.value.trim(), pin: draft.pin, tint: draft.tint,
              journalDate: S.parseDateStr(date.value) ? date.value : null
            });
          }
        }
      ]
    });
    setTimeout(() => title.focus(), 30);
  };

  /* ---------- the board ---------- */
  function mountBoard(container, params) {
    const data = NB.state.data;
    const board = S.currentBoard(data);
    const view = board.view;
    const layered = !!data.settings.layered;
    const mine = () => S.boardPapers(data, board.id);
    const els = new Map(); // paper id -> { el, pin }
    const tool = { string: false, color: data.settings.stringColor || S.STRING_COLORS[0], from: null };
    let selString = null;
    let menu = null;
    let zTop = data.papers.reduce((m, p) => Math.max(m, p.z || 0), 0);

    /* toolbar */
    const zoomLabel = h('button', { type: 'button', class: 'btn small zoom-label', title: 'Reset zoom', onclick: () => zoomTo(1) });
    const threadHint = h('span', { class: 'tool-hint', text: 'Click two papers to tie them together' });
    const threadPicker = NB.colorPicker({
      colors: S.STRING_COLORS, value: tool.color,
      onChange: (c) => { tool.color = c; data.settings.stringColor = c; NB.save(); }
    });
    const threadOpts = h('div', { class: 'thread-opts hidden' }, threadPicker.el, threadHint);
    const btnThread = h('button', { type: 'button', class: 'btn', onclick: () => setStringTool(!tool.string) }, NB.icon('thread'), 'Thread');
    const toolbar = h('div', { class: 'board-toolbar' },
      h('button', { type: 'button', class: 'btn primary', onclick: openNew }, NB.icon('note'), 'New paper'),
      btnThread, threadOpts,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn small', title: 'Zoom out', onclick: () => zoomBy(1 / 1.2) }, NB.icon('minus')),
      zoomLabel,
      h('button', { type: 'button', class: 'btn small', title: 'Zoom in', onclick: () => zoomBy(1.2) }, NB.icon('plus')),
      h('button', { type: 'button', class: 'btn small', title: 'Show all papers', onclick: fitAll }, NB.icon('fit'), 'Fit'));
    const refresh = () => NB.go('board');
    const bar = layered ? NB.layered.bar({
      onSwitch: (id) => { S.setActiveBoard(data, id); NB.save(); NB.go('board', { anim: true }); },
      onAdd: () => NB.layered.nameDialog('New board', '', 'Create', (n) => {
        const old = data.boards.indexOf(board);
        const b = S.addBoard(data, n);
        if (!b) { NB.toast('Could not add the board.'); return; }
        S.setActiveBoard(data, b.id);
        NB.save();
        openStack(old, data.boards.length - 1);
      }),
      onStack: () => openStack(data.boards.indexOf(board)),
      onMenu: (b, e) => NB.layered.boardMenu(b, e, { refresh, remove: removeBoard })
    }) : null;

    /* world */
    const svg = svgEl('svg', { class: 'strings-layer', width: '1', height: '1' });
    const pinsLayer = h('div', { class: 'pins-layer' });
    // the board is a real, finite surface: a cork panel in a wooden frame that moves as one piece with the papers
    const FRAME = 34;
    const ext = { x: -700, y: -500, w: 4200, h: 2800 };
    mine().forEach((p) => {
      ext.x = Math.min(ext.x, p.x - 300); ext.y = Math.min(ext.y, p.y - 300);
      ext.w = Math.max(ext.w, p.x + S.PAPER_W + 300 - ext.x); ext.h = Math.max(ext.h, p.y + S.PAPER_H + 300 - ext.y);
    });
    const frame = h('div', { class: 'board-frame', style: { left: (ext.x - FRAME) + 'px', top: (ext.y - FRAME) + 'px', width: (ext.w + FRAME * 2) + 'px', height: (ext.h + FRAME * 2) + 'px' } });
    const cork = h('div', { class: 'cork', style: { left: ext.x + 'px', top: ext.y + 'px', width: ext.w + 'px', height: ext.h + 'px' } });
    const marks = boardMarks(ext, board.id);
    // the lamp's glow lives on the cork too, so light and board move as one piece
    const lamp = h('div', { class: 'cork-lamp', style: { left: ext.x + 'px', top: ext.y + 'px', width: ext.w + 'px', height: ext.h + 'px' } });
    const world = h('div', { class: 'board-world' }, frame, cork, marks, lamp, svg, pinsLayer);
    const emptyHint = h('div', { class: 'board-empty', text: 'Your board is empty. Press "New paper" to pin your first note.' });
    const viewport = h('div', { class: 'board-viewport' }, world, h('div', { class: 'board-light' }), emptyHint);
    const root = h('div', { class: 'board-view' }, bar, toolbar, viewport);
    if (params && params.anim && NB.layered.ms(1)) root.classList.add('glide-in');
    container.append(root);

    /* ----- view ----- */
    // keep the board in view: you can look around it, but never past its wooden edge
    function clampView() {
      const r = viewport.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x0 = (ext.x - FRAME) * view.zoom, x1 = (ext.x + ext.w + FRAME) * view.zoom;
      const y0 = (ext.y - FRAME) * view.zoom, y1 = (ext.y + ext.h + FRAME) * view.zoom;
      view.x = x1 - x0 <= r.width ? (r.width - (x1 - x0)) / 2 - x0 : clamp(view.x, r.width - x1, -x0);
      view.y = y1 - y0 <= r.height ? (r.height - (y1 - y0)) / 2 - y0 : clamp(view.y, r.height - y1, -y0);
    }
    function applyView() {
      clampView();
      world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.zoom + ')';
      zoomLabel.textContent = Math.round(view.zoom * 100) + '%';
    }
    function zoomAt(cx, cy, factor) {
      const r = viewport.getBoundingClientRect();
      const mx = cx - r.left, my = cy - r.top;
      const nz = clamp(view.zoom * factor, 0.25, 2.5);
      const k = nz / view.zoom;
      view.x = mx - (mx - view.x) * k;
      view.y = my - (my - view.y) * k;
      view.zoom = nz;
      applyView();
      NB.save();
    }
    function zoomBy(f) {
      const r = viewport.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
    }
    function zoomTo(z) {
      const r = viewport.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, z / view.zoom);
    }
    function fitAll() {
      const list = mine();
      if (!list.length) { view.x = 0; view.y = 0; view.zoom = 1; applyView(); NB.save(); return; }
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      list.forEach((p) => {
        x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
        x2 = Math.max(x2, p.x + S.PAPER_W); y2 = Math.max(y2, p.y + S.PAPER_H);
      });
      const r = viewport.getBoundingClientRect();
      const bw = x2 - x1, bh = y2 - y1;
      view.zoom = clamp(Math.min((r.width - 140) / bw, (r.height - 140) / bh), 0.25, 1.2);
      view.x = (r.width - bw * view.zoom) / 2 - x1 * view.zoom;
      view.y = (r.height - bh * view.zoom) / 2 - y1 * view.zoom;
      applyView();
      NB.save();
    }
    function viewCenterWorld() {
      const r = viewport.getBoundingClientRect();
      return { x: (r.width / 2 - view.x) / view.zoom, y: (r.height / 2 - view.y) / view.zoom };
    }

    /* ----- papers ----- */
    function place(p) {
      const rec = els.get(p.id);
      if (!rec) return;
      rec.el.style.left = p.x + 'px';
      rec.el.style.top = p.y + 'px';
      rec.el.style.transform = 'rotate(' + p.rot + 'deg)';
      const a = S.pinAnchor(p);
      rec.pin.style.left = a.x + 'px';
      rec.pin.style.top = a.y + 'px';
    }

    function renderPaper(p) {
      const old = els.get(p.id);
      const chip = p.journalDate
        ? h('button', {
          type: 'button', class: 'chip', title: 'Open journal day',
          onclick: (e) => { e.stopPropagation(); NB.go('journal', { date: p.journalDate }); }
        }, NB.icon('book'), NB.shortDate(p.journalDate))
        : null;
      if (chip) chip.setAttribute('data-nodrag', '');

      const moveBtn = layered && data.boards.length > 1
        ? h('button', { type: 'button', class: 'icon-btn', title: 'Move to another board', onclick: (e) => NB.layered.moveMenu(e.currentTarget, p, (id) => moveTo(p, id)) }, NB.icon('chevR'))
        : null;
      const actions = h('div', { class: 'paper-actions' },
        moveBtn,
        h('button', { type: 'button', class: 'icon-btn', title: 'Edit', onclick: () => editPaper(p) }, NB.icon('edit')),
        h('button', { type: 'button', class: 'icon-btn', title: 'Delete', onclick: () => deletePaper(p) }, NB.icon('trash')));
      actions.setAttribute('data-nodrag', '');

      const el = h('div', { class: 'paper', 'data-id': p.id, style: { '--tint': p.tint, zIndex: String(p.z || 1) } },
        h('div', { class: 'paper-body' },
          h('h3', { class: 'paper-title', dir: 'auto', text: p.title }),
          h('p', { class: 'paper-summary', dir: 'auto', text: p.summary })),
        h('div', { class: 'paper-foot' }, chip || h('span'), h('span', { class: 'paper-open', text: 'Atlas ›' })),
        actions);
      if (tool.from === p.id) el.classList.add('string-from');
      el.addEventListener('pointerdown', (e) => onPaperDown(e, p, el));
      if (moveBtn) {
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          NB.layered.moveMenu({ getBoundingClientRect: () => ({ left: e.clientX, bottom: e.clientY }) }, p, (id) => moveTo(p, id));
        });
      }

      let pin;
      if (old) { pin = old.pin; old.el.replaceWith(el); } else { pin = h('div', { class: 'pin' }); pinsLayer.append(pin); world.insertBefore(el, svg); }
      pin.style.setProperty('--pin', p.pin);
      pin.style.zIndex = String(p.z || 1);
      els.set(p.id, { el, pin });
      place(p);
      emptyHint.classList.toggle('hidden', mine().length > 0);
    }

    function onPaperDown(e, p, el) {
      if (e.button !== 0 || e.target.closest('[data-nodrag]')) return;
      e.stopPropagation();
      hideMenu();
      const sx = e.clientX, sy = e.clientY, ox = p.x, oy = p.y;
      let moved = false, dropTarget = null, ghost = null, swing = 0;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved) {
          if (Math.hypot(dx, dy) < 5) return;
          moved = true;
          el.classList.add('dragging');
          p.z = ++zTop;
          el.style.zIndex = String(p.z);
          els.get(p.id).pin.style.zIndex = String(p.z);
        }
        p.x = clamp(ox + dx / view.zoom, ext.x + 6, ext.x + ext.w - S.PAPER_W - 6);
        p.y = clamp(oy + dy / view.zoom, ext.y + 6, ext.y + ext.h - S.PAPER_H - 6);
        place(p);
        // the paper swings a little as it is pulled along, hanging from its pin
        swing = clamp(swing * 0.7 + (ev.movementX || 0) * 0.45, -7, 7);
        el.style.transform = 'rotate(' + (p.rot + swing) + 'deg)';
        renderStrings();
        if (layered) {
          dropTarget = NB.layered.hitChip(ev.clientX, ev.clientY);
          if (!ghost) { ghost = h('div', { class: 'drag-ghost', text: p.title }); document.body.append(ghost); }
          ghost.style.left = (ev.clientX + 14) + 'px'; ghost.style.top = (ev.clientY + 14) + 'px';
        }
      };
      const up = (ev) => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        if (moved) { el.style.transition = 'transform .4s cubic-bezier(.3, 1.7, .5, 1), box-shadow .15s, scale .15s'; place(p); setTimeout(() => { el.style.transition = ''; }, 420); }
        if (layered) NB.layered.clearDrop();
        if (ghost) { ghost.remove(); ghost = null; }
        if (moved && dropTarget && dropTarget !== board.id) { p.x = ox; p.y = oy; place(p); renderStrings(); moveTo(p, dropTarget); }
        else if (moved) NB.save();
        else if (ev.type === 'pointerup') onPaperClick(p);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }

    function onPaperClick(p) {
      if (tool.string) stringPick(p);
      else NB.go('atlas', { id: p.id });
    }

    function openNew() {
      NB.paperModal(null, (f) => {
        const c = viewCenterWorld();
        const p = S.makePaper({
          title: f.title, summary: f.summary, pin: f.pin, tint: f.tint, journalDate: f.journalDate, board: board.id,
          x: c.x - S.PAPER_W / 2 + (Math.random() * 60 - 30), y: c.y - S.PAPER_H / 2 + (Math.random() * 60 - 30), z: ++zTop
        });
        data.papers.push(p);
        renderPaper(p);
        NB.save();
      });
    }

    function editPaper(p) {
      NB.paperModal(p, (f) => {
        Object.assign(p, f);
        renderPaper(p);
        renderStrings();
        NB.save();
      });
    }

    async function deletePaper(p) {
      const keeps = S.hasAtlasContent(p.atlas);
      const msg = keeps
        ? 'Take "' + p.title + '" off the board? Its Atlas is kept in the Atlas list (crossed out), so you can still open it.'
        : 'Take "' + p.title + '" off the board?';
      if (!(await NB.confirm(msg, 'Remove'))) return;
      const res = S.removePaper(data, p.id);
      if (!res) return;
      res.media.forEach((f) => window.nbApi.deleteMedia(f));
      const rec = els.get(p.id);
      if (rec) { rec.el.remove(); rec.pin.remove(); els.delete(p.id); }
      if (tool.from === p.id) tool.from = null;
      emptyHint.classList.toggle('hidden', mine().length > 0);
      renderStrings();
      NB.save();
      if (res.archived) NB.toast('The Atlas was kept in the Atlas list.');
    }

    /* ----- threads ----- */
    function setStringTool(on) {
      tool.string = on;
      tool.from = null;
      btnThread.classList.toggle('active', on);
      threadOpts.classList.toggle('hidden', !on);
      viewport.classList.toggle('tool-string', on);
      markFrom();
    }
    function markFrom() {
      els.forEach((rec, id) => rec.el.classList.toggle('string-from', tool.from === id));
    }
    function stringPick(p) {
      if (!tool.from) { tool.from = p.id; markFrom(); return; }
      if (tool.from === p.id) { tool.from = null; markFrom(); return; }
      const existing = data.strings.find((s) => S.sameLink(s, tool.from, p.id));
      if (existing) { existing.color = tool.color; NB.toast('Already tied together - thread color updated.'); }
      else data.strings.push({ id: S.newId(), a: tool.from, b: p.id, color: tool.color });
      tool.from = null;
      markFrom();
      renderStrings();
      NB.save();
    }

    function renderStrings() {
      svg.replaceChildren();
      data.strings.forEach((s) => {
        const pa = data.papers.find((p) => p.id === s.a);
        const pb = data.papers.find((p) => p.id === s.b);
        if (!pa || !pb || pa.board !== board.id || pb.board !== board.id) return;
        const path = S.stringPath(S.pinAnchor(pa), S.pinAnchor(pb));
        const g = svgEl('g', { class: 'thread' + (selString === s.id ? ' selected' : '') });
        g.append(
          svgEl('path', { d: path.d, class: 'thread-shadow', fill: 'none' }),
          svgEl('path', { d: path.d, class: 'thread-line', fill: 'none', stroke: s.color }),
          svgEl('path', { d: path.d, class: 'thread-hit', fill: 'none' }));
        g.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          selString = s.id;
          renderStrings();
          showMenu(s, e);
        });
        svg.append(g);
      });
    }

    function showMenu(s, e) {
      removeMenu();
      const r = viewport.getBoundingClientRect();
      const picker = NB.colorPicker({
        colors: S.STRING_COLORS, value: s.color,
        onChange: (c) => { s.color = c; renderStrings(); NB.save(); }
      });
      menu = h('div', { class: 'string-menu' },
        h('div', { class: 'menu-label', text: 'Thread color' }), picker.el,
        h('button', {
          type: 'button', class: 'btn danger small',
          onclick: () => {
            data.strings = data.strings.filter((x) => x.id !== s.id);
            hideMenu();
            NB.save();
          }
        }, NB.icon('trash'), 'Remove thread'));
      menu.style.left = clamp(e.clientX - r.left, 8, Math.max(8, r.width - 250)) + 'px';
      menu.style.top = clamp(e.clientY - r.top + 10, 8, Math.max(8, r.height - 150)) + 'px';
      menu.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      viewport.append(menu);
    }
    function removeMenu() { if (menu) { menu.remove(); menu = null; } }
    function hideMenu() {
      removeMenu();
      if (selString) { selString = null; renderStrings(); }
    }

    /* ----- pan & zoom ----- */
    let glideRaf = 0;
    function stopGlide() { cancelAnimationFrame(glideRaf); glideRaf = 0; }
    viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      hideMenu();
      stopGlide();
      const sx = e.clientX, sy = e.clientY, ox = view.x, oy = view.y;
      let lx = e.clientX, ly = e.clientY, lt = performance.now(), vx = 0, vy = 0;
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add('panning');
      let moved = false;
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        moved = true;
        view.x = ox + ev.clientX - sx;
        view.y = oy + ev.clientY - sy;
        applyView();
        const now = performance.now(), dt = Math.max(1, now - lt);
        vx = vx * 0.6 + ((ev.clientX - lx) / dt) * 0.4; vy = vy * 0.6 + ((ev.clientY - ly) / dt) * 0.4;
        lx = ev.clientX; ly = ev.clientY; lt = now;
      };
      const up = () => {
        viewport.removeEventListener('pointermove', move);
        viewport.removeEventListener('pointerup', up);
        viewport.removeEventListener('pointercancel', up);
        viewport.classList.remove('panning');
        if (moved) {
          NB.save();
          // let go while moving: the view coasts to a stop, like a heavy board sliding on its own weight
          if (performance.now() - lt < 90 && Math.hypot(vx, vy) > 0.15 && NB.layered.ms(1)) {
            let last = performance.now();
            const coast = (now) => {
              const dt = Math.min(40, now - last); last = now;
              view.x += vx * dt; view.y += vy * dt;
              const f = Math.pow(0.93, dt / 16); vx *= f; vy *= f;
              applyView();
              if (Math.hypot(vx, vy) > 0.02) glideRaf = requestAnimationFrame(coast);
              else { glideRaf = 0; NB.save(); }
            };
            glideRaf = requestAnimationFrame(coast);
          }
        }
      };
      viewport.addEventListener('pointermove', move);
      viewport.addEventListener('pointerup', up);
      viewport.addEventListener('pointercancel', up);
    });
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      stopGlide();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    function onKey(e) {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) {
        if (menu || selString) hideMenu();
        else if (tool.string) setStringTool(false);
      }
    }
    document.addEventListener('keydown', onKey);

    /* ----- layered boards ----- */
    function moveTo(p, boardId) {
      const target = data.boards.find((b) => b.id === boardId);
      if (!target || !S.movePaper(data, p.id, boardId)) return;
      const rec = els.get(p.id);
      if (rec) { rec.el.remove(); rec.pin.remove(); els.delete(p.id); }
      if (tool.from === p.id) tool.from = null;
      emptyHint.classList.toggle('hidden', mine().length > 0);
      renderStrings();
      NB.save();
      NB.toast('Moved "' + p.title + '" to ' + target.name + '.');
    }
    async function removeBoard(b) {
      const n = S.boardPapers(data, b.id).length;
      const msg = 'Delete the board "' + b.name + '"?' + (n ? ' Its ' + n + ' paper' + (n === 1 ? '' : 's') + ' will be taken off (Atlases with notes are kept in the Atlas list).' : '');
      if (!(await NB.confirm(msg, 'Delete board'))) return;
      const res = S.deleteBoard(data, b.id);
      if (!res) return;
      res.media.forEach((f) => window.nbApi.deleteMedia(f));
      NB.save();
      NB.go('board');
    }
    let stack = null;
    function openStack(start, glideTo) {
      if (stack) { stack.close(); stack = null; return; }
      const btn = root.querySelector('.stack-btn');
      if (btn) btn.classList.add('active');
      stack = NB.layered.openStack(root, {
        start, glideTo,
        onPick: (id) => { stack = null; S.setActiveBoard(data, id); NB.save(); NB.go('board', { anim: true }); },
        onClose: () => { stack = null; if (btn) btn.classList.remove('active'); }
      });
    }

    /* ----- start ----- */
    window.addEventListener('resize', applyView);
    mine().forEach(renderPaper);
    renderStrings();
    applyView();
    emptyHint.classList.toggle('hidden', mine().length > 0);

    return {
      destroy() { stopGlide(); window.removeEventListener('resize', applyView); document.removeEventListener('keydown', onKey); if (stack) stack.close(); }
    };
  }

  /* ---------- the Atlas: one free page per paper ---------- */
  // params: { id, from }  -  "from: 'atlaslist'" makes the back button return to the list.
  // An Atlas whose paper left the board is opened from data.archive.
  function mountAtlas(container, params) {
    const data = NB.state.data;
    const id = params && params.id;
    let paper = data.papers.find((p) => p.id === id);
    const archived = !paper;
    if (archived) paper = S.findArchived(data, id);
    if (!paper) { setTimeout(() => NB.go(params && params.from === 'atlaslist' ? 'atlaslist' : 'board'), 0); return null; }
    const fromList = archived || (params && params.from === 'atlaslist');

    const head = h('div', { class: 'atlas-head' });
    const host = h('div', { class: 'atlas-host' });
    container.append(h('div', { class: 'atlas-view' }, head, host));

    async function restore() {
      const cb = S.currentBoard(NB.state.data);
      const v = cb.view;
      const rect = document.querySelector('main').getBoundingClientRect();
      const x = (rect.width / 2 - v.x) / v.zoom - S.PAPER_W / 2;
      const y = (rect.height / 2 - v.y) / v.zoom - S.PAPER_H / 2;
      const z = data.papers.reduce((m, p) => Math.max(m, p.z || 0), 0) + 1;
      if (!S.restoreArchived(data, paper.id, x, y, z, cb.id)) return;
      NB.save();
      NB.toast('"' + paper.title + '" is back on the board.');
      NB.go('board');
    }

    async function destroyForever() {
      if (!(await NB.confirm('Delete the Atlas of "' + paper.title + '" for good? Its text, images and voice notes will be lost.', 'Delete'))) return;
      S.deleteArchived(data, paper.id).forEach((f) => window.nbApi.deleteMedia(f));
      NB.save();
      NB.go('atlaslist');
    }

    function renderHead() {
      // (replaceChildren would turn a null into the text "null", so empty slots are filtered out)
      head.replaceChildren(...[
        h('button', { type: 'button', class: 'btn', onclick: () => NB.go(fromList ? 'atlaslist' : 'board') },
          NB.icon('back'), fromList ? 'Atlas' : 'Board'),
        h('span', { class: 'atlas-pin' + (archived ? ' gone' : ''), style: { '--pin': paper.pin } }),
        h('div', { class: 'atlas-titles' },
          h('h2', { dir: 'auto', text: paper.title }),
          paper.summary ? h('p', { dir: 'auto', text: paper.summary }) : null),
        archived ? h('span', { class: 'badge', text: 'Removed from the board' }) : null,
        h('span', { class: 'spacer' }),
        h('div', { class: 'mode-switch', title: 'Page style of this Atlas' },
          h('button', { type: 'button', class: paper.atlas.mode === 'sheet' ? 'on' : '', text: 'Notebook', onclick: () => setMode('sheet') }),
          h('button', { type: 'button', class: paper.atlas.mode === 'free' ? 'on' : '', text: 'Free page', onclick: () => setMode('free') })),
        paper.journalDate
          ? h('button', { type: 'button', class: 'btn small', title: 'Open journal day', onclick: () => NB.go('journal', { date: paper.journalDate }) },
            NB.icon('book'), NB.shortDate(paper.journalDate))
          : null,
        archived
          ? h('button', { type: 'button', class: 'btn small', onclick: restore }, NB.icon('undo'), 'Put back on the board')
          : h('button', { type: 'button', class: 'btn small', onclick: () => NB.paperModal(paper, (f) => { Object.assign(paper, f); NB.save(); renderHead(); }) },
            NB.icon('edit'), 'Edit'),
        archived
          ? h('button', { type: 'button', class: 'btn small danger', onclick: destroyForever }, NB.icon('trash'), 'Delete forever')
          : null
      ].filter(Boolean));
    }
    // ----- the two page styles: a ruled notebook sheet (default) and the free page -----
    let page = null;
    function destroyBody() {
      if (page) { page.destroy(); page = null; }
      host.replaceChildren();
    }
    function setMode(m) {
      if (paper.atlas.mode === m) return;
      destroyBody();
      paper.atlas.mode = m;
      NB.save();
      renderHead();
      renderBody();
    }
    function renderBody() {
      if (paper.atlas.mode === 'free') {
        page = NB.mountPage(host, {
          blocks: paper.atlas.blocks,
          onChange: NB.save,
          autoText: true,
          className: 'sheet',
          placeholder: 'Details, notes, ideas about this paper...'
        });
        return;
      }
      const ta = h('textarea', {
        class: 'notebook-text', dir: 'auto', spellcheck: 'false',
        placeholder: 'Start writing...   (Need pictures or voice notes? Switch to Free page.)'
      });
      ta.value = paper.atlas.sheet.text;
      ta.addEventListener('input', () => { paper.atlas.sheet.text = ta.value; NB.autoGrow(ta); NB.save(); });
      const paperEl = h('div', { class: 'notebook-paper' }, ta);
      paperEl.addEventListener('mousedown', (e) => { if (e.target === paperEl) { e.preventDefault(); ta.focus(); } });
      host.append(h('div', { class: 'page-editor notebook' }, h('div', { class: 'notebook-scroll' }, paperEl)));
      requestAnimationFrame(() => { NB.autoGrow(ta); if (!paper.atlas.sheet.text) ta.focus(); });
    }
    renderHead();
    renderBody();

    return {
      destroy() {
        if (page) page.destroy();
        // an archived Atlas that was emptied out has nothing left to keep
        if (archived && S.findArchived(data, paper.id) && !S.hasAtlasContent(paper.atlas)) S.deleteArchived(data, paper.id);
        NB.save();
      }
    };
  }

  NB.board = { mount: mountBoard };
  NB.atlas = { mount: mountAtlas };
})();
