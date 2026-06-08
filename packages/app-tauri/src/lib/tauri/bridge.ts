/**
 * lib/tauri/bridge.ts
 *
 * The ONLY module that imports from @tauri-apps/*. All other modules
 * in the renderer import from here, never directly from Tauri packages.
 * This is the Tauri equivalent of packages/desktop/src/preload/index.ts.
 *
 * Dev/browser mode (Path A empirical render): when NOT running inside the
 * Tauri webview, every Tauri command falls back to a browser-safe value so the
 * Vite renderer can run in a plain browser against a manually-started daemon.
 * Set `VITE_DAEMON_PORT` to point it at that daemon (e.g. one launched with
 * `MAINFRAME_DATA_DIR=~/.mainframe_dev`). Localhost is daemon-trusted, so no
 * auth token is needed in this mode.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl } from '@tauri-apps/plugin-opener';
import { sendNotification } from '@tauri-apps/plugin-notification';

/** Tauri injects this global into its webview; absent in a plain browser. */
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Tauri 2 does not auto-wire the mousedown → startDragging handler for
// data-tauri-drag-region; we set it up here once at module load time.
if (IS_TAURI) {
  document.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0 || e.detail !== 1) return;
    const target = e.target as HTMLElement;
    // Don't hijack clicks on interactive elements inside the drag region.
    if (target.closest('button, input, select, textarea, a, label')) return;
    if (!target.closest('[data-tauri-drag-region]')) return;
    getCurrentWebviewWindow()
      .startDragging()
      .catch((err) => console.warn('[tauri-bridge] startDragging failed', err));
  });
}

/** Dev daemon port from Vite env (browser mode only). */
const DEV_DAEMON_PORT = Number((import.meta.env as Record<string, string | undefined>).VITE_DAEMON_PORT) || undefined;

export interface AppInfo {
  version: string;
  author: string;
  homedir: string;
}

export async function getAppInfo(): Promise<AppInfo> {
  if (!IS_TAURI) return { version: 'dev', author: 'mainframe', homedir: '' };
  return invoke<AppInfo>('get_app_info');
}

export async function getHomedir(): Promise<string> {
  if (!IS_TAURI) return '';
  return invoke<string>('get_homedir');
}

export async function getDaemonPort(): Promise<number> {
  if (!IS_TAURI) {
    if (DEV_DAEMON_PORT) return DEV_DAEMON_PORT;
    throw new Error('Not running under Tauri and VITE_DAEMON_PORT is not set (browser dev mode)');
  }
  return invoke<number>('get_daemon_port');
}

export async function getDaemonStatus(): Promise<string> {
  if (!IS_TAURI) return 'ready';
  return invoke<string>('get_daemon_status');
}

/**
 * Reads the daemon auth secret from `~/.mainframe/config.json`.
 * Returns null when the daemon has not started yet or runs without auth.
 * Use this to authenticate WebSocket connections (Bearer token).
 * In browser dev mode returns null — localhost is daemon-trusted.
 */
export async function getAuthToken(): Promise<string | null> {
  if (!IS_TAURI) return null;
  return invoke<string | null>('get_auth_token', { dataDir: null });
}

/**
 * Opens a URL in the system's default browser (or app for custom protocols).
 * Replaces `window.mainframe.openExternal` from the Electron preload.
 * Falls back to `window.open` in browser dev mode.
 */
export async function openExternal(url: string): Promise<void> {
  if (!IS_TAURI) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await openUrl(url);
}

export function onDaemonStatus(callback: (status: string) => void): Promise<UnlistenFn> {
  if (!IS_TAURI) {
    callback('ready');
    return Promise.resolve(() => {});
  }
  return listen<string>('daemon:status', (event: Event<string>) => callback(event.payload));
}

/**
 * Reveals `path` in the system file manager (Finder / Explorer / Nautilus).
 * No-op in browser dev mode.
 */
export async function showItemInFolder(path: string): Promise<void> {
  if (!IS_TAURI) return;
  await invoke<void>('show_item_in_folder', { path });
}

/**
 * Reads a text file from disk. Path must be under the user home directory.
 * Returns null in browser dev mode or when the file is not found.
 */
export async function readFile(path: string): Promise<string | null> {
  if (!IS_TAURI) return null;
  return invoke<string | null>('read_file', { path });
}

/**
 * Shows an OS-native notification. No-op in browser dev mode.
 */
export async function showNotification(title: string, body?: string): Promise<void> {
  if (!IS_TAURI) return;
  sendNotification({ title, body });
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log shim. Delegates to console.* in both Tauri and browser modes
 * — no Rust roundtrip needed for renderer logs.
 */
export function log(level: LogLevel, _module: string, msg: string, data?: unknown): void {
  const fn = console[level] ?? console.log;
  if (data !== undefined) {
    fn(`[${_module}] ${msg}`, data);
  } else {
    fn(`[${_module}] ${msg}`);
  }
}

/**
 * Returns 'macos' | 'windows' | 'linux' | 'browser'.
 */
export async function getPlatform(): Promise<'macos' | 'windows' | 'linux' | 'browser'> {
  if (!IS_TAURI) return 'browser';
  const os = await invoke<string>('get_platform');
  if (os === 'macos' || os === 'windows' || os === 'linux') return os;
  return 'browser';
}
