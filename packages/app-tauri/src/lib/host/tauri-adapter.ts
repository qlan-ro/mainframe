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
} from '@qlan-ro/mainframe-types';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import * as bridge from '@/lib/tauri/bridge';
import { createTerminal } from '@/lib/tauri/terminal';
import { mountTauriPreview } from './tauri-preview';

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
    // Tauri Rust emits legacy status strings; enum-conformant mapping is Plan 3 parity. Cast preserves current behavior.
    status: (): Promise<DaemonStatus> => bridge.getDaemonStatus() as Promise<DaemonStatus>,
    onStatus: (cb: (s: DaemonStatus) => void): Promise<Unsubscribe> =>
      bridge.onDaemonStatus((s) => cb(s as DaemonStatus)),
  };

  log(level: LogLevel, module: string, message: string, data?: unknown): void {
    bridge.log(level, module, message, data);
  }

  /**
   * Install the window-drag listener (relocated from bridge.ts module scope).
   * Tauri 2 does not auto-wire mousedown → startDragging for
   * data-tauri-drag-region. Behavior is identical to the previous module-load
   * handler; the attribute rename is deferred to Plan 2. Call once at startup.
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
