import { app, type BrowserWindow } from 'electron';
import { createMainLogger } from './logger.js';
import { selectRendererMemory } from './renderer-memory.js';

const log = createMainLogger('renderer:perf');

const MEMORY_LOG_INTERVAL_MS = 5 * 60 * 1000;

let memoryLogInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Periodically logs the renderer process's memory so we can spot monotonic
 * growth across sessions without attaching DevTools. Read from the main
 * process via `app.getAppMetrics()` — the renderer has `contextIsolation`
 * and no `nodeIntegration`, so `process` is not available there.
 */
export function startRendererMemoryLogger(getWindow: () => BrowserWindow | null): void {
  if (memoryLogInterval) return;
  memoryLogInterval = setInterval(() => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    try {
      const osPid = win.webContents.getOSProcessId();
      const memory = selectRendererMemory(osPid, app.getAppMetrics());
      if (!memory) {
        log.warn({ osPid }, 'renderer process not found in app metrics');
        return;
      }
      log.info(
        {
          osPid,
          workingSetSizeKb: memory.workingSetSize,
          peakWorkingSetSizeKb: memory.peakWorkingSetSize,
          privateBytesKb: memory.privateBytes,
        },
        'renderer memory snapshot',
      );
    } catch (err) {
      log.warn({ err: String(err) }, 'renderer memory snapshot failed');
    }
  }, MEMORY_LOG_INTERVAL_MS);
}

export function stopRendererMemoryLogger(): void {
  if (memoryLogInterval) {
    clearInterval(memoryLogInterval);
    memoryLogInterval = null;
  }
}
