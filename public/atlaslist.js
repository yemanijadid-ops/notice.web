/* The Atlas list: every Atlas, with its name and the first line of its text.
 * Atlases of papers that were taken off the board stay here, crossed out, and can still be opened. */
(function () {
  'use strict';
  const NB = window.NB;
  const { h } = NB;
  const S = NB.Store;

  function preview(atlas) {
    const line = S.atlasPreview(atlas);
    if (line) return { text: line, muted: false };
    const blocks = (atlas && atlas.blocks) || [];
    if (blocks.some((b) => b.type === 'image' || b.type === 'audio')) return { text: 'Images and voice notes only', muted: true };
    return { text: 'Nothing written yet', muted: true };
  }

  function mountAtlasList(container) {
    const data = NB.state.data;
    const root = h('div', { class: 'atlaslist-view' });
    container.append(root);

    function row(item, gone) {
      const pv = preview(item.atlas);
      const kids = [
        h('span', { class: 'row-pin' + (gone ? ' gone' : ''), style: { '--pin': item.pin } }),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title', dir: 'auto', text: item.title }),
          h('span', { class: 'row-line' + (pv.muted ? ' muted' : ''), dir: 'auto', text: pv.text }))
      ];
      if (gone) {
        kids.push(h('span', { class: 'row-meta', text: 'Removed ' + NB.shortDate(S.localDateStr(new Date(item.deleted || Date.now()))) }));
      }
      const open = h('button', {
        type: 'button', class: 'atlas-row' + (gone ? ' gone' : ''),
        onclick: () => NB.go('atlas', { id: item.id, from: 'atlaslist' })
      }, kids);

      if (!gone) return open;
      const del = h('button', {
        type: 'button', class: 'icon-btn row-del', title: 'Delete this Atlas for good',
        onclick: async () => {
          if (!(await NB.confirm('Delete the Atlas of "' + item.title + '" for good? Its text, images and voice notes will be lost.', 'Delete'))) return;
          S.deleteArchived(data, item.id).forEach((f) => window.nbApi.deleteMedia(f));
          NB.save();
          render();
        }
      }, NB.icon('trash'));
      return h('div', { class: 'atlas-row-wrap' }, open, del);
    }

    function section(title, items, gone) {
      return h('section', { class: 'atlas-section' },
        h('h3', { class: 'section-title', text: title }),
        h('div', { class: 'atlas-rows' }, items.map((i) => row(i, gone))));
    }

    function render() {
      root.replaceChildren();
      const active = data.papers;
      const gone = data.archive;
      const total = active.length + gone.length;
      root.append(h('div', { class: 'atlaslist-head' },
        h('h2', { class: 'atlaslist-title', text: 'Atlas' }),
        h('span', { class: 'atlaslist-count', text: total + (total === 1 ? ' page' : ' pages') })));
      if (!total) {
        root.append(h('div', { class: 'board-empty static', text: 'No Atlas yet. Every paper you pin on the board gets one.' }));
        return;
      }
      if (active.length) root.append(section('On the board', active, false));
      if (gone.length) root.append(section('Taken off the board', gone, true));
    }

    render();
    return { destroy() {} };
  }

  NB.atlaslist = { mount: mountAtlasList };
})();
