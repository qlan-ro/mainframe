import { app, BrowserWindow, session, shell, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { ALLOWED_EXTERNAL_SCHEMES } from '@qlan-ro/mainframe-types';
import { createMainLogger } from './logger.js';
import { setupTerminalIPC, killAllTerminals } from './terminal-manager.js';
import { initAutoUpdater } from './auto-updater.js';
import { startIdleReporter, stopIdleReporter } from './idle-reporter.js';
import { startRendererMemoryLogger, stopRendererMemoryLogger } from './memory-logger.js';
import { buildApplicationMenu } from './menu.js';
import { setupWebviewSandbox } from './sandbox.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { DaemonStatusTracker } from './daemon-status.js';

// Enable Chrome DevTools Protocol on port 9222 for development tooling (e.g. MCP server).
// Only active in development mode — never exposed in production builds. Skipped under e2e
// (MF_E2E=1): the fixed 9222 collides when the harness launches Electron instances in quick
// succession (each waits on, then fails to bind, the busy port), making suite runs flaky.
if (process.env.NODE_ENV === 'development' && process.env.MF_E2E !== '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

const log = createMainLogger('electron');

const DAEMON_PORT = Number(process.env['DAEMON_PORT'] ?? process.env['VITE_DAEMON_HTTP_PORT'] ?? '31415');

let mainWindow: BrowserWindow | null = null;
let daemon: UtilityProcess | null = null;
let daemonStatus: DaemonStatusTracker | null = null;

// Derived from the canonical ALLOWED_EXTERNAL_SCHEMES in @qlan-ro/mainframe-types.
// url.protocol returns scheme with a trailing colon (e.g. "https:"), so we append one.
const ALLOWED_SCHEMES = new Set(ALLOWED_EXTERNAL_SCHEMES.map((s) => `${s}:`));

function openExternalSafe(url: string): void {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      log.warn({ url }, 'blocked openExternal with disallowed scheme');
      return;
    }
    shell.openExternal(url);
  } catch {
    log.warn({ url }, 'blocked openExternal with invalid URL');
  }
}

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

function startDaemon(shellEnv: Record<string, string>): void {
  if (process.env.NODE_ENV === 'development') {
    log.info('development mode: daemon assumed external');
    daemonStatus?.set('ready');
    return;
  }

  // MAINFRAME_DAEMON_PATH lets test/dev environments point to a pre-built daemon.cjs directly,
  // bypassing process.resourcesPath which only works in packaged (electron-builder) builds.
  const daemonPath = process.env['MAINFRAME_DAEMON_PATH'] ?? join(process.resourcesPath, 'daemon.cjs');
  log.info({ path: daemonPath }, 'daemon starting');
  daemon = utilityProcess.fork(daemonPath, [], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', ...shellEnv },
  });

  daemonStatus?.set('starting');
  daemon.on('spawn', () => daemonStatus?.set('ready'));
  daemon.on('exit', (code) => {
    log.error({ code }, 'daemon exited');
    daemonStatus?.set('stopped');
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
    openExternalSafe(details.url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appOrigin = new URL(mainWindow!.webContents.getURL()).origin;
    if (new URL(url).origin !== appOrigin) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });

  // Capture renderer crashes (blank-screen bugs leave no other trace — the React
  // ErrorBoundary only catches render errors, not process-level crashes like OOM
  // or GPU-killed). Log the reason so we can diagnose recurring cases.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const wc = mainWindow?.webContents;
    // rendererPid matches the `pid` field in ~/Library/Logs/DiagnosticReports/*.ips,
    // so the next crash self-correlates with its crashpad report.
    log.error(
      {
        reason: details.reason,
        exitCode: details.exitCode,
        url: wc?.getURL(),
        rendererPid: wc?.getOSProcessId(),
        appUptimeSec: Math.round(process.uptime()),
        rss: process.memoryUsage().rss,
        crashDumpsDir: app.getPath('crashDumps'),
      },
      'renderer process gone',
    );
  });

  if (process.env.NODE_ENV !== 'development') {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  // Point the window at the app-tauri renderer.
  // Dev: load from the app-tauri Vite dev server (port 5174, strictPort).
  // Prod: load from the bundled app-tauri dist (copied to extraResources by electron-builder).
  // Note: APP_TAURI_RENDERER_URL overrides the default for non-standard setups.
  const APP_TAURI_DEV_URL = process.env['APP_TAURI_RENDERER_URL'] ?? 'http://localhost:5174';
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(APP_TAURI_DEV_URL);
  } else {
    mainWindow.loadFile(join(process.resourcesPath, 'app-tauri-renderer', 'index.html'));
  }

  log.info('window created');
}

app.whenReady().then(() => {
  log.info({ version: app.getVersion() }, 'app ready');

  // Deny media/sensor permissions — the app doesn't need camera, mic, etc.
  // Prevents macOS from prompting for Apple Music, microphone, or camera access
  // when user projects loaded in the preview webview request these APIs.
  const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'notifications']);
  const denyUnneededPermissions = (
    _wc: Electron.WebContents,
    permission: string,
    callback: (granted: boolean) => void,
  ): void => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  };
  session.defaultSession.setPermissionRequestHandler(denyUnneededPermissions);

  // Inject a runtime CSP so the renderer can reach the daemon on 31415 and the
  // app-tauri dev server on 5174. Using onHeadersReceived avoids a build-time
  // fork between Electron and Tauri builds — app-tauri's index.html carries no
  // CSP meta tag, so this is the sole enforcement point on Electron/Chromium.
  const connectSources = [
    `http://127.0.0.1:${DAEMON_PORT}`,
    `ws://127.0.0.1:${DAEMON_PORT}`,
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:5174', 'ws://localhost:5174'] : []),
  ].join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${connectSources}`,
    "font-src 'self' data:",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    });
  });

  const shellEnv = resolveShellEnv();
  daemonStatus = new DaemonStatusTracker(DAEMON_PORT);
  registerIpcHandlers({ log, getMainWindow: () => mainWindow, openExternalSafe, getDaemonStatus: () => daemonStatus });
  startDaemon(shellEnv);
  setupTerminalIPC(shellEnv);

  buildApplicationMenu(() => mainWindow);

  createWindow();

  daemonStatus.subscribe((s) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('daemon:status', s);
    }
  });

  startIdleReporter();
  startRendererMemoryLogger(() => mainWindow);

  if (mainWindow) initAutoUpdater(mainWindow);

  setupWebviewSandbox(denyUnneededPermissions, openExternalSafe);

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

app.on('before-quit', () => {
  stopRendererMemoryLogger();
});

app.on('quit', () => {
  stopIdleReporter();
  killAllTerminals();
  if (daemon) {
    daemon.kill();
  }
});
