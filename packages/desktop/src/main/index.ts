import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { join, resolve } from 'path';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { spawn, ChildProcess } from 'child_process';

const APP_AUTHOR = 'Mainframe Contributors';

// Enable Chrome DevTools Protocol on port 9222 for development tooling (e.g. MCP server).
// Only active in development mode — never exposed in production builds.
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

let mainWindow: BrowserWindow | null = null;
let daemon: ChildProcess | null = null;

function startDaemon(): void {
  if (process.env.NODE_ENV === 'development') {
    console.log('Development mode: assuming daemon is running');
    return;
  }

  const daemonPath = join(__dirname, '../../core/dist/index.js');
  daemon = spawn('node', [daemonPath], {
    stdio: 'inherit',
    detached: false,
  });

  daemon.on('error', (error) => {
    console.error('Daemon error:', error);
  });
}

function setupIPC(): void {
  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    author: APP_AUTHOR,
  }));

  ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Directory',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    const normalizedPath = resolve(filePath);
    const home = homedir();
    const allowedPrefixes = [join(home, '.claude'), join(home, '.mainframe')];

    const isAllowed = allowedPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
    if (!isAllowed) {
      console.error('[ipc] Blocked file read outside allowed dirs:', normalizedPath);
      return null;
    }

    try {
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      console.warn('[ipc] readFile failed:', error);
      return null;
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
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
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    if (process.env.NODE_ENV === 'development') {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  setupIPC();
  startDaemon();
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
