/* App shell: loading, saving, top bar and navigation. */
(function () {
  'use strict';
  const NB = window.NB;
  const { h } = NB;
  const S = NB.Store;

  /* ---------- saving ---------- */
  let timer = null;
  let dirty = false;
  NB.save = function () {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(NB.flush, 500);
  };
  NB.flush = async function () {
    clearTimeout(timer);
    if (!dirty || NB.state.loadFailed) return;
    dirty = false;
    try {
      await window.nbApi.saveData(JSON.stringify(NB.state.data));
    } catch (e) {
      dirty = true;
      NB.toast('Could not save your changes!');
    }
  };
  window.addEventListener('beforeunload', () => {
    if (dirty && !NB.state.loadFailed) {
      try { window.nbApi.saveDataSync(JSON.stringify(NB.state.data)); dirty = false; } catch (e) { /* nothing more we can do */ }
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) NB.flush(); });
  window.addEventListener('blur', () => NB.flush());

  // dropping a file outside an editor must never navigate the window away
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  /* ---------- navigation ---------- */
  let current = null;
  let main = null;
  let tabBoard = null;
  let tabJournal = null;
  let tabAtlas = null;
  let atlasSlot = null;
  let expander = null;
  let inAtlas = false;

  // The Atlas tab lives behind the little arrow next to "Board". It slides out when the arrow is
  // clicked (pushing Board and Journal to the right) and stays out while you are on an Atlas page.
  function updateTabs() {
    const open = !!NB.state.atlasOpen || inAtlas;
    atlasSlot.classList.toggle('open', open);
    expander.classList.toggle('open', open);
    expander.setAttribute('aria-expanded', open ? 'true' : 'false');
    expander.title = open ? 'Hide Atlas' : 'Show Atlas';
    tabAtlas.tabIndex = open ? 0 : -1;
    tabAtlas.classList.toggle('active', inAtlas);
    tabBoard.classList.toggle('active', !inAtlas && NB.state.view !== 'journal');
    tabJournal.classList.toggle('active', NB.state.view === 'journal');
  }

  NB.go = function (view, params) {
    params = params || {};
    if (current && current.destroy) current.destroy();
    current = null;
    main.replaceChildren();
    NB.state.view = view;
    inAtlas = view === 'atlaslist' || (view === 'atlas' && params.from === 'atlaslist');
    if (inAtlas) NB.state.atlasOpen = true;
    if (view === 'journal') {
      if (params.date) NB.state.journalDate = params.date;
      current = NB.journal.mount(main);
    } else if (view === 'atlas') {
      current = NB.atlas.mount(main, params);
    } else if (view === 'atlaslist') {
      current = NB.atlaslist.mount(main);
    } else {
      current = NB.board.mount(main, params);
    }
    updateTabs();
  };

  function toggleAtlasTab() {
    const open = !!NB.state.atlasOpen || inAtlas;
    NB.state.atlasOpen = !open;
    if (open && inAtlas) NB.go('board'); // closing it while inside the Atlas area goes back to the board
    else updateTabs();
  }

  /* ---------- settings ---------- */
  NB.applyFont = function () {
    const f = S.fontById(NB.state.data.settings.font);
    const root = document.documentElement;
    root.style.setProperty('--font-display', f.css);
    root.style.setProperty('--ds', String(f.scale));
  };

  function openSettings() {
    if (document.querySelector('.settings-modal')) return;
    const settings = NB.state.data.settings;
    const list = h('div', { class: 'font-list', role: 'radiogroup', 'aria-label': 'Title font' });
    const rows = S.FONTS.map((f) => {
      const row = h('button', {
        type: 'button', class: 'font-opt', role: 'radio',
        onclick: () => {
          settings.font = f.key;
          NB.applyFont();
          NB.save();
          paint();
        }
      },
        h('span', { class: 'font-sample', style: { fontFamily: f.css }, text: 'Notice Board' }),
        h('span', { class: 'font-meta' }, h('b', { text: f.label }), h('small', { text: f.note })));
      list.append(row);
      return { f, row };
    });
    function paint() {
      rows.forEach(({ f, row }) => {
        const on = f.key === S.fontById(settings.font).key;
        row.classList.toggle('on', on);
        row.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    paint();

    // Placeholders: they only show that these settings will exist. Nothing here works yet.
    const soon = (label, hint, control) => h('div', { class: 'soon-row', 'aria-disabled': 'true' },
      h('div', { class: 'soon-text' }, h('b', { text: label }), h('small', { text: hint })),
      control,
      h('span', { class: 'soon-tag', text: 'Soon' }));
    const fakeSelect = (value) => h('select', { class: 'soon-select', disabled: true }, h('option', { text: value }));
    const fakeToggle = () => h('span', { class: 'soon-toggle', 'aria-hidden': 'true' }, h('span', { class: 'knob' }));
    const fakeButton = (label) => h('button', { type: 'button', class: 'btn small', disabled: true, text: label });

    // real switches
    const sw = (label, hint, get, set, extra) => {
      const knob = h('button', { type: 'button', class: 'switch', role: 'switch' }, h('span', { class: 'knob' }));
      const paintSw = () => { knob.classList.toggle('on', !!get()); knob.setAttribute('aria-checked', get() ? 'true' : 'false'); };
      knob.addEventListener('click', () => { set(!get()); paintSw(); });
      paintSw();
      return h('div', { class: 'soon-row live' }, h('div', { class: 'soon-text' }, h('b', { text: label }), h('small', { text: hint })), extra || null, knob);
    };
    const layeredRow = sw('Layered boards', 'Several boards, one behind another. Up to ' + S.MAX_BOARDS + ' boards for now.',
      () => settings.layered,
      (on) => {
        settings.layered = on;
        if (on && !settings.tutorialSeen) { settings.tutorialSeen = true; NB.layered.tutorial(); }
        if (!on && NB.state.data.boards.length > 1) NB.toast('Your other boards stay saved. They come back when you turn this on again.');
        NB.save();
        if (NB.state.view === 'board') NB.go('board');
      },
      h('button', { type: 'button', class: 'btn small', text: 'Show tutorial', onclick: () => NB.layered.tutorial() }));
    const glideRow = sw('Glide animation', 'The smooth turn when you switch boards.', () => settings.glide !== false, (on) => { settings.glide = on; NB.save(); });
    const linkedRow = soon('Linked boards', 'Threads that tie papers on different boards', fakeToggle());
    const body = h('div', { class: 'settings-body' },
      h('div', { class: 'field' }, h('span', { text: 'Title font' }), list,
        h('p', { class: 'settings-note', text: 'Used for the app name, paper names, the Atlas title and the journal headings. Some fonts depend on your device (Windows, Mac, phone); if one is missing, a similar font is used.' })),
      h('div', { class: 'field' }, h('span', { text: 'Boards' }),
        h('div', { class: 'soon-list' },
          layeredRow, glideRow, linkedRow)),
      h('div', { class: 'field' }, h('span', { text: 'Coming later' }),
        h('div', { class: 'soon-list' },
          soon('Color theme', 'More looks besides burnt brown', fakeSelect('Burnt brown')),
          soon('Language', 'App language', fakeSelect('English')),
          soon('Opens on', 'Which page shows when the app starts', fakeSelect('Board')),
          soon('Journal reminder', 'A gentle nudge to write each day', fakeToggle()),
          soon('Backup', 'Export and restore everything in one file', fakeButton('Export')))),
      NB.accountSection());
    const api = NB.modal({ title: 'Settings', body, wide: true, buttons: [{ label: 'Done', kind: 'primary' }] });
    api.panel.classList.add('settings-modal');
  }

  /* ---------- boot ---------- */
  async function boot() {
    const app = document.getElementById('app');
    let raw = null;
    let loadFailed = false;
    try {
      raw = await window.nbApi.loadData();
    } catch (e) {
      loadFailed = true;
    }
    const parsed = S.parse(raw);
    NB.state = { data: parsed.data, view: 'board', journalDate: S.localDateStr(), loadFailed, atlasOpen: false };
    S.pruneEmptyEntries(NB.state.data);
    NB.applyFont();

    expander = h('button', {
      type: 'button', class: 'tab-arrow', title: 'Show Atlas', 'aria-expanded': 'false', 'aria-label': 'Show or hide Atlas',
      onclick: toggleAtlasTab
    }, NB.icon('chevR'));
    tabAtlas = h('button', { type: 'button', class: 'tab tab-atlas', tabindex: '-1', onclick: () => NB.go('atlaslist') }, NB.icon('atlas'), 'Atlas');
    atlasSlot = h('span', { class: 'tab-slot' }, tabAtlas);
    tabBoard = h('button', { type: 'button', class: 'tab', onclick: () => NB.go('board') }, NB.icon('pin'), 'Board');
    tabJournal = h('button', { type: 'button', class: 'tab tab-journal', onclick: () => NB.go('journal', { date: NB.state.journalDate }) }, NB.icon('book'), 'Journal');
    const gear = h('button', { type: 'button', class: 'icon-btn gear', title: 'Settings' }, NB.icon('gear'));
    gear.addEventListener('click', openSettings);
    main = h('main', { id: 'main' });

    app.append(
      h('header', { class: 'topbar' },
        h('div', { class: 'brand' }, h('span', { class: 'logo' }), h('span', { class: 'brand-name', text: 'Notice Board' })),
        expander,
        atlasSlot,
        tabBoard,
        tabJournal,
        h('span', { class: 'spacer' }),
        gear),
      main);

    if (loadFailed) NB.toast('Could not load your saved data. Changes will not be saved this time - please restart the app.');
    else if (parsed.error) NB.toast('Your saved data could not be read, so a fresh board was started. The old file was kept as data.bak.json.');
    if (parsed.isNew && !loadFailed) NB.save();

    NB.go('board');
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
