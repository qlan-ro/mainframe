/**
 * host/host-bridge.ts
 *
 * The canonical, type-only renderer→host contract. One interface, multiple
 * adapters (Tauri now; Electron in Plan 2). Events are subscription functions
 * returning an Unsubscribe so the transport (Tauri Channel/listen vs IPC) stays
 * inside the adapter.
 *
 * Plan 1 scope: app / fs / shell / notify / terminal / preview / daemon / log.
 * Preview is the `mount()` seam (Plan 2).
 * `updates` and `presence` are deferred to Plan 3 (no Tauri impl exists yet).
 */

export type Unsubscribe = () => void;

import type { Platform, DaemonStatus, LogLevel } from './host-contract.js';
import type { AppInfoSchema, RegionSchema } from './host-contract.js';
import type { z } from 'zod';
export type { Platform, DaemonStatus, LogLevel } from './host-contract.js';

export type AppInfo = z.infer<typeof AppInfoSchema>;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Region = z.infer<typeof RegionSchema>;

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

export interface PreviewOpts {
  /** Selects the persistent session partition: persist:sandbox-{projectId} (Electron). */
  projectId?: string;
  /** Initial frame; the renderer toggles it via handle.setDevice. */
  device?: 'desktop' | 'mobile';
}

/**
 * A mounted preview surface. The renderer reserves a DOM container and hands it to
 * mount(); the handle owns one backing webview.
 *
 * Coordinate space: capture() region is CSS pixels in the WEBVIEW VIEWPORT space
 * (top-left = page content origin). The backend (Tauri WKWebView snapshot / Electron
 * capturePage) applies device-pixel-ratio scaling — the renderer never multiplies by DPR.
 *
 * Visibility/occlusion: Tauri composites the webview ABOVE the DOM, so setVisible(false)
 * blanks the OS layer when a DOM overlay covers the region. Electron stacks the <webview>
 * IN the DOM, so setVisible(false) on occlusion is a near-no-op — both hosts must TOLERATE
 * the renderer emitting it (the renderer keeps the existing occlusion logic unchanged).
 */
export interface PreviewHandle {
  setVisible(visible: boolean): void;
  navigate(url: string): Promise<void>;
  capture(region?: Region): Promise<Uint8Array>;
  startInspect(): Promise<void>;
  onInspect(cb: (result: InspectResult) => void): Unsubscribe;
  /** Tauri: re-read container.getBoundingClientRect() into the native layer. Electron: no-op. */
  refit(): void;
  setDevice(device: 'desktop' | 'mobile'): void;
  destroy(): void;
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
  preview: {
    mount(container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle;
    clearSession(projectId: string): Promise<void>;
  };
  daemon: {
    port(): Promise<number>;
    status(): Promise<DaemonStatus>;
    onStatus(cb: (status: DaemonStatus) => void): Promise<Unsubscribe>;
  };
  log(level: LogLevel, module: string, message: string, data?: unknown): void;
  /** Tauri installs the window-drag listener here; Electron is a CSS no-op. */
  init?(): void;
}
