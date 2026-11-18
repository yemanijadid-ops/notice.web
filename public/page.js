/* A free page: text boxes, images and voice notes that can be placed anywhere.
 * Used by every paper's Atlas and by the Journal's "Free page" mode. */
(function () {
  'use strict';
  const NB = window.NB;
  const { h, clamp } = NB;
  const S = NB.Store;

  const IMAGE_EXT = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/bmp': 'bmp', 'image/avif': 'avif', 'image/svg+xml': 'svg'
  };

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  // MediaRecorder files have no length header, so the player would show an endless track.
  function fixDuration(a) {
    const onMeta = () => {
      if (a.duration === Infinity || isNaN(a.duration)) {
        a.removeEventListener('loadedmetadata', onMeta);
        a.currentTime = 1e101;
        const onTime = () => { a.removeEventListener('timeupdate', onTime); a.currentTime = 0; };
        a.addEventListener('timeupdate', onTime);
      }
    };
    a.addEventListener('loadedmetadata', onMeta);
  }

  NB.mountPage = function (container, opts) {
    const blocks = opts.blocks; // live array, edited in place
    const onChange = opts.onChange || function () {};
    const mediaUrl = (f) => window.nbApi.mediaUrl(f);
    const els = new Map();
    let cascade = 0;
    let rec = null;
    let destroyed = false;

    /* ---------- layout ---------- */
    const btnText = h('button', { type: 'button', class: 'btn small', onclick: () => addText(true) }, NB.icon('text'), 'Text');
    const btnImage = h('button', { type: 'button', class: 'btn small', onclick: () => fileInput.click() }, NB.icon('image'), 'Image');
    const btnVoice = h('button', { type: 'button', class: 'btn small', onclick: toggleRec }, NB.icon('mic'), 'Voice');
    const recTime = h('span', { class: 'rec-time' });
    const fileInput = h('input', {
      type: 'file', accept: 'image/*', multiple: true, class: 'hidden',
      onchange: async () => {
        const files = Array.from(fileInput.files);
        fileInput.value = '';
        for (const f of files) await addImageFile(f);
      }
    });
    const hint = h('span', { class: 'page-hint', text: 'Drop or paste images anywhere on the page' });
    const toolbar = h('div', { class: 'page-toolbar' }, btnText, btnImage, btnVoice, recTime, h('span', { class: 'spacer' }), hint, fileInput);
    const canvas = h('div', { class: 'page-canvas' });
    const scroller = h('div', { class: 'page-scroll' }, canvas);
    const root = h('div', { class: 'page-editor ' + (opts.className || '') }, toolbar, scroller);
    container.append(root);

    /* ---------- sizing ---------- */
    function fit() {
      let maxX = 0, maxY = 0;
      for (const b of blocks) {
        const el = els.get(b.id);
        if (!el) continue;
        maxX = Math.max(maxX, b.x + el.offsetWidth);
        maxY = Math.max(maxY, b.y + el.offsetHeight);
      }
      canvas.style.width = (maxX + 240) + 'px';
      canvas.style.height = (maxY + 320) + 'px';
    }

    function nextSpot() {
      const n = cascade++ % 8;
      return { x: scroller.scrollLeft + 36 + n * 28, y: scroller.scrollTop + 36 + n * 28 };
    }

    /* ---------- blocks ---------- */
    function renderBlock(b) {
      const el = h('div', { class: 'block block-' + b.type, 'data-id': b.id });
      el.style.left = b.x + 'px';
      el.style.top = b.y + 'px';
      el.style.width = b.w + 'px';

      const grip = h('div', { class: 'block-grip' },
        NB.icon('grip'),
        h('button', { type: 'button', class: 'block-x', title: 'Delete', onclick: () => removeBlock(b) }, NB.icon('x')));
      grip.addEventListener('pointerdown', (e) => startDrag(e, b, el, grip));
      el.append(grip);

      if (b.type === 'text') {
        const ta = h('textarea', {
          class: 'block-text', dir: 'auto', spellcheck: 'false',
          placeholder: opts.placeholder || 'Write anything...'
        });
        ta.value = b.text || '';
        ta.addEventListener('input', () => { b.text = ta.value; NB.autoGrow(ta); fit(); onChange(); });
        el.append(ta);
      } else if (b.type === 'image') {
        const src = mediaUrl(b.file);
        const img = h('img', { class: 'block-img', src, draggable: 'false', alt: '' });
        img.addEventListener('click', () => NB.lightbox(src));
        img.addEventListener('load', fit);
        el.append(img);
      } else if (b.type === 'audio') {
        const audio = h('audio', { controls: true, preload: 'metadata', src: mediaUrl(b.file) });
        fixDuration(audio);
        const when = b.at ? new Date(b.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        el.append(h('div', { class: 'voice-label' }, NB.icon('mic'),
          h('span', { text: 'Voice note' + (b.dur ? ' · ' + fmtTime(b.dur) : '') }),
          when ? h('span', { class: 'voice-when', text: when }) : null), audio);
      }

      const grab = h('div', { class: 'block-resize', title: 'Resize' });
      grab.addEventListener('pointerdown', (e) => startResize(e, b, el, grab));
      el.append(grab);

      els.set(b.id, el);
      canvas.append(el);
      if (b.type === 'text') requestAnimationFrame(() => NB.autoGrow(el.querySelector('textarea')));
      return el;
    }

    function startDrag(e, b, el, grip) {
      if (e.button !== 0 || e.target.closest('.block-x')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = b.x, oy = b.y;
      grip.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const move = (ev) => {
        b.x = Math.max(0, ox + ev.clientX - sx);
        b.y = Math.max(0, oy + ev.clientY - sy);
        el.style.left = b.x + 'px';
        el.style.top = b.y + 'px';
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        // bring to front
        const i = blocks.indexOf(b);
        if (i >= 0 && i !== blocks.length - 1) { blocks.splice(i, 1); blocks.push(b); canvas.append(el); }
        fit();
        onChange();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    }

    function startResize(e, b, el, grab) {
      if (e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX, ow = b.w;
      const minW = b.type === 'audio' ? 240 : b.type === 'image' ? 80 : 160;
      grab.setPointerCapture(e.pointerId);
      const move = (ev) => {
        b.w = clamp(ow + ev.clientX - sx, minW, 1600);
        el.style.width = b.w + 'px';
        if (b.type === 'text') NB.autoGrow(el.querySelector('textarea'));
      };
      const up = () => {
        grab.removeEventListener('pointermove', move);
        grab.removeEventListener('pointerup', up);
        grab.removeEventListener('pointercancel', up);
        fit();
        onChange();
      };
      grab.addEventListener('pointermove', move);
      grab.addEventListener('pointerup', up);
      grab.addEventListener('pointercancel', up);
    }

    async function removeBlock(b) {
      const needsConfirm = b.type !== 'text' || String(b.text || '').trim() !== '';
      if (needsConfirm) {
        const what = b.type === 'text' ? 'this text' : b.type === 'image' ? 'this image' : 'this voice note';
        if (!(await NB.confirm('Delete ' + what + '?', 'Delete'))) return;
      }
      const i = blocks.indexOf(b);
      if (i < 0) return;
      blocks.splice(i, 1);
      const el = els.get(b.id);
      if (el) el.remove();
      els.delete(b.id);
      if (b.file) window.nbApi.deleteMedia(b.file);
      fit();
      onChange();
    }

    function pushBlock(b) {
      blocks.push(b);
      const el = renderBlock(b);
      fit();
      onChange();
      return el;
    }

    function addText(focus) {
      const p = nextSpot();
      const w = Math.max(240, Math.min(560, scroller.clientWidth - 120));
      const el = pushBlock({ id: S.newId(), type: 'text', x: p.x, y: p.y, w, text: '' });
      if (focus) el.querySelector('textarea').focus();
    }

    async function addImageFile(file, at) {
      const ext = file && IMAGE_EXT[file.type];
      if (!ext) { NB.toast('That file type is not a supported image.'); return; }
      try {
        const name = await window.nbApi.saveMedia(ext, new Uint8Array(await file.arrayBuffer()));
        if (destroyed) return;
        const dims = await new Promise((res) => {
          const im = new Image();
          im.onload = () => res({ w: im.naturalWidth });
          im.onerror = () => res({ w: 320 });
          im.src = mediaUrl(name);
        });
        if (destroyed) return;
        const p = at || nextSpot();
        pushBlock({ id: S.newId(), type: 'image', x: Math.max(0, p.x), y: Math.max(0, p.y), w: Math.min(360, dims.w || 360), file: name });
      } catch (err) {
        NB.toast((err && err.userMessage) || 'Could not add the image.');
      }
    }

    /* ---------- voice recording ---------- */
    function setRecUi(on) {
      btnVoice.classList.toggle('recording', on);
      btnVoice.replaceChildren(NB.icon(on ? 'stop' : 'mic'), on ? 'Stop' : 'Voice');
      if (!on) recTime.textContent = '';
    }

    async function toggleRec() {
      if (rec) { if (rec.mr.state !== 'inactive') rec.mr.stop(); return; }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        NB.toast('Microphone is not available, or permission was denied.');
        return;
      }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
        .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
      const r = { mr, stream, chunks: [], t0: Date.now(), discard: false, timer: null };
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) r.chunks.push(ev.data); };
      mr.onstop = async () => {
        clearInterval(r.timer);
        r.stream.getTracks().forEach((t) => t.stop());
        rec = null;
        if (!destroyed) setRecUi(false);
        if (r.discard || !r.chunks.length || destroyed) return;
        const dur = Math.round((Date.now() - r.t0) / 1000);
        try {
          const type = mr.mimeType || 'audio/webm';
          const buf = new Uint8Array(await new Blob(r.chunks, { type }).arrayBuffer());
          const name = await window.nbApi.saveMedia(type.includes('ogg') ? 'ogg' : 'webm', buf);
          if (destroyed) return;
          const p = nextSpot();
          pushBlock({ id: S.newId(), type: 'audio', x: p.x, y: p.y, w: 300, file: name, dur, at: Date.now() });
        } catch (err) {
          NB.toast((err && err.userMessage) || 'Could not save the recording.');
        }
      };
      rec = r;
      mr.start(250);
      setRecUi(true);
      recTime.textContent = '0:00';
      r.timer = setInterval(() => {
        recTime.textContent = fmtTime((Date.now() - r.t0) / 1000);
        if (Date.now() - r.t0 > 10 * 60 * 1000 && r.mr.state !== 'inactive') r.mr.stop(); // keep voice notes small
      }, 500);
    }

    /* ---------- drag & drop, paste ---------- */
    scroller.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    });
    scroller.addEventListener('drop', async (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      let i = 0;
      for (const f of files) {
        await addImageFile(f, { x: e.clientX - r.left + i * 24, y: e.clientY - r.top + i * 24 });
        i++;
      }
    });
    function onPaste(e) {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      files.forEach((f) => addImageFile(f));
    }
    document.addEventListener('paste', onPaste);

    /* ---------- start ---------- */
    blocks.forEach(renderBlock);
    if (opts.autoText && !blocks.length) addText(true);
    requestAnimationFrame(fit);

    return {
      destroy() {
        destroyed = true;
        if (rec) { rec.discard = true; if (rec.mr.state !== 'inactive') rec.mr.stop(); }
        document.removeEventListener('paste', onPaste);
        // tidy up text boxes that were opened but never written in
        let changed = false;
        for (let i = blocks.length - 1; i >= 0; i--) {
          if (blocks[i].type === 'text' && String(blocks[i].text || '').trim() === '') { blocks.splice(i, 1); changed = true; }
        }
        if (changed) onChange();
        root.remove();
      }
    };
  };
})();
