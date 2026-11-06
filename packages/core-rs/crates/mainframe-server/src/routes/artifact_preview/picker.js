// Lets Mainframe's Inspect tool pick elements inside an artifact.
//
// Inspect's own picker runs only in the top document, and a design's boards are
// nested frames. So this script runs in every page: the top page takes over
// Inspect's install hooks, frames do the picking and post it up, and the top page
// converts the rect to its own viewport and reports through the usual Inspect
// channel. The pick names the artifact and board, so the agent can find the source.
(function () {
  'use strict';

  const MARK = 'mfArtifactPicker';
  const HIGHLIGHT_ID = 'mf-artifact-picker-highlight';
  const MAX_TEXT = 60;
  const MAX_SELECTOR = 600;
  const isTop = window.parent === window;
  let picking = false;

  function clearHighlight() {
    const existing = document.getElementById(HIGHLIGHT_ID);
    if (existing) existing.remove();
  }

  function highlight(element) {
    clearHighlight();
    const rect = element.getBoundingClientRect();
    const box = document.createElement('div');
    box.id = HIGHLIGHT_ID;
    Object.assign(box.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      outline: '2px solid #3b82f6',
      background: 'rgba(59,130,246,0.08)',
    });
    document.documentElement.appendChild(box);
  }

  function cssPath(element) {
    const path = [];
    for (let node = element; node && node.nodeType === 1 && node !== document.documentElement;) {
      if (node.id) {
        path.unshift(`${node.tagName.toLowerCase()}#${node.id}`);
        break;
      }
      let position = 1;
      for (let sibling = node; (sibling = sibling.previousElementSibling);) position += 1;
      path.unshift(position > 1 ? `${node.tagName.toLowerCase()}:nth-child(${position})` : node.tagName.toLowerCase());
      node = node.parentElement;
    }
    return path.join(' > ');
  }

  // The preview URL is /api/artifact-preview/<slug>/<version>/<page>.
  function pageParts() {
    const parts = location.pathname.split('/');
    return { slug: parts[3] || '', page: decodeURIComponent(parts.slice(5).join('/')) };
  }

  // A chat row wraps this in backticks and keeps it on one line.
  function describe(element) {
    const { slug, page } = pageParts();
    const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    const parts = [`artifact https://claude.ai/artifact/${slug}`, `board ${page}`, cssPath(element)];
    if (text) parts.push(`text "${text}"`);
    return parts.join(' | ').replace(/`/g, "'");
  }

  function targetAt(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element && element.id !== HIGHLIGHT_ID ? element : null;
  }

  function onMove(event) {
    const element = targetAt(event);
    if (element) highlight(element);
  }

  function onClick(event) {
    const element = targetAt(event);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    const r = element.getBoundingClientRect();
    stop();
    finish({ selector: describe(element), rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }

  function onKey(event) {
    if (event.key !== 'Escape') return;
    stop();
    finish({ selector: null, rect: null });
  }

  function start() {
    picking = true;
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function stop() {
    picking = false;
    clearHighlight();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function reportToHost({ selector, rect }) {
    const hasPick = selector !== null;
    window.__TAURI_INTERNALS__.invoke('plugin:preview-bridge|inspect_result', {
      result: {
        tabId: window.__mfPreviewTabId || '',
        selector,
        rect,
        viewport: hasPick ? { w: window.innerWidth, h: window.innerHeight } : null,
      },
    });
  }

  const frames = () => [...document.querySelectorAll('iframe')];

  function tellFrames(command) {
    for (const frame of frames()) {
      if (frame.contentWindow) frame.contentWindow.postMessage({ [MARK]: command }, '*');
    }
  }

  // A scaled frame reports in its own pixels; its box says how far it was scaled.
  function toTopViewport(frame, rect) {
    if (!rect) return null;
    const box = frame.getBoundingClientRect();
    const scale = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
    return {
      x: box.left + rect.x * scale,
      y: box.top + rect.y * scale,
      w: rect.w * scale,
      h: rect.h * scale,
    };
  }

  let finish = reportToHost;

  if (isTop) {
    // Frames hold artifact content, so a message only counts during a pick, and its
    // text is confined to one bounded chat row.
    let awaitingFrame = false;
    const endFramePick = () => {
      awaitingFrame = false;
      tellFrames('stop');
    };

    window.__mfInspectInstall = function (tabId) {
      window.__mfPreviewTabId = tabId;
      stop();
      if (frames().length === 0) {
        start();
        return;
      }
      awaitingFrame = true;
      tellFrames('start');
      document.addEventListener('keydown', onKey, true);
    };
    window.__mfInspectCancel = function () {
      endFramePick();
      stop();
    };
    window.addEventListener('message', (event) => {
      const pick = event.data && event.data[MARK];
      if (!awaitingFrame || !pick || typeof pick !== 'object') return;
      const frame = frames().find((candidate) => candidate.contentWindow === event.source);
      if (!frame) return;
      endFramePick();
      stop();
      const selector =
        typeof pick.selector === 'string' ? pick.selector.replace(/[`\r\n]/g, ' ').slice(0, MAX_SELECTOR) : null;
      reportToHost({ selector, rect: selector === null ? null : toTopViewport(frame, pick.rect) });
    });
    finish = (result) => {
      endFramePick();
      reportToHost(result);
    };
  } else {
    finish = (result) => window.parent.postMessage({ [MARK]: result }, '*');
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || !event.data) return;
      const command = event.data[MARK];
      if (command === 'start' && !picking) start();
      if (command === 'stop') stop();
    });
  }
})();
