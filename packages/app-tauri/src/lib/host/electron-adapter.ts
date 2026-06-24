/**
 * ElectronAdapter — HostBridge over the Electron preload bridge (window.mainframe).
 *
 * The preload exposes GLOBAL terminal events (onData(id, bytes) / onExit(id, code))
 * for all terminals; this adapter registers ONE global listener pair and demuxes
 * by id into per-handle callbacks. Bytes arrive as Uint8Array (the main process
 * sends a Buffer; IPC delivers it as Uint8Array in the sandboxed renderer).
 *
 * preview is implemented in electron-preview.ts (Task 8); mount() delegates there.
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
  PreviewOpts,
  PreviewHandle,
  Unsubscribe,
} from '@qlan-ro/mainframe-types';
import { mountElectronPreview } from './electron-preview';

interface MainframeBridge {
  platform: string;
  getAppInfo(): Promise<AppInfo>;
  getHomedir(): Promise<string>;
  getAuthToken(): Promise<string | null>;
  readFile(path: string): Promise<string | null>;
  readFileBase64(path: string): Promise<string | null>;
  showItemInFolder(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  showNotification(title: string, body?: string): Promise<void>;
  clearSandboxSession(projectId: string): Promise<void>;
  log(level: string, module: string, message: string, data?: unknown): void;
  terminal: {
    create(opts: { id: string; cwd: string; cols: number; rows: number }): Promise<{ id: string }>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    kill(id: string): Promise<void>;
    onData(cb: (id: string, data: Uint8Array) => void): () => void;
    onExit(cb: (id: string, code: number | null) => void): () => void;
  };
  daemon: {
    port(): Promise<number>;
    status(): Promise<string>;
    onStatus(cb: (status: string) => void): () => void;
  };
}

function bridge(): MainframeBridge {
  const mf = (window as unknown as { mainframe?: MainframeBridge }).mainframe;
  if (!mf) throw new Error('window.mainframe is unavailable (not running under Electron)');
  return mf;
}

function mapPlatform(p: string): Platform {
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  if (p === 'linux') return 'linux';
  return 'browser';
}

export class ElectronAdapter implements HostBridge {
  /** Per-terminal handler registries; the global listeners demux into these. */
  private readonly dataHandlers = new Map<string, (bytes: Uint8Array) => void>();
  private readonly exitHandlers = new Map<string, (code: number | null) => void>();
  private terminalListenersInstalled = false;
  // Stored so a future dispose() can tear down the global terminal listeners.
  // @ts-expect-error — intentionally retained for future dispose(); not read yet
  private unsubData?: () => void;
  // @ts-expect-error — intentionally retained for future dispose(); not read yet
  private unsubExit?: () => void;

  app = {
    getInfo: (): Promise<AppInfo> => bridge().getAppInfo(),
    getHomedir: (): Promise<string> => bridge().getHomedir(),
    getAuthToken: (): Promise<string | null> => bridge().getAuthToken(),
    platform: (): Promise<Platform> => Promise.resolve(mapPlatform(bridge().platform)),
  };

  fs = {
    readFile: (path: string): Promise<string | null> => bridge().readFile(path),
    readFileBase64: (path: string): Promise<string | null> => bridge().readFileBase64(path),
    showItemInFolder: (path: string): Promise<void> => bridge().showItemInFolder(path),
  };

  shell = {
    openExternal: (url: string): Promise<void> => bridge().openExternal(url),
  };

  notify(title: string, body?: string): Promise<void> {
    return bridge().showNotification(title, body);
  }

  private installTerminalListeners(): void {
    if (this.terminalListenersInstalled) return;
    this.terminalListenersInstalled = true;
    this.unsubData = bridge().terminal.onData((id, bytes) => this.dataHandlers.get(id)?.(bytes));
    this.unsubExit = bridge().terminal.onExit((id, code) => {
      this.exitHandlers.get(id)?.(code);
      this.dataHandlers.delete(id);
      this.exitHandlers.delete(id);
    });
  }

  terminal = {
    create: async (opts: TerminalOpts, handlers: TerminalHandlers): Promise<TerminalHandle> => {
      this.installTerminalListeners();
      this.dataHandlers.set(opts.id, handlers.onData);
      this.exitHandlers.set(opts.id, handlers.onExit);
      await bridge().terminal.create({ id: opts.id, cwd: opts.cwd, cols: opts.cols, rows: opts.rows });
      return {
        write: (data: string): Promise<void> => bridge().terminal.write(opts.id, data),
        resize: (cols: number, rows: number): Promise<void> => bridge().terminal.resize(opts.id, cols, rows),
        kill: async (): Promise<void> => {
          await bridge().terminal.kill(opts.id);
          this.dataHandlers.delete(opts.id);
          this.exitHandlers.delete(opts.id);
        },
      };
    },
  };

  preview = {
    mount: (container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle =>
      mountElectronPreview(container, url, opts),
    clearSession: (projectId: string): Promise<void> => bridge().clearSandboxSession(projectId),
  };

  daemon = {
    port: (): Promise<number> => bridge().daemon.port(),
    status: (): Promise<DaemonStatus> => bridge().daemon.status() as Promise<DaemonStatus>,
    onStatus: (cb: (status: DaemonStatus) => void): Promise<Unsubscribe> => {
      const off = bridge().daemon.onStatus((s) => cb(s as DaemonStatus));
      return Promise.resolve(off);
    },
  };

  log(level: LogLevel, module: string, message: string, data?: unknown): void {
    bridge().log(level, module, message, data);
  }
}
