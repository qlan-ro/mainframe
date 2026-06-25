/**
 * TauriAdapter — will become the only renderer module that imports @/lib/tauri/*
 * (the remaining direct callers are migrated in Tasks 6–12). It implements
 * HostBridge by delegating to the proven lib/tauri free functions; init()
 * installs the window-drag listener that previously ran at bridge.ts module scope.
 */
import type {
  HostBridge,
  AppInfo,
  Platform,
  LogLevel,
  DaemonStatus,
  TerminalOpts,
  TerminalHandlers,
  TerminalHandle,
  Unsubscribe,
  PreviewOpts,
  PreviewHandle,
  UpdateStatus,
  PresenceState,
} from '@qlan-ro/mainframe-types';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import * as bridge from '@/lib/tauri/bridge';
import { createTerminal } from '@/lib/tauri/terminal';
import { mountTauriPreview } from './tauri-preview';

/**
 * Maps the Rust backend's legacy status strings to the canonical DaemonStatus
 * enum. The Rust shell emits running:{pid}/started:pid=N/exited/not_started/
 * error:… (lib.rs); this is the single place that normalizes them so the renderer
 * may branch on daemon.status()/onStatus() on Tauri (Plan 3, decision 6).
 */
export function mapDaemonStatus(raw: string): DaemonStatus {
  if (raw === 'not_started') return 'initializing';
  if (raw === 'starting' || raw.startsWith('started:')) return 'starting';
  if (raw === 'ready' || raw.startsWith('running:')) return 'ready';
  if (raw === 'exited') return 'stopped';
  return 'unavailable'; // error:… and anything unrecognized
}

export class TauriAdapter implements HostBridge {
  app = {
    getInfo: (): Promise<AppInfo> => bridge.getAppInfo(),
    getHomedir: (): Promise<string> => bridge.getHomedir(),
    getAuthToken: (): Promise<string | null> => bridge.getAuthToken(),
    platform: (): Promise<Platform> => bridge.getPlatform(),
  };

  fs = {
    readFile: (path: string): Promise<string | null> => bridge.readFile(path),
    readFileBase64: (path: string): Promise<string | null> => bridge.readFileBase64(path),
    showItemInFolder: (path: string): Promise<void> => bridge.showItemInFolder(path),
  };

  shell = {
    openExternal: (url: string): Promise<void> => bridge.openExternal(url),
  };

  notify(title: string, body?: string): Promise<void> {
    return bridge.showNotification(title, body);
  }

  terminal = {
    create: (opts: TerminalOpts, handlers: TerminalHandlers): Promise<TerminalHandle> => createTerminal(opts, handlers),
  };

  preview = {
    mount: (container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle =>
      mountTauriPreview(container, url, opts),
    clearSession: (_projectId: string): Promise<void> => Promise.resolve(),
  };

  daemon = {
    port: (): Promise<number> => bridge.getDaemonPort(),
    status: async (): Promise<DaemonStatus> => mapDaemonStatus(await bridge.getDaemonStatus()),
    onStatus: (cb: (s: DaemonStatus) => void): Promise<Unsubscribe> =>
      bridge.onDaemonStatus((s) => cb(mapDaemonStatus(s))),
  };

  updates = {
    check: (): Promise<UpdateStatus> => bridge.checkForUpdate(),
    download: (): Promise<void> => bridge.downloadUpdate(),
    install: (): void => {
      void bridge.installUpdate().catch((err) => console.warn('[host] updater install failed', err));
    },
    onStatus: (cb: (s: UpdateStatus) => void): Promise<Unsubscribe> => bridge.onUpdateStatus(cb),
  };

  presence = {
    reportActivity: (state: PresenceState): Promise<void> => bridge.reportActivity(state),
  };

  log(level: LogLevel, module: string, message: string, data?: unknown): void {
    bridge.log(level, module, message, data);
  }

  /**
   * Install the window-drag listener (relocated from bridge.ts module scope).
   * Tauri 2 does not auto-wire mousedown → startDragging for [data-drag-region].
   * Call once at startup.
   */
  init(): void {
    document.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0 || e.detail !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a, label')) return;
      if (!target.closest('[data-drag-region]')) return;
      getCurrentWebviewWindow()
        .startDragging()
        .catch((err) => console.warn('[host] startDragging failed', err));
    });
  }
}
