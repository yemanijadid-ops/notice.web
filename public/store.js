/* Notice Board - data model and pure helpers.
 * Works both in the app window (window.NBStore) and in Node (require) so it can be tested. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NBStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PAPER_W = 220;
  var PAPER_H = 150;
  var PIN_OFFSET_Y = 16; // distance of the pin from the paper's top edge

  var PIN_COLORS = ['#c0392b', '#d9772b', '#e3a13a', '#7f9a3a', '#2f9c95', '#3b78c2', '#8a58b5', '#ece3cc', '#1c1c1c'];
  var STRING_COLORS = ['#b3261e', '#d9772b', '#e3a13a', '#ece3cc', '#6f8f3a', '#3b78c2', '#8a58b5', '#2b2b2b'];
  var TINTS = ['#e2cfa6', '#e8c76b', '#dba597', '#b9c6a0', '#a9b9c8', '#eee6d3'];

  var PROMPTS = {
    day: [
      { key: 'grateful', title: 'I am grateful for...', lines: 3 },
      { key: 'great', title: 'What would make today great?', lines: 3 },
      { key: 'affirm', title: 'Daily affirmation. I am...', lines: 2 }
    ],
    night: [
      { key: 'amazing', title: '3 amazing things that happened today...', lines: 3 },
      { key: 'better', title: 'How could I have made today better?', lines: 2 }
    ]
  };

  // Fonts for the main titles. "scale" evens out how big each one looks at the same size.
  // Burnt Serif (Latin + Persian) and Orange Avenue are bundled with the app; the others are fonts that come with Windows
  // (each has a fallback, so a missing font never breaks anything).
  var FONTS = [
    { key: 'burnt', label: 'Burnt Serif', note: 'Warm Garamond serif, Persian too (default)', scale: 1,
      css: '"Burnt Serif Latin", "Burnt Serif Persian", Georgia, "Palatino Linotype", serif' },
    { key: 'georgia', label: 'Georgia', note: 'Classic book serif', scale: 0.82,
      css: 'Georgia, "Times New Roman", serif' },
    { key: 'palatino', label: 'Palatino', note: 'Calligraphic serif', scale: 0.84,
      css: '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif' },
    { key: 'constantia', label: 'Constantia', note: 'Soft, warm serif', scale: 0.86,
      css: 'Constantia, Georgia, serif' },
    { key: 'segoeprint', label: 'Segoe Print', note: 'Neat handwriting', scale: 0.72,
      css: '"Segoe Print", "Bradley Hand", "Ink Free", cursive' },
    { key: 'inkfree', label: 'Ink Free', note: 'Casual pen handwriting', scale: 0.88,
      css: '"Ink Free", "Segoe Print", "Bradley Hand", cursive' },
    { key: 'bahnschrift', label: 'Bahnschrift', note: 'Clean, modern sans', scale: 0.76,
      css: 'Bahnschrift, "Segoe UI", Tahoma, sans-serif' }
  ];
  var DEFAULT_FONT = 'burnt';
  function fontById(key) {
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].key === key) return FONTS[i];
    return FONTS[0];
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- dates (always local time, never toISOString) ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function localDateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseDateStr(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
    return d;
  }
  function shiftDate(s, days) {
    var d = parseDateStr(s) || new Date();
    d.setDate(d.getDate() + days);
    return localDateStr(d);
  }

  /* ---------- journal entries ---------- */
  function emptyLines(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push('');
    return a;
  }
  function emptyEntry() {
    var e = { mode: 'guided', day: {}, night: {}, free: { blocks: [] } };
    PROMPTS.day.forEach(function (p) { e.day[p.key] = emptyLines(p.lines); });
    PROMPTS.night.forEach(function (p) { e.night[p.key] = emptyLines(p.lines); });
    return e;
  }
  function normalizeEntry(src) {
    var e = emptyEntry();
    if (!src || typeof src !== 'object') return e;
    e.mode = src.mode === 'free' ? 'free' : 'guided';
    ['day', 'night'].forEach(function (sec) {
      PROMPTS[sec].forEach(function (p) {
        var arr = src[sec] && Array.isArray(src[sec][p.key]) ? src[sec][p.key] : [];
        for (var i = 0; i < p.lines; i++) e[sec][p.key][i] = typeof arr[i] === 'string' ? arr[i] : '';
      });
    });
    if (src.free && Array.isArray(src.free.blocks)) e.free.blocks = src.free.blocks.map(normalizeBlock).filter(Boolean);
    return e;
  }
  function blockHasContent(b) {
    if (!b) return false;
    if (b.type === 'text') return String(b.text || '').trim() !== '';
    return !!b.file;
  }
  function isEntryEmpty(e) {
    if (!e || e.mode !== 'guided') return false;
    var any = false;
    ['day', 'night'].forEach(function (sec) {
      PROMPTS[sec].forEach(function (p) {
        e[sec][p.key].forEach(function (t) { if (String(t).trim() !== '') any = true; });
      });
    });
    if (any) return false;
    return !e.free.blocks.some(blockHasContent);
  }
  function getEntry(data, date) { return data.journal[date]; }
  function ensureEntry(data, date) {
    if (!data.journal[date]) data.journal[date] = emptyEntry();
    return data.journal[date];
  }
  function pruneEmptyEntries(data) {
    var removed = 0;
    Object.keys(data.journal).forEach(function (k) {
      if (isEntryEmpty(data.journal[k])) { delete data.journal[k]; removed++; }
    });
    return removed;
  }

  /* ---------- blocks (used by the Atlas page and the free journal page) ---------- */
  function normalizeBlock(b) {
    if (!b || typeof b !== 'object') return null;
    if (b.type !== 'text' && b.type !== 'image' && b.type !== 'audio') return null;
    var out = {
      id: typeof b.id === 'string' && b.id ? b.id : newId(),
      type: b.type,
      x: isFinite(b.x) ? +b.x : 0,
      y: isFinite(b.y) ? +b.y : 0,
      w: isFinite(b.w) && b.w > 40 ? +b.w : (b.type === 'audio' ? 300 : 320)
    };
    if (b.type === 'text') out.text = typeof b.text === 'string' ? b.text : '';
    else {
      if (typeof b.file !== 'string' || !b.file) return null;
      out.file = b.file;
      if (b.type === 'audio') {
        out.dur = isFinite(b.dur) ? +b.dur : 0;
        out.at = isFinite(b.at) ? +b.at : 0;
      }
    }
    return out;
  }
  function collectMedia(blocks) {
    return (blocks || []).filter(function (b) { return b && b.file; }).map(function (b) { return b.file; });
  }

  /* ---------- papers and threads ---------- */
  function makePaper(o) {
    o = o || {};
    return {
      id: newId(),
      title: o.title || 'Untitled',
      summary: o.summary || '',
      x: isFinite(o.x) ? +o.x : 0,
      y: isFinite(o.y) ? +o.y : 0,
      rot: typeof o.rot === 'number' ? o.rot : Math.round((Math.random() * 6 - 3) * 10) / 10,
      pin: o.pin || PIN_COLORS[0],
      tint: o.tint || TINTS[0],
      journalDate: o.journalDate || null,
      board: typeof o.board === 'string' ? o.board : '',
      z: isFinite(o.z) ? +o.z : 1,
      // mode 'sheet' = a ruled notebook sheet (default); 'free' = the free page with text boxes, images, voice
      atlas: { mode: 'sheet', sheet: { text: '' }, blocks: [] },
      created: Date.now()
    };
  }
  function normalizePaper(p, i) {
    if (!p || typeof p !== 'object') return null;
    var out = makePaper({
      title: typeof p.title === 'string' ? p.title : 'Untitled',
      summary: typeof p.summary === 'string' ? p.summary : '',
      x: p.x, y: p.y,
      rot: isFinite(p.rot) ? +p.rot : 0,
      pin: typeof p.pin === 'string' ? p.pin : undefined,
      tint: typeof p.tint === 'string' ? p.tint : undefined,
      journalDate: parseDateStr(p.journalDate) ? p.journalDate : null,
      board: typeof p.board === 'string' ? p.board : '',
      z: isFinite(p.z) ? +p.z : i + 1
    });
    if (typeof p.id === 'string' && p.id) out.id = p.id;
    if (isFinite(p.created)) out.created = +p.created;
    if (p.atlas && typeof p.atlas === 'object') {
      if (Array.isArray(p.atlas.blocks)) out.atlas.blocks = p.atlas.blocks.map(normalizeBlock).filter(Boolean);
      if (p.atlas.sheet && typeof p.atlas.sheet.text === 'string') out.atlas.sheet.text = p.atlas.sheet.text;
      if (p.atlas.mode === 'sheet' || p.atlas.mode === 'free') out.atlas.mode = p.atlas.mode;
      // atlases made before the notebook sheet existed keep looking like they did (a free page)
      else if (out.atlas.blocks.length) out.atlas.mode = 'free';
    }
    return out;
  }

  // Where the pin sits in board coordinates, taking the paper's tilt into account.
  function pinAnchor(p) {
    var cx = p.x + PAPER_W / 2;
    var cy = p.y + PAPER_H / 2;
    var dx = 0;
    var dy = PIN_OFFSET_Y - PAPER_H / 2;
    var a = (p.rot || 0) * Math.PI / 180;
    return {
      x: cx + dx * Math.cos(a) - dy * Math.sin(a),
      y: cy + dx * Math.sin(a) + dy * Math.cos(a)
    };
  }

  // A thread sags a little under gravity: quadratic curve with the control point pulled down.
  function stringPath(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var sag = Math.min(70, dist * 0.16);
    var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 + sag;
    function r(n) { return Math.round(n * 10) / 10; }
    return {
      d: 'M ' + r(a.x) + ' ' + r(a.y) + ' Q ' + r(cx) + ' ' + r(cy) + ' ' + r(b.x) + ' ' + r(b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag / 2 }
    };
  }

  function sameLink(s, a, b) { return (s.a === a && s.b === b) || (s.a === b && s.b === a); }


  /* ---------- atlas list helpers ---------- */
  function hasAtlasContent(atlas) {
    if (!atlas) return false;
    if (atlas.sheet && String(atlas.sheet.text || '').trim() !== '') return true;
    return !!(atlas.blocks && atlas.blocks.some(blockHasContent));
  }
  function firstLine(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    return lines[0] || '';
  }
  // First line of text of an atlas. In notebook mode that is the sheet; on a free page it is the
  // top-most (then left-most) text box with any words. If the current mode has no words, the other one is tried.
  function atlasPreview(atlas) {
    if (!atlas) return '';
    var fromSheet = firstLine(atlas.sheet && atlas.sheet.text);
    var texts = (atlas.blocks || []).filter(function (b) {
      return b.type === 'text' && String(b.text || '').trim() !== '';
    }).sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
    var fromBlocks = texts.length ? firstLine(texts[0].text) : '';
    return atlas.mode === 'free' ? (fromBlocks || fromSheet) : (fromSheet || fromBlocks);
  }
  // Take a paper off the board. Its Atlas is kept (in data.archive) if it holds anything.
  function removePaper(data, id) {
    var i = -1;
    for (var k = 0; k < data.papers.length; k++) if (data.papers[k].id === id) { i = k; break; }
    if (i < 0) return null;
    var p = data.papers.splice(i, 1)[0];
    data.strings = data.strings.filter(function (s) { return s.a !== id && s.b !== id; });
    if (hasAtlasContent(p.atlas)) {
      p.deleted = Date.now();
      data.archive.unshift(p);
      return { archived: true, media: [] };
    }
    return { archived: false, media: collectMedia(p.atlas.blocks) };
  }
  function findArchived(data, id) {
    for (var k = 0; k < data.archive.length; k++) if (data.archive[k].id === id) return data.archive[k];
    return null;
  }
  function restoreArchived(data, id, x, y, z, boardId) {
    var a = findArchived(data, id);
    if (!a) return null;
    data.archive.splice(data.archive.indexOf(a), 1);
    delete a.deleted;
    a.x = x; a.y = y; a.z = z;
    if (boardId && data.boards.some(function (b) { return b.id === boardId; })) a.board = boardId;
    else if (!data.boards.some(function (b) { return b.id === a.board; })) a.board = data.boards[0].id;
    data.papers.push(a);
    return a;
  }
  // Remove an archived atlas for good; returns its media files so the caller can delete them.
  function deleteArchived(data, id) {
    var a = findArchived(data, id);
    if (!a) return [];
    data.archive.splice(data.archive.indexOf(a), 1);
    return collectMedia(a.atlas.blocks);
  }


  /* ---------- boards (the optional "layered boards" mode) ---------- */
  var MAX_BOARDS = 3; // free version limit
  function makeBoard(name, view) {
    return { id: newId(), name: String(name || 'Board').trim().slice(0, 24) || 'Board',
      view: view || { x: 0, y: 0, zoom: 1 } };
  }
  // The board you are looking at. With layered boards off, it is always the first board.
  function currentBoard(data) {
    if (data.settings.layered) {
      for (var i = 0; i < data.boards.length; i++) if (data.boards[i].id === data.settings.activeBoard) return data.boards[i];
    }
    return data.boards[0];
  }
  function setActiveBoard(data, id) {
    for (var i = 0; i < data.boards.length; i++) if (data.boards[i].id === id) { data.settings.activeBoard = id; return true; }
    return false;
  }
  function boardPapers(data, boardId) {
    return data.papers.filter(function (p) { return p.board === boardId; });
  }
  function boardNameTaken(data, name, exceptId) {
    var n = String(name || '').trim().toLowerCase();
    return data.boards.some(function (b) { return b.id !== exceptId && b.name.toLowerCase() === n; });
  }
  // Returns the new board, or null when the name is empty/taken or the limit is reached.
  function addBoard(data, name) {
    var n = String(name || '').trim();
    if (!n || data.boards.length >= MAX_BOARDS || boardNameTaken(data, n)) return null;
    var b = makeBoard(n);
    data.boards.push(b);
    return b;
  }
  function renameBoard(data, id, name) {
    var n = String(name || '').trim().slice(0, 24);
    var b = data.boards.filter(function (x) { return x.id === id; })[0];
    if (!b || !n || boardNameTaken(data, n, id)) return false;
    b.name = n;
    return true;
  }
  // Deletes a board. Its papers are taken off like any removed paper (atlases with content are kept).
  // Returns { media: [files to delete] } or null if it is the last board.
  function deleteBoard(data, id) {
    if (data.boards.length <= 1) return null;
    var idx = -1;
    data.boards.forEach(function (b, i) { if (b.id === id) idx = i; });
    if (idx < 0) return null;
    var media = [];
    boardPapers(data, id).forEach(function (p) {
      var r = removePaper(data, p.id);
      if (r) media = media.concat(r.media);
    });
    data.archive.forEach(function (a) { if (a.board === id) a.board = data.boards[idx === 0 ? 1 : 0].id; });
    data.boards.splice(idx, 1);
    if (data.settings.activeBoard === id) data.settings.activeBoard = data.boards[Math.max(0, idx - 1)].id;
    return { media: media };
  }
  // Move a paper to another board. Threads only join papers on the same board, so its threads are cut.
  function movePaper(data, paperId, boardId) {
    var p = data.papers.filter(function (x) { return x.id === paperId; })[0];
    var ok = data.boards.some(function (b) { return b.id === boardId; });
    if (!p || !ok || p.board === boardId) return false;
    p.board = boardId;
    data.strings = data.strings.filter(function (s) { return s.a !== paperId && s.b !== paperId; });
    p.z = data.papers.reduce(function (m, q) { return Math.max(m, q.z || 0); }, 0) + 1;
    return true;
  }

  /* ---------- whole document ---------- */
  function defaultData(seed) {
    var d = {
      version: 1,
      papers: [],
      archive: [],
      strings: [],
      view: { x: 0, y: 0, zoom: 1 }, // the view of the first board (same object as boards[0].view)
      boards: [],
      journal: {},
      settings: { lastPin: PIN_COLORS[0], stringColor: STRING_COLORS[0], font: DEFAULT_FONT,
        layered: false, activeBoard: '', tutorialSeen: false, glide: true }
    };
    var b0 = makeBoard('Home', d.view);
    d.boards.push(b0);
    d.settings.activeBoard = b0.id;
    if (seed) {
      var p1 = makePaper({ title: 'Welcome', summary: 'Click me to open my Atlas. Drag me around the board.', x: 230, y: 130, rot: -2.2, pin: PIN_COLORS[0], z: 1, board: b0.id });
      p1.atlas.sheet.text = 'This is the Atlas of a paper.\nWrite its details here, like on a page of a notebook.\n\nNeed images or voice notes? Switch to "Free page" at the top:\nthere you can put text, pictures and recordings anywhere.';
      var p2 = makePaper({ title: 'Tie things together', summary: 'Press Thread in the toolbar, then click two papers.', x: 560, y: 230, rot: 2.6, pin: PIN_COLORS[2], tint: TINTS[1], z: 2, board: b0.id });
      d.papers.push(p1, p2);
      d.strings.push({ id: newId(), a: p1.id, b: p2.id, color: STRING_COLORS[0] });
    }
    return d;
  }

  function migrate(src) {
    var d = defaultData(false);
    if (!src || typeof src !== 'object') return d;
    if (Array.isArray(src.papers)) d.papers = src.papers.map(normalizePaper).filter(Boolean);
    var ids = {};
    d.papers.forEach(function (p) { ids[p.id] = true; });
    if (Array.isArray(src.archive)) {
      var seen = {};
      src.archive.forEach(function (a, i) {
        var n = normalizePaper(a, i);
        if (!n || ids[n.id] || seen[n.id]) return;
        n.deleted = isFinite(a && a.deleted) ? +a.deleted : 0;
        if (!hasAtlasContent(n.atlas)) return;
        seen[n.id] = true;
        d.archive.push(n);
      });
    }
    if (Array.isArray(src.strings)) {
      d.strings = src.strings.filter(function (s) {
        return s && ids[s.a] && ids[s.b] && s.a !== s.b;
      }).map(function (s) {
        return { id: typeof s.id === 'string' && s.id ? s.id : newId(), a: s.a, b: s.b, color: typeof s.color === 'string' ? s.color : STRING_COLORS[0] };
      });
    }
    if (src.view && typeof src.view === 'object') {
      d.view.x = isFinite(src.view.x) ? +src.view.x : 0;
      d.view.y = isFinite(src.view.y) ? +src.view.y : 0;
      d.view.zoom = isFinite(src.view.zoom) && src.view.zoom > 0.1 && src.view.zoom < 5 ? +src.view.zoom : 1;
    }
    // boards: the first board always uses data.view; at most MAX_BOARDS
    if (Array.isArray(src.boards)) {
      var bseen = {};
      var list = [];
      src.boards.forEach(function (b) {
        if (!b || typeof b !== 'object' || list.length >= MAX_BOARDS) return;
        var id = typeof b.id === 'string' && b.id && !bseen[b.id] ? b.id : newId();
        bseen[id] = true;
        var nm = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 24) : 'Board ' + (list.length + 1);
        var v = { x: 0, y: 0, zoom: 1 };
        if (b.view && typeof b.view === 'object') {
          v.x = isFinite(b.view.x) ? +b.view.x : 0;
          v.y = isFinite(b.view.y) ? +b.view.y : 0;
          v.zoom = isFinite(b.view.zoom) && b.view.zoom > 0.1 && b.view.zoom < 5 ? +b.view.zoom : 1;
        }
        list.push({ id: id, name: nm, view: v });
      });
      if (list.length) {
        list[0].view = d.view;     // the first board shares data.view
        d.boards = list;
      }
    }
    d.boards[0].view = d.view;
    var okIds = {};
    d.boards.forEach(function (b) { okIds[b.id] = true; });
    d.papers.concat(d.archive).forEach(function (p) { if (!okIds[p.board]) p.board = d.boards[0].id; });
    if (src.journal && typeof src.journal === 'object') {
      Object.keys(src.journal).forEach(function (k) {
        if (parseDateStr(k)) d.journal[k] = normalizeEntry(src.journal[k]);
      });
    }
    if (src.settings && typeof src.settings === 'object') {
      if (typeof src.settings.lastPin === 'string') d.settings.lastPin = src.settings.lastPin;
      if (typeof src.settings.stringColor === 'string') d.settings.stringColor = src.settings.stringColor;
      if (FONTS.some(function (f) { return f.key === src.settings.font; })) d.settings.font = src.settings.font;
      d.settings.layered = src.settings.layered === true;
      d.settings.tutorialSeen = src.settings.tutorialSeen === true;
      d.settings.glide = src.settings.glide !== false;
      if (typeof src.settings.activeBoard === 'string') d.settings.activeBoard = src.settings.activeBoard;
    }
    if (!d.boards.some(function (b) { return b.id === d.settings.activeBoard; })) d.settings.activeBoard = d.boards[0].id;
    return d;
  }

  function parse(raw) {
    if (raw === null || raw === undefined || raw === '') return { data: defaultData(true), isNew: true, error: false };
    try {
      return { data: migrate(JSON.parse(raw)), isNew: false, error: false };
    } catch (e) {
      return { data: defaultData(false), isNew: false, error: true };
    }
  }

  return {
    PAPER_W: PAPER_W, PAPER_H: PAPER_H, PIN_OFFSET_Y: PIN_OFFSET_Y,
    PIN_COLORS: PIN_COLORS, STRING_COLORS: STRING_COLORS, TINTS: TINTS, PROMPTS: PROMPTS,
    FONTS: FONTS, DEFAULT_FONT: DEFAULT_FONT, fontById: fontById,
    newId: newId, localDateStr: localDateStr, parseDateStr: parseDateStr, shiftDate: shiftDate,
    emptyEntry: emptyEntry, normalizeEntry: normalizeEntry, isEntryEmpty: isEntryEmpty,
    getEntry: getEntry, ensureEntry: ensureEntry, pruneEmptyEntries: pruneEmptyEntries,
    normalizeBlock: normalizeBlock, blockHasContent: blockHasContent, collectMedia: collectMedia,
    hasAtlasContent: hasAtlasContent, atlasPreview: atlasPreview, removePaper: removePaper,
    findArchived: findArchived, restoreArchived: restoreArchived, deleteArchived: deleteArchived,
    MAX_BOARDS: MAX_BOARDS, makeBoard: makeBoard, currentBoard: currentBoard, setActiveBoard: setActiveBoard,
    boardPapers: boardPapers, addBoard: addBoard, renameBoard: renameBoard, deleteBoard: deleteBoard,
    movePaper: movePaper, boardNameTaken: boardNameTaken,
    makePaper: makePaper, pinAnchor: pinAnchor, stringPath: stringPath, sameLink: sameLink,
    defaultData: defaultData, migrate: migrate, parse: parse
  };
});
