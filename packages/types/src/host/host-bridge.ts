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
 * Plan 3 scope: updates + presence — all three adapters now implement both.
 */

export type Unsubscribe = () => void;

import type { Platform, DaemonStatus, LogLevel, UpdateStatus, PresenceState } from './host-contract.js';
import type { AppInfoSchema, RegionSchema } from './host-contract.js';
import type { z } from 'zod';
export type { Platform, DaemonStatus, LogLevel, UpdateStatus, PresenceState } from './host-contract.js';

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

export interface RegionSelectResult {
  tabId: string;
  /** Selected region in webview-viewport CSS px, or null when cancelled (Escape / zero-size). */
  region: Region | null;
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
  /**
   * True when the backing webview composites ABOVE the DOM (Tauri native child
   * WKWebView) — a DOM overlay over the preview region must hide it. False when
   * the webview is an in-DOM element that respects z-index (Electron <webview>
   * tag) — DOM overlays stack over it and it must NOT be hidden for them.
   */
  readonly compositesAboveDom: boolean;
  navigate(url: string): Promise<void>;
  capture(region?: Region): Promise<Uint8Array>;
  startInspect(): Promise<void>;
  onInspect(cb: (result: InspectResult) => void): Unsubscribe;
  startRegionSelect(): Promise<void>;
  onRegionSelect(cb: (result: RegionSelectResult) => void): Unsubscribe;
  /**
   * Subscribe to navigations that occur inside the preview webview — link
   * clicks, redirects, and SPA route changes. Mirrors the address-bar in a real
   * browser. Returns an Unsubscribe.
   */
  onNavigate(cb: (url: string) => void): Unsubscribe;
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
  updates: {
    check(): Promise<UpdateStatus>;
    download(): Promise<void>;
    install(): void;
    onStatus(cb: (s: UpdateStatus) => void): Promise<Unsubscribe>;
  };
  presence: {
    reportActivity(state: PresenceState): Promise<void>;
  };
  log(level: LogLevel, module: string, message: string, data?: unknown): void;
  /** Tauri installs the window-drag listener here; Electron is a CSS no-op. */
  init?(): void;
}
