/**
 * TauriAdapter — the only module in the renderer that imports @/lib/tauri/*.
 * It implements HostBridge by delegating to the proven lib/tauri free
 * functions (no Tauri call code is rewritten here). init() installs the
 * window-drag listener that previously ran at bridge.ts module scope.
 */
import type {
  HostBridge,
  AppInfo,
  Platform,
  LogLevel,
  DaemonStatus,
  Bounds,
  Region,
  InspectResult,
  TerminalOpts,
  TerminalHandlers,
  TerminalHandle,
  Unsubscribe,
} from '@qlan-ro/mainframe-types';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import * as bridge from '@/lib/tauri/bridge';
import { createTerminal } from '@/lib/tauri/terminal';
import * as preview from '@/lib/tauri/preview';

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
    create: (tabId: string, url: string, bounds: Bounds): Promise<void> => preview.previewCreate(tabId, url, bounds),
    navigate: (tabId: string, url: string): Promise<void> => preview.previewNavigate(tabId, url),
    setBounds: (tabId: string, bounds: Bounds): Promise<void> => preview.previewSetBounds(tabId, bounds),
    setVisible: (tabId: string, visible: boolean): Promise<void> => preview.previewSetVisible(tabId, visible),
    capture: (tabId: string, region?: Region): Promise<Uint8Array> => preview.previewCapture(tabId, region),
    destroy: (tabId: string): Promise<void> => preview.previewDestroy(tabId),
    eval: (tabId: string, js: string): Promise<void> => preview.previewEval(tabId, js),
    onInspectResult: (cb: (result: InspectResult) => void): Promise<Unsubscribe> => preview.onInspectResult(cb),
  };

  daemon = {
    port: (): Promise<number> => bridge.getDaemonPort(),
    status: (): Promise<DaemonStatus> => bridge.getDaemonStatus(),
    onStatus: (cb: (status: DaemonStatus) => void): Promise<Unsubscribe> => bridge.onDaemonStatus(cb),
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
      if (!target.closest('[data-tauri-drag-region]')) return;
      getCurrentWebviewWindow()
        .startDragging()
        .catch((err) => console.warn('[host] startDragging failed', err));
    });
  }
}
