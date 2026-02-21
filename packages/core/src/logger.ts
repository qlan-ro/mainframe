import pino from 'pino';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

function buildTransport(level: string): pino.TransportSingleOptions | pino.TransportMultiOptions | undefined {
  const isTest = process.env.NODE_ENV === 'test';
  const isProd = process.env.NODE_ENV === 'production';

  if (isTest) {
    return undefined; // level is 'silent'; no transport needed
  }

  // Compute log directory at call time (not module load time) to avoid
  // triggering homedir() before test mocks are initialized.
  const logDir = join(homedir(), '.mainframe', 'logs');
  mkdirSync(logDir, { recursive: true });

  // pino.transport() builds a pino.multistream in the worker thread, and any target
  // without an explicit `level` defaults to INFO (30) inside that multistream —
  // silently dropping DEBUG/TRACE messages even when the pino instance level is lower.
  // Setting `level` on every target fixes the multistream minimum-level filter.
  const fileTarget: pino.TransportTargetOptions = {
    target: 'pino-roll',
    level,
    options: {
      file: join(logDir, 'daemon.log'),
      frequency: 'daily',
      limit: { count: 7 },
      mkdir: true,
    },
  };

  if (!isProd) {
    return {
      targets: [{ target: 'pino-pretty', level, options: { colorize: true } }, fileTarget],
    };
  }

  return {
    targets: [
      { target: 'pino/file', level, options: { destination: 1 } }, // fd 1 = stdout
      fileTarget,
    ],
  };
}

const VALID_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const rawLevel = process.env.LOG_LEVEL?.trim().toLowerCase() ?? 'info';
const logLevel = process.env.NODE_ENV === 'test' ? 'silent' : VALID_LEVELS.has(rawLevel) ? rawLevel : 'info';

export const logger = pino({
  level: logLevel,
  transport: buildTransport(logLevel),
});

if (process.env.NODE_ENV !== 'test') {
  logger.info({ logLevel, raw: process.env.LOG_LEVEL ?? '(unset)' }, 'logger initialized');
}

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}
