/// Initialization script injected into every preview child webview.
///
/// Responsibilities:
///   (a) Intercept `target=_blank` / external navigation → open in the OS
///       default browser via the `preview_open_external` Tauri command.
///   (b) Expose `window.__mfInspectInstall()` and `window.__mfInspectCancel()`
///       that the `PreviewInstance` React component calls (via `preview_eval`)
///       to toggle the element-picker. The picker posts its result back via
///       `window.__TAURI_INTERNALS__.invoke('preview_inspect_result', {...})`.
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
      window.__TAURI_INTERNALS__.invoke('preview_open_external', { url: a.href });
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
    window.__TAURI_INTERNALS__.invoke('preview_inspect_result', { result: result });
  }

  function _onKey(e) {
    if (e.key === 'Escape') {
      removeInspect();
      window.__TAURI_INTERNALS__.invoke('preview_inspect_result', {
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
})();
"#;
