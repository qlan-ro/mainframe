import { app, BrowserWindow, shell, ipcMain, utilityProcess, Menu } from 'electron';
import type { UtilityProcess } from 'electron';
import { join, resolve, sep } from 'path';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { createMainLogger, logFromRenderer } from './logger.js';

const log = createMainLogger('electron');

const APP_AUTHOR = 'Mainframe Contributors';

// Enable Chrome DevTools Protocol on port 9222 for development tooling (e.g. MCP server).
// Only active in development mode — never exposed in production builds.
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

// Enforce single instance. If the lock is not acquired, another instance is
// already running — quit immediately and let it handle the activation.
const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});

let mainWindow: BrowserWindow | null = null;
let daemon: UtilityProcess | null = null;

// Electron apps launch with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
// Prepend common user-level locations so the daemon can find CLI tools like `claude`
// that are installed outside the system PATH (e.g. ~/.local/bin from the Claude CLI installer).
function buildDaemonPath(): string {
  const base = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin';
  const extra = [`${homedir()}/.local/bin`, '/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin'];
  const seen = new Set(base.split(':'));
  const additions = extra.filter((p) => !seen.has(p));
  return additions.length ? `${additions.join(':')}:${base}` : base;
}

function startDaemon(): void {
  if (process.env.NODE_ENV === 'development') {
    log.info('development mode: daemon assumed external');
    return;
  }

  // MAINFRAME_DAEMON_PATH lets test/dev environments point to a pre-built daemon.cjs directly,
  // bypassing process.resourcesPath which only works in packaged (electron-builder) builds.
  const daemonPath = process.env['MAINFRAME_DAEMON_PATH'] ?? join(process.resourcesPath, 'daemon.cjs');
  log.info({ path: daemonPath }, 'daemon starting');
  daemon = utilityProcess.fork(daemonPath, [], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', PATH: buildDaemonPath() },
  });

  daemon.on('exit', (code) => {
    log.error({ code }, 'daemon exited');
  });
}

function setProductionMenu(): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    log.warn('setProductionMenu: no application menu found');
    return;
  }

  const newItems = menu.items.map((topItem) => {
    if (topItem.label !== 'View' || !topItem.submenu) return topItem;
    return {
      label: 'View',
      submenu: topItem.submenu.items.filter((sub) => sub.role !== 'toggledevtools'),
    };
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(newItems));
}

function setupIPC(): void {
  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    author: APP_AUTHOR,
  }));

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    const normalizedPath = resolve(filePath);
    const home = homedir();
    const dataDir = process.env['MAINFRAME_DATA_DIR'] ?? join(home, '.mainframe');
    const allowedPrefixes = [join(home, '.claude'), join(home, '.mainframe'), dataDir];

    const isAllowed =
      allowedPrefixes.some((prefix) => normalizedPath.startsWith(prefix)) ||
      normalizedPath.includes(`${sep}.mainframe${sep}`);
    if (!isAllowed) {
      log.warn({ path: normalizedPath }, 'ipc blocked file read outside allowed paths');
      return null;
    }

    try {
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      log.warn({ err: error }, 'ipc readFile failed');
      return null;
    }
  });

  ipcMain.on('log', (_event, level: string, module: string, message: string, data?: unknown) => {
    logFromRenderer(level, module, message, data);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#1e1e2e',
    width: 1400,
    height: 900,
    ...(process.platform === 'linux' && {
      icon: join(__dirname, '../../resources/icon.png'),
    }),
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.NODE_ENV !== 'development') {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  log.info('window created');
}

app.whenReady().then(() => {
  log.info({ version: app.getVersion() }, 'app ready');
  setupIPC();
  startDaemon();

  if (process.env.NODE_ENV !== 'development') {
    setProductionMenu();
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (daemon) {
    daemon.kill();
  }
});
