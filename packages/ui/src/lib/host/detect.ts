/**
 * Runtime detection for the host adapter. Tauri injects __TAURI_INTERNALS__
 * into its webview; it is absent in a plain browser / vitest jsdom.
 */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  // Tauri injects its internals into EVERY webview it creates — including the
  // preview's child webviews, which load someone else's page. A Mainframe UI
  // opened in a preview would otherwise take itself for the host app, call
  // daemon commands that webview's capability never granted, and sit on
  // "Connecting to the daemon" forever. The preview stamps this flag from its
  // initialization script, so it is set before any page script runs.
  if ('__mfPreviewWebview' in window) return false;
  return '__TAURI_INTERNALS__' in window;
}

/**
 * Electron exposes `window.mainframe` (the preload bridge). Absent under Tauri
 * (which uses __TAURI_INTERNALS__) and in a plain browser / vitest jsdom.
 */
export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && 'mainframe' in window;
}
