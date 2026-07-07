/// Initialization script injected into every preview child webview.
///
/// Responsibilities:
///   (a) Intercept `target=_blank` / external navigation → open in the OS
///       default browser via the `plugin:preview-bridge|open_external` Tauri command.
///   (b) Expose `window.__mfInspectInstall()` and `window.__mfInspectCancel()`
///       that the `PreviewInstance` React component calls (via `preview_eval`)
///       to toggle the element-picker. The picker posts its result back via
///       `window.__TAURI_INTERNALS__.invoke('plugin:preview-bridge|inspect_result', {...})`.
///   (c) Expose `window.__mfRegionSelectInstall(tabId)` and
///       `window.__mfRegionSelectCancel()` for drag-rectangle region capture.
///       Posts `{ tabId, region: {x,y,w,h} }` (or `region: null` on cancel/Escape)
///       via `window.__TAURI_INTERNALS__.invoke('plugin:preview-bridge|region_result', {...})`.
///   (d) Navigation tracking — reports `location.href` once on full-page load and
///       patches `history.pushState`/`replaceState` + listens to `popstate`/
///       `hashchange` for SPA in-page navigation. De-duped against the last
///       reported URL. Posts `{ tabId, url }` via
///       `window.__TAURI_INTERNALS__.invoke('plugin:preview-bridge|navigate_event', {...})`.
///
/// Kept minimal and self-removing — the ONLY code injected into the user page.
pub const BRIDGE_JS: &str = r#"
(function () {
  'use strict';

  // (a) Redirect target=_blank anchors to the OS browser.
  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a[target=_blank]') : null;
    if (a && a.href) {
      e.preventDefault();
      window.__TAURI_INTERNALS__.invoke('plugin:preview-bridge|open_external', { url: a.href });
    }
  }, true);

  // (b) Inspect element picker — installed/removed on demand.
  var _overlay = null;
  var _highlight = null;

  function removeInspect() {
    if (_overlay) { _overlay.remove(); _overlay = null; }
    if (_highlight) { _highlight.remove(); _highlight = null; }
    document.removeEventListener('mousemove', _onMove, true);
    document.removeEventListener('click', _onClick, true);
    document.removeEventListener('keydown', _onKey, true);
  }

  function _onMove(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === _overlay || el === _highlight) return;
    if (_highlight) { _highlight.remove(); }
    var r = el.getBoundingClientRect();
    _highlight = document.createElement('div');
    Object.assign(_highlight.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
      left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px',
      outline: '2px solid #3b82f6', background: 'rgba(59,130,246,0.08)',
    });
    document.body.appendChild(_highlight);
  }

  function _cssPath(el) {
    var path = [];
    while (el && el.nodeType === 1) {
      var sel = el.tagName.toLowerCase();
      if (el.id) { sel += '#' + el.id; path.unshift(sel); break; }
      var sib = el, nth = 1;
      while ((sib = sib.previousElementSibling)) nth++;
      if (nth > 1) sel += ':nth-child(' + nth + ')';
      path.unshift(sel);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  function _onClick(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === _overlay || el === _highlight) return;
    e.preventDefault(); e.stopPropagation();
    var r = el.getBoundingClientRect();
    var result = {
      tabId: window.__mfPreviewTabId || '',
      selector: _cssPath(el),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
    removeInspect();
    window.__TAURI_INTERNALS__.invoke('plugin:preview-bridge|inspect_result', { result: result });
  }

  function _onKey(e) {
    if (e.key === 'Escape') {
      removeInspect();
      window.__TAURI_INTERNALS__.invoke('plugin:preview-bridge|inspect_result', {
        result: { tabId: window.__mfPreviewTabId || '', selector: null, rect: null, viewport: null }
      });
    }
  }

  window.__mfInspectInstall = function (tabId) {
    window.__mfPreviewTabId = tabId;
    removeInspect();
    _overlay = document.createElement('div');
    Object.assign(_overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483645',
      cursor: 'crosshair', pointerEvents: 'none',
    });
    document.body.appendChild(_overlay);
    document.addEventListener('mousemove', _onMove, true);
    document.addEventListener('click', _onClick, true);
    document.addEventListener('keydown', _onKey, true);
  };

  window.__mfInspectCancel = function () {
    removeInspect();
  };

  // (c) Region-select picker — drag a rectangle; posts {tabId, region} back.
  var _regionOverlay = null;
  var _regionCleanup = null;
  function removeRegion() {
    if (_regionCleanup) { _regionCleanup(); _regionCleanup = null; }
    if (_regionOverlay) { _regionOverlay.remove(); _regionOverlay = null; }
  }
  window.__mfRegionSelectInstall = function (tabId) {
    window.__mfPreviewTabId = tabId;
    removeRegion();
    var overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483646',
      cursor: 'crosshair', background: 'rgba(0,0,0,0.05)',
    });
    var sel = document.createElement('div');
    Object.assign(sel.style, {
      position: 'fixed', border: '2px solid #3b82f6',
      background: 'rgba(59,130,246,0.2)', pointerEvents: 'none', display: 'none',
    });
    overlay.appendChild(sel);
    document.body.appendChild(overlay);
    _regionOverlay = overlay;
    var start = null;
    function geom(e) {
      var x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
      return { x: x, y: y, w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
    }
    function finish(region) {
      removeRegion();
      window.__TAURI_INTERNALS__.invoke('plugin:preview-bridge|region_result', {
        result: { tabId: window.__mfPreviewTabId || '', region: region },
      });
    }
    function onDown(e) {
      start = { x: e.clientX, y: e.clientY };
      sel.style.left = start.x + 'px'; sel.style.top = start.y + 'px';
      sel.style.width = '0px'; sel.style.height = '0px'; sel.style.display = 'block';
    }
    function onMove(e) {
      if (!start) return;
      var g = geom(e);
      sel.style.left = g.x + 'px'; sel.style.top = g.y + 'px';
      sel.style.width = g.w + 'px'; sel.style.height = g.h + 'px';
    }
    function onUp(e) {
      if (!start) { finish(null); return; }
      var g = geom(e);
      finish(g.w > 0 && g.h > 0 ? g : null);
    }
    function onKey(e) { if (e.key === 'Escape') finish(null); }
    overlay.addEventListener('mousedown', onDown);
    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey, true);
    _regionCleanup = function () {
      overlay.removeEventListener('mousedown', onDown);
      overlay.removeEventListener('mousemove', onMove);
      overlay.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey, true);
    };
  };
  window.__mfRegionSelectCancel = function () { removeRegion(); };

  // (d) Navigation tracking — report URL changes so the address bar reflects
  // them (two-way). Full-document loads: this script re-runs on every load, so
  // report location.href once at injection. SPA in-page nav: patch history +
  // listen to popstate/hashchange. De-dupe against the last reported URL.
  var _mfLastUrl = null;
  function _mfReportNav() {
    if (location.href === _mfLastUrl) return;
    _mfLastUrl = location.href;
    window.__TAURI_INTERNALS__.invoke('plugin:preview-bridge|navigate_event', {
      result: { tabId: window.__mfPreviewTabId || '', url: location.href },
    });
  }
  _mfReportNav(); // initial full-page load
  var _mfPush = history.pushState;
  history.pushState = function () { _mfPush.apply(this, arguments); _mfReportNav(); };
  var _mfReplace = history.replaceState;
  history.replaceState = function () { _mfReplace.apply(this, arguments); _mfReportNav(); };
  window.addEventListener('popstate', _mfReportNav);
  window.addEventListener('hashchange', _mfReportNav);
})();
"#;
