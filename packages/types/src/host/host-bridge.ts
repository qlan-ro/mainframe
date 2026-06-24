/**
 * host/host-bridge.ts
 *
 * The canonical, type-only renderer→host contract. One interface, multiple
 * adapters (Tauri now; Electron in Plan 2). Events are subscription functions
 * returning an Unsubscribe so the transport (Tauri Channel/listen vs IPC) stays
 * inside the adapter.
 *
 * Plan 1 scope: app / fs / shell / notify / terminal / preview / daemon / log.
 * `updates` and `presence` are deferred to Plan 3 (no Tauri impl exists yet).
 */

export type Unsubscribe = () => void;

export type Platform = 'macos' | 'windows' | 'linux' | 'browser';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppInfo {
  version: string;
  author: string;
  homedir: string;
}

/** Daemon lifecycle status string (e.g. 'ready'); kept as the host emits it. */
export type DaemonStatus = string;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InspectResult {
  tabId: string;
  selector: string | null;
  rect: Bounds | null;
  viewport: Bounds | null;
}

export interface TerminalOpts {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalHandlers {
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number | null) => void;
}

export interface TerminalHandle {
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
}

/**
 * Preview methods are exposed 1:1 with the current lib/tauri/preview.ts
 * (imperative). The `mount()` seam is deferred to Plan 2.
 */
export interface PreviewPort {
  create(tabId: string, url: string, bounds: Bounds): Promise<void>;
  navigate(tabId: string, url: string): Promise<void>;
  setBounds(tabId: string, bounds: Bounds): Promise<void>;
  setVisible(tabId: string, visible: boolean): Promise<void>;
  capture(tabId: string, region?: Region): Promise<Uint8Array>;
  destroy(tabId: string): Promise<void>;
  eval(tabId: string, js: string): Promise<void>;
  onInspectResult(cb: (result: InspectResult) => void): Promise<Unsubscribe>;
}

export interface HostBridge {
  app: {
    getInfo(): Promise<AppInfo>;
    getHomedir(): Promise<string>;
    getAuthToken(): Promise<string | null>;
    platform(): Promise<Platform>;
  };
  fs: {
    readFile(path: string): Promise<string | null>;
    readFileBase64(path: string): Promise<string | null>;
    showItemInFolder(path: string): Promise<void>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  notify(title: string, body?: string): Promise<void>;
  terminal: {
    create(opts: TerminalOpts, handlers: TerminalHandlers): Promise<TerminalHandle>;
  };
  preview: PreviewPort;
  daemon: {
    port(): Promise<number>;
    status(): Promise<DaemonStatus>;
    onStatus(cb: (status: DaemonStatus) => void): Promise<Unsubscribe>;
  };
  log(level: LogLevel, module: string, message: string, data?: unknown): void;
}
