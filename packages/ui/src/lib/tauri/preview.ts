/**
 * lib/tauri/preview.ts
 *
 * Typed wrappers over the Rust preview child-webview commands
 * (`src-tauri/src/preview/mod.rs`). Mirror structure of `lib/tauri/terminal.ts`.
 *
 * All commands require the Tauri runtime (they need a real WKWebView/add_child
 * backend). The `isTauri()` guard throws early in browser/test mode rather than
 * producing a misleading network error.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Bounds, Region, InspectResult, RegionSelectResult } from '@qlan-ro/mainframe-types';

export type { Bounds, Region, InspectResult, RegionSelectResult };

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// ── Commands ──────────────────────────────────────────────────────────────────

function notTauriError(name: string): Promise<never> {
  return Promise.reject(new Error(`${name} requires the Tauri runtime`));
}

/**
 * Create a child webview for the given tab, or re-navigate if it already exists.
 * Requires the Tauri `unstable` feature (added to Cargo.toml).
 */
export function previewCreate(tabId: string, url: string, bounds: Bounds): Promise<void> {
  if (!isTauri()) return notTauriError('previewCreate');
  return invoke('preview_create', { tabId, url, bounds });
}

/** Navigate an existing preview child webview to a new URL. */
export function previewNavigate(tabId: string, url: string): Promise<void> {
  if (!isTauri()) return notTauriError('previewNavigate');
  return invoke('preview_navigate', { tabId, url });
}

/** Reposition and resize the child webview in logical pixels. */
export function previewSetBounds(tabId: string, bounds: Bounds): Promise<void> {
  if (!isTauri()) return notTauriError('previewSetBounds');
  return invoke('preview_set_bounds', { tabId, bounds });
}

/** Show or hide the child webview native layer. */
export function previewSetVisible(tabId: string, visible: boolean): Promise<void> {
  if (!isTauri()) return notTauriError('previewSetVisible');
  return invoke('preview_set_visible', { tabId, visible });
}

/**
 * Capture a PNG screenshot of the child webview.
 *
 * macOS: WKWebView `takeSnapshot`, DPR-aware, optionally cropped to `region`.
 * Win/Linux: rejects with "preview capture unsupported on this platform".
 *
 * Returns a `Uint8Array` of raw PNG bytes.
 */
export async function previewCapture(tabId: string, region?: Region): Promise<Uint8Array> {
  if (!isTauri()) return notTauriError('previewCapture');
  const bytes = await invoke<number[]>('preview_capture', { tabId, region: region ?? null });
  return new Uint8Array(bytes);
}

/** Close-before-remove a child webview. Call on tab close / unmount. */
export function previewDestroy(tabId: string): Promise<void> {
  if (!isTauri()) return notTauriError('previewDestroy');
  return invoke('preview_destroy', { tabId });
}

/**
 * Evaluate JavaScript in the child webview (fire-and-forget).
 * Used to install / cancel the element-picker from BRIDGE_JS.
 */
export function previewEval(tabId: string, js: string): Promise<void> {
  if (!isTauri()) return notTauriError('previewEval');
  return invoke('preview_eval', { tabId, js });
}

// ── Events ────────────────────────────────────────────────────────────────────

/**
 * Subscribe to the `preview:inspect-result` event emitted by the Rust
 * `preview_inspect_result` command (called back from BRIDGE_JS).
 *
 * Returns an `UnlistenFn` — call it to remove the listener.
 */
export function onInspectResult(callback: (result: InspectResult) => void): Promise<UnlistenFn> {
  return listen<InspectResult>('preview:inspect-result', (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribe to the `preview:region-select` event emitted by the Rust
 * `preview_region_result` command (called back from BRIDGE_JS).
 *
 * Returns an `UnlistenFn` — call it to remove the listener.
 */
export function onRegionSelectResult(callback: (result: RegionSelectResult) => void): Promise<UnlistenFn> {
  return listen<RegionSelectResult>('preview:region-select', (event) => {
    callback(event.payload);
  });
}
