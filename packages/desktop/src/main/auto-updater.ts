import { autoUpdater } from 'electron-updater';
import type { UpdateInfo, ProgressInfo } from 'electron-updater';
import { BrowserWindow, ipcMain, dialog, app } from 'electron';
import { createMainLogger } from './logger.js';
import { classifyUpdateError } from './auto-updater-error-classifier.js';

const log = createMainLogger('electron:auto-updater');

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

let manualCheckInFlight = false;
let manualCheckWindow: BrowserWindow | null = null;

export function isManualCheckInFlight(): boolean {
  return manualCheckInFlight;
}

function clearManualFlag(): void {
  manualCheckInFlight = false;
  manualCheckWindow = null;
}

function showUpToDateDialog(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  void dialog.showMessageBox(window, {
    type: 'info',
    title: "You're up to date",
    message: `Mainframe ${app.getVersion()} is the latest version available.`,
    buttons: ['OK'],
    defaultId: 0,
  });
}

function showErrorDialog(window: BrowserWindow, message: string): void {
  if (window.isDestroyed()) return;
  void dialog.showMessageBox(window, {
    type: 'error',
    title: "Couldn't check for updates",
    message: 'Mainframe was unable to check for updates.',
    detail: message,
    buttons: ['OK'],
    defaultId: 0,
  });
}

function send(mainWindow: BrowserWindow, status: UpdateStatus): void {
  if (mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update-status', status);
}

function registerListeners(mainWindow: BrowserWindow): void {
  autoUpdater.on('checking-for-update', () => {
    log.info('checking for update');
    // Clear any prior persistent error so stale banners don't persist across cycles.
    send(mainWindow, { state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info({ version: info.version }, 'update available');
    send(mainWindow, { state: 'available', version: info.version });
    if (manualCheckInFlight) clearManualFlag();
  });

  autoUpdater.on('update-not-available', () => {
    log.info('no update available');
    send(mainWindow, { state: 'not-available' });
    if (manualCheckInFlight) {
      const target = manualCheckWindow ?? mainWindow;
      clearManualFlag();
      showUpToDateDialog(target);
    }
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    send(mainWindow, { state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info({ version: info.version }, 'update downloaded');
    send(mainWindow, { state: 'downloaded', version: info.version });
    if (manualCheckInFlight) clearManualFlag();
  });

  autoUpdater.on('error', (err: Error) => {
    const kind = classifyUpdateError(err);
    if (kind === 'transient') {
      log.warn({ message: err.message, kind }, 'transient update check error (suppressed from UI)');
      if (manualCheckInFlight) clearManualFlag();
      return;
    }
    log.error({ message: err.message, kind }, 'persistent update error');
    send(mainWindow, { state: 'error', message: err.message });
    if (manualCheckInFlight) {
      const target = manualCheckWindow ?? mainWindow;
      clearManualFlag();
      showErrorDialog(target, err.message);
    }
  });
}

function registerIPC(): void {
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates());
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
}

function scheduleChecks(): void {
  // First check after 10 seconds on startup, then every 4 hours.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      log.warn({ err }, 'scheduled update check failed');
    });
  }, 10_000);

  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        log.warn({ err }, 'periodic update check failed');
      });
    },
    4 * 60 * 60 * 1_000,
  );
}

export async function checkForUpdatesManual(window: BrowserWindow): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    log.info('development mode: manual update check skipped');
    return;
  }
  if (manualCheckInFlight) {
    log.info('manual update check already in flight; ignoring duplicate request');
    return;
  }
  manualCheckInFlight = true;
  manualCheckWindow = window;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err: unknown) {
    // The 'error' event listener above handles the user-facing dialog.
    log.warn({ err }, 'manual update check threw');
  }
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // electron-updater only works in packaged builds; skip in development.
  if (process.env.NODE_ENV === 'development') {
    log.info('development mode: auto-updater disabled');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  registerListeners(mainWindow);
  registerIPC();
  scheduleChecks();

  log.info('auto-updater initialized');
}
