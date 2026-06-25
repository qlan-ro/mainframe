/**
 * FakeHostBridge — an in-memory HostBridge used by renderer tests AND the
 * browser/dev third mode (when not running inside a Tauri webview).
 *
 * Default return values reproduce the current lib/tauri/bridge.ts browser-mode
 * stubs 1:1. Pass `overrides` to substitute return values per method in tests.
 * Terminal/preview throw — there is no real PTY/webview backend in a browser.
 */
import type {
  HostBridge,
  AppInfo,
  Platform,
  LogLevel,
  DaemonStatus,
  TerminalHandle,
  Unsubscribe,
  UpdateStatus,
  PresenceState,
} from '@qlan-ro/mainframe-types';

const DEV_DAEMON_PORT = Number((import.meta.env as Record<string, string | undefined>).VITE_DAEMON_PORT) || undefined;

export interface FakeHostOverrides {
  app?: {
    getInfo?: AppInfo;
    getHomedir?: string;
    getAuthToken?: string | null;
    platform?: Platform;
  };
  fs?: {
    readFile?: string | null;
    readFileBase64?: string | null;
  };
  daemon?: {
    port?: number;
    status?: DaemonStatus;
  };
}

const DEFAULT_APP_INFO: AppInfo = { version: 'dev', author: 'mainframe', homedir: '' };

function notSupported(name: string): Promise<never> {
  return Promise.reject(new Error(`${name} is not available in browser/dev mode (no host)`));
}

export class FakeHostBridge implements HostBridge {
  constructor(private readonly overrides: FakeHostOverrides = {}) {}

  app = {
    getInfo: (): Promise<AppInfo> => Promise.resolve(this.overrides.app?.getInfo ?? DEFAULT_APP_INFO),
    getHomedir: (): Promise<string> => Promise.resolve(this.overrides.app?.getHomedir ?? ''),
    getAuthToken: (): Promise<string | null> => Promise.resolve(this.overrides.app?.getAuthToken ?? null),
    platform: (): Promise<Platform> => Promise.resolve(this.overrides.app?.platform ?? 'browser'),
  };

  fs = {
    readFile: (_path: string): Promise<string | null> => Promise.resolve(this.overrides.fs?.readFile ?? null),
    readFileBase64: (_path: string): Promise<string | null> =>
      Promise.resolve(this.overrides.fs?.readFileBase64 ?? null),
    showItemInFolder: (_path: string): Promise<void> => Promise.resolve(),
  };

  shell = {
    openExternal: (url: string): Promise<void> => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve();
    },
  };

  notify(_title: string, _body?: string): Promise<void> {
    return Promise.resolve();
  }

  terminal = {
    create: (): Promise<TerminalHandle> => notSupported('terminal.create'),
  };

  preview = {
    mount: (): import('@qlan-ro/mainframe-types').PreviewHandle => ({
      setVisible: () => {},
      navigate: () => Promise.resolve(),
      capture: () => Promise.reject(new Error('preview.capture is not available in browser/dev mode')),
      startInspect: () => Promise.resolve(),
      onInspect: () => () => {},
      refit: () => {},
      setDevice: () => {},
      destroy: () => {},
    }),
    clearSession: (): Promise<void> => Promise.resolve(),
  };

  daemon = {
    port: (): Promise<number> => {
      const port = this.overrides.daemon?.port ?? DEV_DAEMON_PORT;
      if (port == null) {
        return Promise.reject(new Error('No host and VITE_DAEMON_PORT is not set (browser dev mode)'));
      }
      return Promise.resolve(port);
    },
    status: (): Promise<DaemonStatus> => Promise.resolve(this.overrides.daemon?.status ?? 'ready'),
    onStatus: (cb: (status: DaemonStatus) => void): Promise<Unsubscribe> => {
      cb(this.overrides.daemon?.status ?? 'ready');
      return Promise.resolve(() => {});
    },
  };

  updates = {
    check: (): Promise<UpdateStatus> => Promise.resolve({ state: 'not-available' as const }),
    download: (): Promise<void> => Promise.resolve(),
    install: (): void => {},
    onStatus: (cb: (s: UpdateStatus) => void): Promise<Unsubscribe> => {
      cb({ state: 'not-available' });
      return Promise.resolve(() => {});
    },
  };

  presence = {
    reportActivity: (_state: PresenceState): Promise<void> => Promise.resolve(),
  };

  log(level: LogLevel, module: string, message: string, data?: unknown): void {
    const fn = console[level] ?? console.log;
    if (data !== undefined) fn(`[${module}] ${message}`, data);
    else fn(`[${module}] ${message}`);
  }
}
