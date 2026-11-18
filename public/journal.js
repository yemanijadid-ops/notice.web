/* The Journal: one spread per day (Day page + Night page), or a completely free page. */
(function () {
  'use strict';
  const NB = window.NB;
  const { h } = NB;
  const S = NB.Store;

  function mountJournal(container) {
    const data = NB.state.data;
    let date = S.parseDateStr(NB.state.journalDate) ? NB.state.journalDate : S.localDateStr();
    NB.state.journalDate = date;
    let page = null;

    const root = h('div', { class: 'journal-view' });
    container.append(root);

    function destroyPage() {
      if (page) { page.destroy(); page = null; }
    }

    function goTo(next) {
      if (!S.parseDateStr(next)) return;
      destroyPage();
      S.pruneEmptyEntries(data);
      NB.save();
      date = next;
      NB.state.journalDate = date;
      render();
    }

    function longDate() {
      const d = S.parseDateStr(date);
      const text = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      return date === S.localDateStr() ? text + '  ·  Today' : text;
    }

    function render() {
      destroyPage();
      root.replaceChildren();
      const entry = S.getEntry(data, date);
      const mode = entry ? entry.mode : 'guided';

      const dateInput = h('input', { type: 'date', class: 'date-input', value: date, onchange: (e) => goTo(e.target.value) });
      const setMode = (m) => {
        if (m === mode) return;
        destroyPage();
        S.ensureEntry(data, date).mode = m;
        NB.save();
        render();
      };

      root.append(h('div', { class: 'journal-head' },
        h('button', { type: 'button', class: 'btn small', title: 'Previous day', onclick: () => goTo(S.shiftDate(date, -1)) }, NB.icon('chevL')),
        h('button', { type: 'button', class: 'btn small', title: 'Next day', onclick: () => goTo(S.shiftDate(date, 1)) }, NB.icon('chevR')),
        dateInput,
        h('button', { type: 'button', class: 'btn small', text: 'Today', onclick: () => goTo(S.localDateStr()) }),
        h('h2', { class: 'journal-date', text: longDate() }),
        h('span', { class: 'spacer' }),
        h('div', { class: 'mode-switch', title: 'Page style for this day' },
          h('button', { type: 'button', class: mode === 'guided' ? 'on' : '', text: 'Guided', onclick: () => setMode('guided') }),
          h('button', { type: 'button', class: mode === 'free' ? 'on' : '', text: 'Free page', onclick: () => setMode('free') }))));

      if (mode === 'guided') root.append(buildBook());
      else {
        const host = h('div', { class: 'journal-free' });
        root.append(host);
        const e = S.ensureEntry(data, date);
        page = NB.mountPage(host, {
          blocks: e.free.blocks,
          onChange: NB.save,
          autoText: true,
          className: 'sheet journal-sheet',
          placeholder: 'Write anything...'
        });
      }

      const linked = data.papers.filter((p) => p.journalDate === date);
      if (linked.length) {
        root.append(h('div', { class: 'journal-links' },
          h('span', { class: 'jl-label', text: 'Pinned to this day' }),
          linked.map((p) => h('button', {
            type: 'button', class: 'chip big', style: { '--pin': p.pin },
            onclick: () => NB.go('atlas', { id: p.id })
          }, h('span', { class: 'dot' }), p.title))));
      }
    }

    function buildBook() {
      const book = h('div', { class: 'journal-book' },
        buildPage('day', 'Day', 'sun', 'left'),
        buildPage('night', 'Night', 'moon', 'right'));
      requestAnimationFrame(() => book.querySelectorAll('textarea').forEach(NB.autoGrow));
      book.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.target.tagName !== 'TEXTAREA') return;
        e.preventDefault();
        const all = Array.from(book.querySelectorAll('textarea'));
        const next = all[all.indexOf(e.target) + 1];
        if (next) next.focus();
      });
      return book;
    }

    function buildPage(section, title, icon, side) {
      const entry = S.getEntry(data, date) || S.emptyEntry();
      const pg = h('section', { class: 'journal-page ' + side },
        h('header', { class: 'jp-head' }, NB.icon(icon), h('h3', { text: title })));
      S.PROMPTS[section].forEach((prompt) => {
        const block = h('div', { class: 'prompt' }, h('h4', { class: 'prompt-title', text: prompt.title }));
        for (let i = 0; i < prompt.lines; i++) {
          const ta = h('textarea', { rows: '1', dir: 'auto', spellcheck: 'false', 'aria-label': prompt.title + ' ' + (i + 1) });
          ta.value = entry[section][prompt.key][i] || '';
          ta.addEventListener('input', () => {
            // always write through the live data, never a stale reference
            S.ensureEntry(data, date)[section][prompt.key][i] = ta.value;
            NB.autoGrow(ta);
            NB.save();
          });
          block.append(h('div', { class: 'jp-line' }, h('span', { class: 'num', text: (i + 1) + '-' }), ta));
        }
        pg.append(block);
      });
      return pg;
    }

    render();

    return {
      destroy() {
        destroyPage();
        S.pruneEmptyEntries(data);
        NB.save();
      }
    };
  }

  NB.journal = { mount: mountJournal };
})();
