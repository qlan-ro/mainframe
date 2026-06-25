import pino from 'pino';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(process.env['MAINFRAME_DATA_DIR'] ?? join(homedir(), '.mainframe'), 'logs');
const RETENTION_DAYS = 7;
const isDev = process.env.NODE_ENV !== 'production';

function ensureLogDir(): void {
  mkdirSync(LOG_DIR, { recursive: true });
}

function purgeOldLogs(prefix: string): void {
  const cutoffMs = Date.now() - RETENTION_DAYS * 86_400_000;
  try {
    for (const file of readdirSync(LOG_DIR)) {
      if (!file.startsWith(`${prefix}.`)) continue;
      const full = join(LOG_DIR, file);
      try {
        if (statSync(full).mtimeMs < cutoffMs) unlinkSync(full);
      } catch {
        /* ignore individual file errors */
      }
    }
  } catch {
    /* ignore if dir doesn't exist yet */
  }
}

function dailyDestination(prefix: string): pino.DestinationStream {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // minLength: 0 disables sonic-boom buffering so every write reaches the file
  // immediately — critical for crash debugging in packaged/bundled deployments.
  return pino.destination({ dest: join(LOG_DIR, `${prefix}.${date}.log`), append: true, minLength: 0 });
}

// Normalize to lowercase so LOG_LEVEL=DEBUG and LOG_LEVEL=debug are both accepted.
const VALID_PINO_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const rawLevel = process.env.LOG_LEVEL?.trim().toLowerCase() ?? 'info';
const logLevel: pino.Level = VALID_PINO_LEVELS.has(rawLevel) ? (rawLevel as pino.Level) : 'info';

// Lazy initialization — pino streams (SonicBoom) must not be created at import
// time. The single-instance check in index.ts runs before createMainLogger() is
// called; if the second instance exits before pino is initialized, the "sonic
// boom is not ready yet" crash is avoided.
let baseLogger: pino.Logger | null = null;
let baseRendererLogger: pino.Logger | null = null;

function init(): void {
  if (baseLogger) return;

  ensureLogDir();
  purgeOldLogs('desktop-app');

  const pinoOpts: pino.LoggerOptions = {
    level: logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { pid: process.pid },
    formatters: { level: (label) => ({ level: label.toUpperCase() }) },
  };

  // Pass level on stream entries rather than to pino() directly.
  // pino v10 reads customLevels from the multistream object during construction and
  // enables useOnlyCustomLevels, which rejects built-in level names like 'debug'.
  // Setting level post-construction bypasses that check.
  const mainStreams: pino.StreamEntry[] = [{ stream: dailyDestination('desktop-app'), level: logLevel }];
  if (isDev) mainStreams.push({ stream: process.stdout, level: logLevel });

  const rendererStreams: pino.StreamEntry[] = [{ stream: dailyDestination('desktop-app'), level: logLevel }];
  if (isDev) rendererStreams.push({ stream: process.stdout, level: logLevel });

  baseLogger = pino(pinoOpts, pino.multistream(mainStreams));
  baseRendererLogger = pino(pinoOpts, pino.multistream(rendererStreams));

  baseLogger.info({ logLevel, raw: process.env.LOG_LEVEL ?? '(unset)' }, 'logger initialized');
}

export function createMainLogger(module: string) {
  init();
  return baseLogger!.child({ module });
}

export function logFromRenderer(level: string, module: string, message: string, data?: unknown): void {
  init();
  const child = baseRendererLogger!.child({ module });
  const lvl = VALID_PINO_LEVELS.has(level) ? (level as pino.Level) : 'info';
  if (data !== null && data !== undefined && typeof data === 'object') {
    child[lvl](data as Record<string, unknown>, message);
  } else {
    child[lvl](message);
  }
}
