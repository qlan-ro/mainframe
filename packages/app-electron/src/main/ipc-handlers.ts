import { app, BrowserWindow, Notification, ipcMain, session, shell, webContents } from 'electron';
import { join, resolve, sep } from 'path';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import type { Logger } from 'pino';
import {
  ClearSessionSchema,
  FilePathSchema,
  LogRecordSchema,
  NotifySchema,
  OpenExternalSchema,
} from '@qlan-ro/mainframe-types';
import type { DaemonStatusTracker } from './daemon-status.js';
import { logFromRenderer } from './logger.js';
import { parseIpcArg } from './ipc-validate.js';

const APP_AUTHOR = 'Mainframe Contributors';

export interface IpcHandlerDeps {
  log: Logger;
  getMainWindow: () => BrowserWindow | null;
  openExternalSafe: (url: string) => void;
  getDaemonStatus: () => DaemonStatusTracker | null;
}

function isPathAllowed(normalizedPath: string): boolean {
  const home = homedir();
  const dataDir = process.env['MAINFRAME_DATA_DIR'] ?? join(home, '.mainframe');
  const allowedPrefixes = [join(home, '.claude'), join(home, '.mainframe'), dataDir];
  return (
    allowedPrefixes.some((prefix) => normalizedPath.startsWith(prefix)) ||
    normalizedPath.includes(`${sep}.mainframe${sep}`)
  );
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { log, getMainWindow, openExternalSafe, getDaemonStatus } = deps;

  ipcMain.handle('daemon:port', () => getDaemonStatus()?.port() ?? 31415);
  ipcMain.handle('daemon:status', () => getDaemonStatus()?.get() ?? 'initializing');

  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    author: APP_AUTHOR,
    homedir: homedir(),
  }));

  ipcMain.handle('app:getHomedir', () => homedir());

  ipcMain.handle('app:getAuthToken', async () => {
    const home = homedir();
    const dataDir = process.env['MAINFRAME_DATA_DIR'] ?? join(home, '.mainframe');
    const configPath = join(dataDir, 'config.json');
    try {
      const raw = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { authSecret?: unknown };
      return typeof parsed.authSecret === 'string' ? parsed.authSecret : null;
    } catch (err) {
      log.warn({ err }, 'app:getAuthToken read failed');
      return null;
    }
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    const path = parseIpcArg(FilePathSchema, filePath, 'fs:readFile');
    const normalizedPath = resolve(path);
    if (!isPathAllowed(normalizedPath)) {
      log.warn({ path: normalizedPath }, 'ipc blocked file read outside allowed paths');
      return null;
    }
    try {
      return await readFile(path, 'utf-8');
    } catch (error) {
      log.warn({ err: error }, 'ipc readFile failed');
      return null;
    }
  });

  ipcMain.handle('fs:readFileBase64', async (_event, filePath: string) => {
    const path = parseIpcArg(FilePathSchema, filePath, 'fs:readFileBase64');
    const normalizedPath = resolve(path);
    if (!isPathAllowed(normalizedPath)) {
      log.warn({ path: normalizedPath }, 'ipc blocked base64 read outside allowed paths');
      return null;
    }
    try {
      const buf = await readFile(path);
      return buf.toString('base64');
    } catch (error) {
      log.warn({ err: error }, 'ipc readFileBase64 failed');
      return null;
    }
  });

  ipcMain.handle('shell:showItemInFolder', (_event, fullPath: string) => {
    const path = parseIpcArg(FilePathSchema, fullPath, 'shell:showItemInFolder');
    shell.showItemInFolder(path);
  });

  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    parseIpcArg(OpenExternalSchema, url, 'shell:openExternal');
    openExternalSafe(url);
  });

  ipcMain.handle('webview:destroy', (_event, webContentsId: number) => {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) return;
    if (wc.getType() !== 'webview') {
      log.warn({ webContentsId, type: wc.getType() }, 'webview:destroy refused non-webview target');
      return;
    }
    wc.close();
  });

  ipcMain.handle('sandbox:clearSession', async (_event, projectId: string) => {
    const { projectId: id } = parseIpcArg(ClearSessionSchema, { projectId }, 'sandbox:clearSession');
    const partition = `persist:sandbox-${id}`;
    const ses = session.fromPartition(partition);
    await ses.clearStorageData();
    await ses.clearCache();
    log.info({ partition }, 'sandbox session cleared');
  });

  ipcMain.handle('notify:show', (_event, title: string, body?: string) => {
    const payload = parseIpcArg(NotifySchema, { title, body }, 'notify:show');
    log.info(
      { title: payload.title, body: payload.body, supported: Notification.isSupported() },
      'notify:show IPC received',
    );
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: payload.title, body: payload.body ?? undefined });
    const win = getMainWindow();
    n.on('click', () => {
      win?.show();
      win?.focus();
    });
    n.on('show', () => log.info({ title: payload.title }, 'notification shown'));
    n.on('failed', (_, err) => log.error({ title: payload.title, err }, 'notification failed'));
    n.show();
  });

  ipcMain.on('log', (_event, level: string, module: string, message: string, data?: unknown) => {
    const parsed = LogRecordSchema.safeParse({ level, module, message, data });
    if (!parsed.success) {
      log.warn({ issues: parsed.error.issues }, 'ipc log: malformed record dropped');
      return;
    }
    logFromRenderer(parsed.data.level, parsed.data.module, parsed.data.message, parsed.data.data);
  });
}
