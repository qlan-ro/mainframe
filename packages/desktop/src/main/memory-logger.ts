import type { BrowserWindow } from 'electron';
import { createMainLogger } from './logger.js';

const log = createMainLogger('renderer:perf');

const MEMORY_LOG_INTERVAL_MS = 5 * 60 * 1000;

let memoryLogInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Periodically logs `process.memoryUsage()` from the renderer so we can spot
 * monotonic RSS growth across sessions without attaching DevTools.
 */
export function startRendererMemoryLogger(getWindow: () => BrowserWindow | null): void {
  if (memoryLogInterval) return;
  memoryLogInterval = setInterval(() => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents
      .executeJavaScript('JSON.stringify(process.memoryUsage())', true)
      .then((raw: string) => {
        const usage = JSON.parse(raw) as NodeJS.MemoryUsage;
        log.info(
          {
            rss: usage.rss,
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            external: usage.external,
            arrayBuffers: usage.arrayBuffers,
          },
          'renderer memory snapshot',
        );
      })
      .catch((err) => log.warn({ err: String(err) }, 'renderer memory snapshot failed'));
  }, MEMORY_LOG_INTERVAL_MS);
}

export function stopRendererMemoryLogger(): void {
  if (memoryLogInterval) {
    clearInterval(memoryLogInterval);
    memoryLogInterval = null;
  }
}
