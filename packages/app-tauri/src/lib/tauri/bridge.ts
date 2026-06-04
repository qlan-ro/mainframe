/**
 * lib/tauri/bridge.ts
 *
 * The ONLY module that imports from @tauri-apps/*. All other modules
 * in the renderer import from here, never directly from Tauri packages.
 * This is the Tauri equivalent of packages/desktop/src/preload/index.ts.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';

export interface AppInfo {
  version: string;
  author: string;
  homedir: string;
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('get_app_info');
}

export async function getHomedir(): Promise<string> {
  return invoke<string>('get_homedir');
}

export async function getDaemonPort(): Promise<number> {
  return invoke<number>('get_daemon_port');
}

export async function getDaemonStatus(): Promise<string> {
  return invoke<string>('get_daemon_status');
}

/**
 * Reads the daemon auth secret from `~/.mainframe/config.json`.
 * Returns null when the daemon has not started yet or runs without auth.
 * Use this to authenticate WebSocket connections (Bearer token).
 */
export async function getAuthToken(): Promise<string | null> {
  return invoke<string | null>('get_auth_token', { dataDir: null });
}

export function onDaemonStatus(callback: (status: string) => void): Promise<UnlistenFn> {
  return listen<string>('daemon:status', (event: Event<string>) => callback(event.payload));
}
