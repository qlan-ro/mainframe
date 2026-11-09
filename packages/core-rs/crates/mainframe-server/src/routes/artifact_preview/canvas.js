// The canvas view of a Claude Design artifact: every board at its place from
// canvas.json, in back-to-front `order`, with its pages, title and sticky notes,
// and the launch view. Scroll or drag pans, pinch or Cmd/Ctrl+scroll zooms.
// Boards sit under a shield so gestures over them move the canvas; double-click a
// board to use it. canvas.json is artifact content, so it only ever reaches the
// page as text, numbers and allowlisted colors.
(function () {
  'use strict';

  const MIN_SCALE = 0.03;
  const MAX_SCALE = 4;
  const FIT_PADDING = 64;
  const TOOLBAR_SPACE = 56;
  const LINE_PX = 16;
  const NOTE_SIZES = { s: 14, m: 18, l: 24, xl: 32, xxl: 48 };
  const NOTE_FILLS = {
    gray: '#ecebe8',
    red: '#fde2e1',
    orange: '#fde7cf',
    green: '#dcf2dd',
    teal: '#d6f1ee',
    blue: '#dceafd',
    purple: '#ebe2fd',
    pink: '#fce1ee',
  };
  const TITLE_PX = 72;
  const GRID_PX = 24;
  const MIN_GRID_SCREEN_PX = 12;

  const STYLE = `
:root{--bg:#f1f0ed;--dot:rgba(0,0,0,.09);--ink:#3d3a36;--muted:#7b766f;--chrome:#fff;--line:rgba(0,0,0,.12);--focus:#3b82f6}
@media (prefers-color-scheme:dark){:root{--bg:#1d1d1c;--dot:rgba(255,255,255,.08);--ink:#e8e6e1;--muted:#a19d96;--chrome:#2a2a28;--line:rgba(255,255,255,.14)}}
html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);font:13px/1.3 system-ui,-apple-system,sans-serif;color:var(--ink)}
#viewport{position:fixed;inset:0;overflow:hidden;cursor:grab;touch-action:none;
  background-image:radial-gradient(var(--dot) 1px,transparent 1px)}
#viewport.panning{cursor:grabbing}
#world{position:absolute;left:0;top:0;transform-origin:0 0}
.frame{position:absolute;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06)}
.frame.frameless{box-shadow:none;background:transparent}
.frame iframe{display:block;width:100%;height:100%;border:0;border-radius:inherit}
.shield{position:absolute;inset:0}
.frame.interacting{outline:calc(2px*var(--inv)) solid var(--focus)}
.frame.interacting .shield,.mf-picking .shield{display:none}
.name{position:absolute;left:0;bottom:100%;display:flex;gap:calc(8px*var(--inv));align-items:center;
  padding-bottom:calc(6px*var(--inv));font-size:calc(12px*var(--inv));color:var(--muted);white-space:nowrap;max-width:100%}
.name span{overflow:hidden;text-overflow:ellipsis}
.name button{font:inherit;color:var(--focus);background:none;border:0;padding:0;cursor:pointer}
.note-title{position:absolute;font-weight:700;line-height:1.1;white-space:nowrap;color:var(--ink)}
.note-sticky{position:absolute;box-sizing:border-box;padding:16px;border-radius:4px;white-space:pre-wrap;overflow:auto;color:#2b2925;box-shadow:0 1px 2px rgba(0,0,0,.12)}
#toolbar{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:2px;align-items:center;
  padding:4px;background:var(--chrome);border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.12);z-index:10}
#toolbar button{font:inherit;color:var(--ink);background:none;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;min-width:28px}
#toolbar button:hover{background:var(--line)}
#pages{position:fixed;left:12px;top:12px;display:flex;gap:6px;align-items:center;padding:4px 4px 4px 10px;z-index:10;
  background:var(--chrome);border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.12);color:var(--muted)}
#pages select{font:inherit;font-weight:600;color:var(--ink);background:none;border:0;border-radius:6px;padding:4px 6px;cursor:pointer;max-width:240px}
#pages select:hover{background:var(--line)}
#hint{position:fixed;left:12px;bottom:14px;font-size:11px;color:var(--muted);z-index:10}
@media (max-width:640px){#hint{display:none}}
`;

  const data = JSON.parse(document.getElementById('mf-canvas-data').textContent);
  const boards = data.boards && typeof data.boards === 'object' ? data.boards : {};
  const listed = Array.isArray(data.order) ? data.order.filter((name) => typeof name === 'string' && boards[name]) : [];
  const order = listed.concat(Object.keys(boards).filter((name) => !listed.includes(name)));
  const pages = Array.isArray(data.pages) ? data.pages.filter((page) => page && typeof page.id === 'string') : [];
  const launch = data.launch && typeof data.launch === 'object' ? data.launch : {};

  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const pageOf = (item) => (typeof item.page === 'string' ? item.page : pages[0] ? pages[0].id : null);
  const projectSrc = (name) => `project/${name.split('/').map(encodeURIComponent).join('/')}`;

  const view = { x: 0, y: 0, scale: 1, page: pageOf({}) };
  let interacting = null;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const viewport = document.createElement('div');
  viewport.id = 'viewport';
  const world = document.createElement('div');
  world.id = 'world';
  viewport.appendChild(world);
  document.body.appendChild(viewport);

  function render() {
    world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    document.documentElement.style.setProperty('--inv', String(1 / view.scale));
    // Coarser dots as the canvas shrinks, so the grid never turns into a hatch.
    let grid = GRID_PX * view.scale;
    while (grid < MIN_GRID_SCREEN_PX) grid *= 4;
    viewport.style.backgroundSize = `${grid}px ${grid}px`;
    viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
    zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
  }

  // Items carry their canvas rect so fitting can measure a page.
  const items = [];

  function stopInteracting() {
    if (!interacting) return;
    interacting.classList.remove('interacting');
    interacting = null;
  }

  function startInteracting(frame) {
    stopInteracting();
    interacting = frame;
    frame.classList.add('interacting');
  }

  function addBoard(name) {
    const board = boards[name];
    const rect = { x: num(board.x, 0), y: num(board.y, 0), w: num(board.w, 1280), h: num(board.h, 860) };
    const frame = document.createElement('div');
    frame.className = board.frameless ? 'frame frameless' : 'frame';
    Object.assign(frame.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.w}px`,
      height: `${rect.h}px`,
      borderRadius: `${Math.max(0, num(board.radius, 0))}px`,
    });

    const label = document.createElement('div');
    label.className = 'name';
    const text = document.createElement('span');
    text.textContent = typeof board.title === 'string' && board.title ? board.title : name.replace(/\.dc\.html$/, '');
    label.appendChild(text);
    if (board.is_interactive) {
      const play = document.createElement('button');
      play.type = 'button';
      play.textContent = 'Use';
      play.title = 'Use this board (Escape to stop)';
      play.addEventListener('click', (event) => {
        event.stopPropagation();
        startInteracting(frame);
      });
      label.appendChild(play);
    }

    const iframe = document.createElement('iframe');
    iframe.src = projectSrc(name);
    iframe.title = text.textContent;
    const shield = document.createElement('div');
    shield.className = 'shield';
    shield.addEventListener('dblclick', () => startInteracting(frame));

    frame.append(label, iframe, shield);
    world.appendChild(frame);
    items.push({ el: frame, page: pageOf(board), rect, name });
  }

  function addNote(note) {
    if (typeof note.text !== 'string') return;
    const x = num(note.x, 0);
    const y = num(note.y, 0);
    const el = document.createElement('div');
    el.textContent = note.text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (note.bold) el.style.fontWeight = '700';
    if (note.italic) el.style.fontStyle = 'italic';
    let rect;
    if (note.kind === 'title1') {
      el.className = 'note-title';
      el.style.fontSize = `${TITLE_PX}px`;
      const maxW = num(note.maxW, 0);
      world.appendChild(el);
      // A title longer than its row shrinks rather than overflowing it.
      if (maxW > 0 && el.scrollWidth > maxW) el.style.fontSize = `${(TITLE_PX * maxW) / el.scrollWidth}px`;
      rect = { x, y, w: Math.max(el.scrollWidth, 1), h: el.scrollHeight };
    } else if (note.kind === undefined) {
      const w = num(note.w, 240);
      el.className = 'note-sticky';
      Object.assign(el.style, {
        width: `${w}px`,
        maxHeight: `${(w * 4) / 3}px`,
        background: NOTE_FILLS[note.fill] || NOTE_FILLS.orange,
        fontSize: `${NOTE_SIZES[note.size] || num(note.size, NOTE_SIZES.m)}px`,
      });
      world.appendChild(el);
      rect = { x, y, w, h: el.offsetHeight };
    } else {
      return; // Shapes and drawings are the canvas editor's own; they have no text to show.
    }
    items.push({ el, page: pageOf(note), rect });
  }

  function onPage(item) {
    return pages.length === 0 || item.page === view.page;
  }

  function fitTo(rects) {
    if (rects.length === 0) return;
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y - 24));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    const width = Math.max(innerWidth - FIT_PADDING * 2, 1);
    const height = Math.max(innerHeight - FIT_PADDING * 2 - TOOLBAR_SPACE, 1);
    const scale = clamp(Math.min(width / (right - left), height / (bottom - top), 1));
    view.scale = scale;
    view.x = (innerWidth - (right - left) * scale) / 2 - left * scale;
    view.y = (innerHeight - TOOLBAR_SPACE - (bottom - top) * scale) / 2 - top * scale;
    render();
  }

  function fitPage() {
    fitTo(items.filter(onPage).map((item) => item.rect));
  }

  function showPage(id) {
    view.page = id;
    stopInteracting();
    for (const item of items) item.el.style.display = onPage(item) ? '' : 'none';
    if (pageSelect) pageSelect.value = id;
    fitPage();
  }

  const clamp = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

  function zoomAt(clientX, clientY, factor) {
    const scale = clamp(view.scale * factor);
    const ratio = scale / view.scale;
    view.x = clientX - (clientX - view.x) * ratio;
    view.y = clientY - (clientY - view.y) * ratio;
    view.scale = scale;
    render();
  }

  const center = () => [innerWidth / 2, (innerHeight - TOOLBAR_SPACE) / 2];

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.id = 'toolbar';
  // Pages get their own picker at the top left, where Claude Design keeps it.
  let pageSelect = null;
  if (pages.length > 1) {
    const picker = document.createElement('label');
    picker.id = 'pages';
    const caption = document.createElement('span');
    caption.textContent = 'Page';
    pageSelect = document.createElement('select');
    for (const page of pages) {
      const option = document.createElement('option');
      option.value = page.id;
      option.textContent = typeof page.name === 'string' && page.name ? page.name : page.id;
      pageSelect.appendChild(option);
    }
    pageSelect.addEventListener('change', () => showPage(pageSelect.value));
    picker.append(caption, pageSelect);
    document.body.appendChild(picker);
  }
  function button(textContent, title, onClick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = textContent;
    el.title = title;
    el.addEventListener('click', onClick);
    toolbar.appendChild(el);
    return el;
  }
  button('−', 'Zoom out (⌘−)', () => zoomAt(...center(), 1 / 1.25));
  const zoomLabel = button('100%', 'Actual size (⌘0)', () => zoomAt(...center(), 1 / view.scale));
  button('+', 'Zoom in (⌘+)', () => zoomAt(...center(), 1.25));
  button('Fit', 'Fit to screen (⇧1)', fitPage);
  document.body.appendChild(toolbar);
  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent = 'Scroll to pan · pinch or ⌘ scroll to zoom · double-click a board to use it';
  document.body.appendChild(hint);

  // Gestures
  viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? innerHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.clientX, event.clientY, Math.exp((-event.deltaY * unit) / 300));
      } else {
        view.x -= event.deltaX * unit;
        view.y -= event.deltaY * unit;
        render();
      }
    },
    { passive: false },
  );

  // Safari reports trackpad pinches as gesture events rather than ctrl+wheel.
  let gestureScale = 1;
  viewport.addEventListener('gesturestart', (event) => {
    event.preventDefault();
    gestureScale = 1;
  });
  viewport.addEventListener('gesturechange', (event) => {
    event.preventDefault();
    zoomAt(event.clientX || center()[0], event.clientY || center()[1], event.scale / gestureScale);
    gestureScale = event.scale;
  });

  // A press only becomes a pan once it moves, so clicks and double-clicks still
  // reach the board under it.
  const DRAG_THRESHOLD = 3;
  let drag = null;
  viewport.addEventListener('pointerdown', (event) => {
    if (interacting && !interacting.contains(event.target)) stopInteracting();
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest && event.target.closest('.interacting, .name button')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panning: false };
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.panning) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.panning = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('panning');
    }
    view.x += dx;
    view.y += dy;
    drag.x = event.clientX;
    drag.y = event.clientY;
    render();
  });
  const endDrag = () => {
    drag = null;
    viewport.classList.remove('panning');
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  document.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') stopInteracting();
    else if (mod && (event.key === '=' || event.key === '+')) zoomAt(...center(), 1.25);
    else if (mod && event.key === '-') zoomAt(...center(), 1 / 1.25);
    else if (mod && event.key === '0') zoomAt(...center(), 1 / view.scale);
    else if (event.shiftKey && (event.key === '!' || event.code === 'Digit1')) fitPage();
    else return;
    event.preventDefault();
  });
  addEventListener('resize', render);
  addEventListener('message', (event) => {
    const fromBoard = items.some((item) => item.el.querySelector('iframe')?.contentWindow === event.source);
    if (fromBoard && event.data && event.data.mfCanvasEscape === true) stopInteracting();
  });

  // Build, then open where the canvas says to.
  for (const name of order) addBoard(name);
  const notes = data.notes && typeof data.notes === 'object' ? Object.values(data.notes) : [];
  for (const note of notes) if (note && typeof note === 'object') addNote(note);

  const launchBoard = launch.view === 'focused' ? items.find((item) => item.name === launch.file) : null;
  const launchPage = pages.some((page) => page.id === launch.page) ? launch.page : view.page;
  showPage(launchBoard ? launchBoard.page : launchPage);
  if (launchBoard) fitTo([launchBoard.rect]);
})();
