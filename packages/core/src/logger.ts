import pino from 'pino';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const RETENTION_DAYS = 7;

// Computed lazily so vi.mock('node:os') in tests can intercept homedir()
// without triggering a TDZ error from module-level evaluation.
let _logDir: string | undefined;
function logDir(): string {
  return (_logDir ??= join(homedir(), '.mainframe', 'logs'));
}

function ensureLogDir(): void {
  mkdirSync(logDir(), { recursive: true });
}

function purgeOldLogs(): void {
  const cutoffMs = Date.now() - RETENTION_DAYS * 86_400_000;
  try {
    for (const file of readdirSync(logDir())) {
      if (!file.startsWith('server.')) continue;
      const full = join(logDir(), file);
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

function dailyDestination(): pino.DestinationStream {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // minLength: 0 disables sonic-boom buffering so every write reaches the file
  // immediately — critical for crash debugging in packaged/bundled deployments.
  return pino.destination({ dest: join(logDir(), `server.${date}.log`), append: true, minLength: 0 });
}

const VALID_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const rawLevel = process.env.LOG_LEVEL?.trim().toLowerCase() ?? 'info';
const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';
const logLevel: pino.Level = VALID_LEVELS.has(rawLevel) ? (rawLevel as pino.Level) : 'info';

if (!isTest) {
  ensureLogDir();
  purgeOldLogs();
}

// Use pino.multistream() with plain writable streams — pino.transport() spawns a
// worker thread and resolves transport targets by package name at runtime, which
// fails when the daemon is bundled into a single CJS file by esbuild.
const streams: pino.StreamEntry[] = isTest
  ? []
  : [
      { stream: dailyDestination(), level: logLevel },
      ...(!isProd ? [{ stream: process.stdout as NodeJS.WritableStream, level: logLevel }] : []),
    ];

export const logger = isTest
  ? pino({ level: 'silent' })
  : pino(
      {
        level: logLevel,
        timestamp: pino.stdTimeFunctions.isoTime,
        base: { pid: process.pid },
        formatters: { level: (label) => ({ level: label.toUpperCase() }) },
      },
      pino.multistream(streams),
    );

if (!isTest) {
  logger.info({ logLevel, raw: process.env.LOG_LEVEL ?? '(unset)' }, 'logger initialized');
}

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}
