import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
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

  autoUpdater.on('update-available', (info) => {
    log.info({ version: info.version }, 'update available');
    send(mainWindow, { state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('no update available');
    send(mainWindow, { state: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    send(mainWindow, { state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info({ version: info.version }, 'update downloaded');
    send(mainWindow, { state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    const kind = classifyUpdateError(err);
    if (kind === 'transient') {
      // Transient errors (network unavailability, rate limits, server errors) are
      // expected to resolve on the next check cycle — do not surface as an error banner.
      log.warn({ message: err.message, kind }, 'transient update check error (suppressed from UI)');
      return;
    }
    log.error({ message: err.message, kind }, 'persistent update error');
    send(mainWindow, { state: 'error', message: err.message });
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
