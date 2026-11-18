/* Layered boards (optional, off by default): the boards bar, the stack view, moving papers and the tutorial. */
(function () {
  'use strict';
  const NB = window.NB;
  const { h, clamp } = NB;
  const S = NB.Store;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const L = (NB.layered = {});

  const CARD_W = 1300, CARD_H = 620;

  L.enabled = () => !!NB.state.data.settings.layered;
  // animation length in ms; 0 when the user switched "Glide animation" off
  L.ms = (n) => (NB.state.data.settings.glide === false ? 0 : n);

  /* ---------- the boards bar (names only) ---------- */
  // ctx: { onSwitch(id), onAdd(), onStack(), onMenu(board, event) }
  L.bar = function (ctx) {
    const data = NB.state.data;
    const cur = S.currentBoard(data);
    const bar = h('div', { class: 'boards-bar' }, h('span', { class: 'bb-label', text: 'Boards' }));
    data.boards.forEach((b) => {
      const chip = h('button', {
        type: 'button', class: 'bchip' + (b.id === cur.id ? ' on' : ''), 'data-board': b.id, title: b.name,
        onclick: () => { if (b.id !== cur.id) ctx.onSwitch(b.id); }
      }, h('span', { class: 'bchip-name', text: b.name }));
      chip.addEventListener('contextmenu', (e) => { e.preventDefault(); ctx.onMenu(b, e); });
      bar.append(chip);
    });
    const full = data.boards.length >= S.MAX_BOARDS;
    const add = h('button', {
      type: 'button', class: 'bchip add' + (full ? ' lock' : ''), title: full ? 'You have the most boards for now' : 'New board'
    }, NB.icon(full ? 'pin' : 'plus'), full ? 'New board  ' + data.boards.length + ' / ' + S.MAX_BOARDS : 'New board');
    add.addEventListener('click', () => { if (full) limitPopover(bar, add); else ctx.onAdd(); });
    bar.append(add);
    bar.append(h('span', { class: 'bb-end' },
      h('button', { type: 'button', class: 'btn small stack-btn', onclick: ctx.onStack }, NB.icon('atlas'), 'Stack view')));
    return bar;
  };

  function limitPopover(bar, anchor) {
    const old = document.querySelector('.limit-pop');
    if (old) { old.remove(); return; }
    const pop = h('div', { class: 'limit-pop' },
      h('b', { text: 'You have ' + S.MAX_BOARDS + ' boards' }),
      h('span', { text: 'That is the most for now. Delete one to make room, or wait for more boards in a later version.' }));
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left - 10) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
    document.body.append(pop);
    const off = () => { pop.remove(); document.removeEventListener('pointerdown', off, true); };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
    setTimeout(off, 5000);
  }

  // While a paper is dragged: highlight the board name under the pointer, return its id.
  L.hitChip = function (x, y) {
    let found = null;
    document.querySelectorAll('.bchip[data-board]').forEach((c) => {
      const r = c.getBoundingClientRect();
      const hit = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      c.classList.toggle('drop', hit);
      if (hit) found = c.getAttribute('data-board');
    });
    return found;
  };
  L.clearDrop = function () {
    document.querySelectorAll('.bchip.drop').forEach((c) => c.classList.remove('drop'));
  };

  /* ---------- small dialogs and menus ---------- */
  L.nameDialog = function (title, value, okLabel, onOk, exceptId) {
    const data = NB.state.data;
    const input = h('input', { type: 'text', maxlength: '24', dir: 'auto', placeholder: 'Name of the board', value: value || '' });
    NB.modal({
      title,
      body: h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', { text: 'Name' }), input)),
      buttons: [{ label: 'Cancel' }, {
        label: okLabel, kind: 'primary',
        onClick: () => {
          const n = input.value.trim();
          if (!n) { NB.toast('Give the board a name first.'); input.focus(); return false; }
          if (S.boardNameTaken(data, n, exceptId)) { NB.toast('Another board already has that name.'); input.focus(); return false; }
          onOk(n);
        }
      }]
    });
    setTimeout(() => { input.focus(); input.select && input.select(); }, 30);
  };

  function popMenu(x, y, items) {
    document.querySelectorAll('.pop-menu').forEach((m) => m.remove());
    const menu = h('div', { class: 'pop-menu' });
    items.forEach((it) => {
      if (it.label) {
        menu.append(h('div', { class: 'menu-label', text: it.label }));
        return;
      }
      menu.append(h('button', { type: 'button', class: it.danger ? 'danger' : '', text: it.text, onclick: () => { off(); it.run(); } }));
    });
    menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 40 - items.length * 34) + 'px';
    document.body.append(menu);
    function off() { menu.remove(); document.removeEventListener('pointerdown', away, true); }
    function away(e) { if (!menu.contains(e.target)) off(); }
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  }

  L.boardMenu = function (board, e, ctx) {
    const data = NB.state.data;
    popMenu(e.clientX, e.clientY, [
      { text: 'Rename', run: () => L.nameDialog('Rename board', board.name, 'Save', (n) => { S.renameBoard(data, board.id, n); NB.save(); ctx.refresh(); }, board.id) },
      data.boards.length > 1 ? { text: 'Delete board', danger: true, run: () => ctx.remove(board) } : null
    ].filter(Boolean));
  };

  L.moveMenu = function (anchor, paper, onMove) {
    const data = NB.state.data;
    const r = anchor.getBoundingClientRect();
    popMenu(r.left, r.bottom + 4, [{ label: 'Move to board' }].concat(
      data.boards.filter((b) => b.id !== paper.board).map((b) => ({ text: b.name, run: () => onMove(b.id) }))));
  };

  /* ---------- the stack view ---------- */
  // A static copy of one board, used for the cards in the stack.
  function miniBoard(board) {
    const data = NB.state.data;
    const papers = S.boardPapers(data, board.id);
    const world = h('div', { class: 'board-world' });
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'strings-layer'); svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
    const pins = h('div', { class: 'pins-layer' });
    world.append(svg, pins);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    papers.forEach((p) => {
      x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x + S.PAPER_W); y2 = Math.max(y2, p.y + S.PAPER_H);
      const el = h('div', { class: 'paper', style: { '--tint': p.tint, left: p.x + 'px', top: p.y + 'px', zIndex: String(p.z || 1) } },
        h('div', { class: 'paper-body' },
          h('h3', { class: 'paper-title', dir: 'auto', text: p.title }),
          h('p', { class: 'paper-summary', dir: 'auto', text: p.summary })),
        h('div', { class: 'paper-foot' }, h('span'), h('span', { class: 'paper-open', text: 'Atlas ›' })));
      el.style.transform = 'rotate(' + p.rot + 'deg)';
      const a = S.pinAnchor(p);
      const pin = h('div', { class: 'pin', style: { left: a.x + 'px', top: a.y + 'px', zIndex: String(p.z || 1) } });
      pin.style.setProperty('--pin', p.pin);
      world.insertBefore(el, svg);
      pins.append(pin);
    });
    data.strings.forEach((s) => {
      const pa = papers.find((p) => p.id === s.a), pb = papers.find((p) => p.id === s.b);
      if (!pa || !pb) return;
      const path = S.stringPath(S.pinAnchor(pa), S.pinAnchor(pb));
      const g = document.createElementNS(SVGNS, 'g');
      const sh = document.createElementNS(SVGNS, 'path');
      sh.setAttribute('d', path.d); sh.setAttribute('class', 'thread-shadow'); sh.setAttribute('fill', 'none');
      const ln = document.createElementNS(SVGNS, 'path');
      ln.setAttribute('d', path.d); ln.setAttribute('class', 'thread-line'); ln.setAttribute('fill', 'none'); ln.setAttribute('stroke', s.color);
      g.append(sh, ln);
      svg.append(g);
    });
    if (papers.length) {
      const bw = x2 - x1, bh = y2 - y1;
      const k = Math.min(1.25, (CARD_W - 240) / bw, (CARD_H - 200) / bh);
      world.style.transform = 'translate(' + ((CARD_W - 20 - bw * k) / 2 - x1 * k) + 'px,' + ((CARD_H - 20 - bh * k) / 2 + 30 - y1 * k) + 'px) scale(' + k + ')';
    }
    return world;
  }

  // opts: { start (index), glideTo (index, optional), onPick(boardId), onClose() }
  L.openStack = function (host, opts) {
    const data = NB.state.data;
    const boards = data.boards;
    const N = boards.length;
    const mod = (j) => ((j % N) + N) % N;
    let p = opts.start || 0;
    let busy = false;

    const stage = h('div', { class: 'stack-stage' });
    const rig = h('div', { class: 'stack-rig' });
    stage.append(rig, h('div', { class: 'stack-fog l' }), h('div', { class: 'stack-fog r' }),
      h('div', { class: 'stack-hint', text: 'Hold left click and drag to turn through your boards. Click one to open it. Esc to close.' }));
    host.append(stage);
    stage.setAttribute('tabindex', '-1');

    const protos = {};
    boards.forEach((b) => { protos[b.id] = miniBoard(b); });
    const cards = new Map(); // slot j -> element
    let sc = 1, topY = 0, stageW = 800, stageH = 600;

    function measure() {
      const r = stage.getBoundingClientRect();
      stageW = r.width || 1100; stageH = r.height || 640;
      sc = Math.min((stageW * 0.74) / CARD_W, (stageH - 90) / CARD_H);
      topY = (stageH / sc - CARD_H) / 2;
      rig.style.transform = 'translateX(' + Math.round(stageW * 0.03) + 'px) scale(' + sc + ') rotateY(-22deg)';
      rig.style.perspectiveOrigin = '16% 50%';
    }

    function makeCard(j) {
      const b = boards[mod(j)];
      const el = h('div', { class: 'board-viewport stack-card', 'data-j': String(j) },
        protos[b.id].cloneNode(true),
        h('div', { class: 'stack-plate', text: b.name }),
        h('div', { class: 'stack-edge' }, h('span', { text: b.name })),
        h('div', { class: 'stack-shade' }));
      el.style.width = CARD_W + 'px'; el.style.height = CARD_H + 'px';
      el.style.left = '0px'; el.style.top = topY + 'px';
      return el;
    }

    function draw() {
      const lo = Math.floor(p) - 1, hi = Math.floor(p) + 5;
      cards.forEach((el, j) => { if (j < lo || j > hi) { el.remove(); cards.delete(j); } });
      for (let j = lo; j <= hi; j++) {
        let el = cards.get(j);
        if (!el) { el = makeCard(j); cards.set(j, el); rig.append(el); }
        const r = j - p;
        const x = r < 0 ? r * 1500 : r * 140;
        const y = r > 0 ? -r * 5 : 0;
        const z = r > 0 ? -r * 70 : 0;
        el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,' + z.toFixed(1) + 'px)';
        el.style.zIndex = String(100 - Math.round(Math.abs(r) * 10));
        const a = Math.abs(r);
        el.children[2].style.opacity = String(clamp(r, 0, 1));            // the name on the edge
        el.children[1].style.opacity = String(1 - clamp(a, 0, 1));        // the name plate on the front board
        el.children[3].style.opacity = String(r <= 0 ? 0 : Math.min(0.72, r * 0.15));
      }
    }

    function glide(to, done) {
      const from = p;
      const dur = L.ms(Math.min(700, 280 + Math.abs(to - from) * 160));
      if (!dur) { p = to; draw(); if (done) done(); return; }
      busy = true;
      const t0 = performance.now();
      (function step(now) {
        const t = clamp(((now || performance.now()) - t0) / dur, 0, 1);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        p = from + (to - from) * e;
        draw();
        if (t < 1) requestAnimationFrame(step);
        else { busy = false; p = to; draw(); if (done) done(); }
      })(t0);
    }

    function close() {
      document.removeEventListener('keydown', onKey, true);
      stage.remove();
      if (opts.onClose) opts.onClose();
    }
    function pick(j) {
      if (busy) return;
      const b = boards[mod(j)];
      const go = () => {
        document.removeEventListener('keydown', onKey, true);
        if (!L.ms(1)) { stage.remove(); opts.onPick(b.id); return; }
        // the view turns to face the chosen board, then the real board takes over
        rig.style.transition = 'transform ' + L.ms(420) + 'ms ease-in-out';
        rig.style.transform = 'translateX(0px) scale(' + (stageW / CARD_W) + ') rotateY(0deg)';
        setTimeout(() => { stage.remove(); opts.onPick(b.id); }, L.ms(430));
      };
      if (Math.abs(j - p) > 0.01) glide(j, go); else go();
    }

    /* dragging: hold the left button and move; the stack never ends */
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || busy) return;
      stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
      const sx = e.clientX, p0 = p;
      let moved = false, lastX = sx, lastT = performance.now(), vel = 0;
      stage.classList.add('dragging');
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - sx) < 4) return;
        moved = true;
        p = p0 - (ev.clientX - sx) / (stageW * 0.3);
        const now = performance.now();
        vel = (ev.clientX - lastX) / Math.max(1, now - lastT);
        lastX = ev.clientX; lastT = now;
        draw();
      };
      const up = (ev) => {
        stage.removeEventListener('pointermove', move);
        stage.removeEventListener('pointerup', up);
        stage.removeEventListener('pointercancel', up);
        stage.classList.remove('dragging');
        if (moved) glide(Math.round(p - clamp(vel, -2, 2) * 0.6), null);
        else if (ev.type === 'pointerup') {
          const t = document.elementFromPoint(ev.clientX, ev.clientY);
          const card = t && t.closest ? t.closest('.stack-card') : null;
          pick(card ? parseInt(card.getAttribute('data-j'), 10) : Math.round(p));
        }
      };
      stage.addEventListener('pointermove', move);
      stage.addEventListener('pointerup', up);
      stage.addEventListener('pointercancel', up);
    });
    let wheelT = null;
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (busy) return;
      p += (e.deltaY + e.deltaX) / 700;
      draw();
      clearTimeout(wheelT);
      wheelT = setTimeout(() => glide(Math.round(p), null), 140);
    }, { passive: false });
    function onKey(e) {
      if (document.querySelector('.modal-backdrop')) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' && !busy) glide(Math.round(p) + 1, null);
      else if (e.key === 'ArrowLeft' && !busy) glide(Math.round(p) - 1, null);
      else if (e.key === 'Enter') pick(Math.round(p));
    }
    document.addEventListener('keydown', onKey, true);

    measure();
    draw();
    if (opts.glideTo !== undefined) setTimeout(() => glide(opts.glideTo, () => pick(opts.glideTo)), L.ms(250));
    return { close };
  };

  /* ---------- the tutorial (shown when the option is switched on) ---------- */
  function artStack(drag) {
    const art = h('div', { class: 'tut-art' });
    const names = ['Home', 'Work', 'Study'];
    const deck = h('div', { class: 'tut-deck' });
    names.forEach((n, i) => {
      deck.append(h('div', { class: 'tut-card c' + i }, h('span', { text: n })));
    });
    art.append(deck);
    if (drag) art.append(h('div', { class: 'tut-hand', text: '←  hold left click and drag  →' }));
    return art;
  }
  function artBar() {
    const art = h('div', { class: 'tut-art' });
    art.append(h('div', { class: 'tut-bar' },
      h('span', { class: 'bchip', text: 'Home' }), h('span', { class: 'bchip on', text: 'Work' }), h('span', { class: 'bchip', text: 'Study' }),
      h('span', { class: 'bchip add lock' }, NB.icon('pin'), '3 / 3')));
    art.append(h('div', { class: 'tut-line', text: 'Only the name tells boards apart.' }));
    return art;
  }

  L.tutorial = function (onDone) {
    const steps = [
      { art: () => artStack(false), title: 'Boards sit one behind another', text: 'Each board has its own papers. They wait behind the one you are on, seen from the right.' },
      { art: () => artStack(true), title: 'Hold and drag to move through', text: 'Press the left button on the stack and drag left or right. It never runs out, it just keeps turning.' },
      { art: artBar, title: 'Switch by name, or add one', text: 'Click a name in the top bar to jump there. Drag a paper onto a name to move it. You can have up to ' + S.MAX_BOARDS + ' boards for now.' }
    ];
    let i = 0;
    const body = h('div', { class: 'tut' });
    const modal = NB.modal({ title: 'Layered boards', body, wide: true });
    modal.panel.classList.add('tut-modal');
    function render() {
      const s = steps[i];
      const last = i === steps.length - 1;
      body.replaceChildren(
        s.art(),
        h('h3', { class: 'tut-title', text: s.title }),
        h('p', { class: 'tut-text', text: s.text }),
        h('div', { class: 'tut-foot' },
          h('div', { class: 'tut-dots' }, steps.map((_, k) => h('i', { class: k === i ? 'on' : '' }))),
          h('span', { class: 'tut-btns' },
            i > 0 ? h('button', { type: 'button', class: 'btn small', text: 'Back', onclick: () => { i--; render(); } }) : null,
            h('button', { type: 'button', class: 'btn small primary', text: last ? 'Start' : 'Next', onclick: () => { if (last) { modal.close(); if (onDone) onDone(); } else { i++; render(); } } }))));
    }
    render();
  };
})();
