import { app, BrowserWindow, dialog, session, shell, ipcMain, utilityProcess, Menu } from 'electron';
import type { UtilityProcess } from 'electron';
import { join, resolve, sep } from 'path';
import { execFileSync } from 'child_process';
import { readFile } from 'fs/promises';
import { homedir } from 'os';

const APP_AUTHOR = 'Mainframe Contributors';

// Enable Chrome DevTools Protocol on port 9222 for development tooling (e.g. MCP server).
// Only active in development mode — never exposed in production builds.
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

// Enforce single instance — must run before pino is initialized.
// If pino's exit handler runs before its stream is ready, it throws
// "sonic boom is not ready yet" and shows an error dialog.
const skipLock = process.env.NODE_ENV === 'development' || process.env.MAINFRAME_ALLOW_MULTI === '1';
if (!skipLock) {
  const instanceLock = app.requestSingleInstanceLock();
  if (!instanceLock) {
    dialog.showMessageBoxSync({ type: 'info', message: 'Mainframe is already running.' });
    process.exit(0);
  }
}

// Safe to initialize pino now — we are the primary instance.
import { createMainLogger, logFromRenderer } from './logger.js';

const log = createMainLogger('electron');

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});

let mainWindow: BrowserWindow | null = null;
let daemon: UtilityProcess | null = null;

// Electron apps launch with a minimal environment (/usr/bin:/bin:/usr/sbin:/sbin PATH,
// no JAVA_HOME, etc.). Resolve the user's full login-shell environment so the daemon
// can find CLI tools installed via nvm, sdkman, homebrew, etc.
function resolveShellEnv(): Record<string, string> {
  try {
    const userShell = process.env.SHELL || '/bin/zsh';
    const result = execFileSync(userShell, ['-lic', 'env'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    const env: Record<string, string> = {};
    for (const line of result.split('\n')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      env[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
    }
    if (env['PATH']) return env;
  } catch (err) {
    log.warn({ err }, 'failed to resolve shell env, using fallback');
  }
  // Fallback: at least add common user-level PATH locations
  const fallback = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin';
  const extra = [`${homedir()}/.local/bin`, '/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin'];
  const seen = new Set(fallback.split(':'));
  const additions = extra.filter((p) => !seen.has(p));
  return { PATH: additions.length ? `${additions.join(':')}:${fallback}` : fallback };
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
    env: { ...process.env, NODE_ENV: 'production', ...resolveShellEnv() },
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

  ipcMain.handle('shell:showItemInFolder', (_event, fullPath: string) => {
    shell.showItemInFolder(fullPath);
  });

  const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
        log.warn({ url }, 'blocked openExternal with disallowed scheme');
        return;
      }
      return shell.openExternal(url);
    } catch {
      log.warn({ url }, 'blocked openExternal with invalid URL');
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
      plugins: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.showInactive();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appOrigin = new URL(mainWindow!.webContents.getURL()).origin;
    if (new URL(url).origin !== appOrigin) {
      event.preventDefault();
      shell.openExternal(url);
    }
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

  // Deny media/sensor permissions — the app doesn't need camera, mic, etc.
  // Prevents macOS from prompting for Apple Music, microphone, or camera access
  // when user projects loaded in the preview webview request these APIs.
  const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'notifications']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });

  setupIPC();
  startDaemon();

  if (process.env.NODE_ENV !== 'development') {
    setProductionMenu();
  }

  createWindow();

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    contents.on('will-navigate', (event, url) => {
      const currentOrigin = new URL(contents.getURL()).origin;
      if (new URL(url).origin !== currentOrigin) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

    contents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });
  });

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
