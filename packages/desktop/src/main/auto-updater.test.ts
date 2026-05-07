import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron-updater's autoUpdater as an EventEmitter-like object we control.
const listeners = new Map<string, ((arg?: unknown) => void)[]>();
const mockAutoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on: vi.fn((event: string, fn: (arg?: unknown) => void) => {
    const arr = listeners.get(event) ?? [];
    arr.push(fn);
    listeners.set(event, arr);
  }),
  checkForUpdates: vi.fn().mockResolvedValue(null),
  downloadUpdate: vi.fn().mockResolvedValue(undefined),
  quitAndInstall: vi.fn(),
};
vi.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }));

const showMessageBox = vi.fn().mockResolvedValue({ response: 0 });
const ipcHandle = vi.fn();
const mockWindow = {
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
} as unknown as import('electron').BrowserWindow;

vi.mock('electron', () => ({
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
  ipcMain: { handle: (...args: unknown[]) => ipcHandle(...args) },
  app: { getVersion: () => '0.17.2' },
  BrowserWindow: class {},
}));

vi.mock('./logger.js', () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function emit(event: string, arg?: unknown): void {
  for (const fn of listeners.get(event) ?? []) fn(arg);
}

beforeEach(() => {
  listeners.clear();
  showMessageBox.mockClear();
  mockAutoUpdater.checkForUpdates.mockClear();
  mockAutoUpdater.on.mockClear();
  vi.resetModules();
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  delete process.env.NODE_ENV;
});

describe('auto-updater manual check', () => {
  it('shows "up to date" dialog on update-not-available when manual', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    emit('update-not-available');
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0]![1].message).toMatch(/is the latest version available/i);
  });

  it('does NOT show dialog on update-not-available when scheduled', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    emit('update-not-available');
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('shows error dialog on persistent error when manual', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    emit('error', Object.assign(new Error('signature mismatch'), { code: 'EPERM' }));
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0]![1].title).toMatch(/couldn't check/i);
  });

  it('does NOT show dialog on transient error when manual, but clears in-flight flag', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    emit('error', Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(mod.isManualCheckInFlight()).toBe(false);
  });

  it('does NOT show dialog on update-available when manual (StatusBar handles it)', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    emit('update-available', { version: '0.18.0' });
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(mod.isManualCheckInFlight()).toBe(false);
  });

  it('checkForUpdatesManual is a no-op when already in-flight', async () => {
    const mod = await import('./auto-updater.js');
    mod.initAutoUpdater(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    await mod.checkForUpdatesManual(mockWindow);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('watchdog clears in-flight flag if no terminal event fires within 60s', async () => {
    vi.useFakeTimers();
    try {
      const mod = await import('./auto-updater.js');
      mod.initAutoUpdater(mockWindow);
      await mod.checkForUpdatesManual(mockWindow);
      expect(mod.isManualCheckInFlight()).toBe(true);
      vi.advanceTimersByTime(60_000);
      expect(mod.isManualCheckInFlight()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('checkForUpdatesManual is a no-op in development mode', async () => {
    process.env.NODE_ENV = 'development';
    const mod = await import('./auto-updater.js');
    await mod.checkForUpdatesManual(mockWindow);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});
