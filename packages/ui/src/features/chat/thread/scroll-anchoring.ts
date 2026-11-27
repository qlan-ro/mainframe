/**
 * Whether the browser anchors the scroll position on its own (`overflow-anchor`: WebKit from macOS 15,
 * Chromium, Firefox). Read when it is needed, so a test can change the answer. Where it is false the
 * plain list keeps Mainframe's own guards: the owner's measured restore after a page lands, and the
 * row anchor for a fold or an expansion above the reader.
 */
export function anchoringSupported(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('overflow-anchor', 'auto');
}
