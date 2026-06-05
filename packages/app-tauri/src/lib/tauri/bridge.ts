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

/** Tauri injects this global into its webview; absent in a plain browser. */
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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

export function onDaemonStatus(callback: (status: string) => void): Promise<UnlistenFn> {
  if (!IS_TAURI) {
    callback('ready');
    return Promise.resolve(() => {});
  }
  return listen<string>('daemon:status', (event: Event<string>) => callback(event.payload));
}
