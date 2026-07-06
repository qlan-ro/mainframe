import type { z } from 'zod';
import { createMainLogger } from './logger.js';

const log = createMainLogger('electron:ipc');

/**
 * Parse an IPC argument against the shared host contract. On failure, logs with
 * context and throws — the rejection surfaces to the renderer's invoke() caller
 * rather than passing malformed input into a privileged handler.
 */
export function parseIpcArg<T>(schema: z.ZodType<T>, value: unknown, channel: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    log.warn({ channel, issues: result.error.issues }, 'ipc arg validation failed');
    throw new Error(`Invalid argument for ${channel}`);
  }
  return result.data;
}
