/**
 * Runtime detection for the host adapter. Tauri injects __TAURI_INTERNALS__
 * into its webview; it is absent in a plain browser / vitest jsdom.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
