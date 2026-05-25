import { Router, Request, Response } from 'express';
import { stat, open } from 'node:fs/promises';
import { z } from 'zod';
import { BackgroundTaskTracker } from '../../background-tasks/tracker.js';
import { killBackgroundTask, type SessionLike } from '../../background-tasks/kill.js';
import { makeSpoolValidator, type SpoolValidator } from '../../background-tasks/spool-validator.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger('routes:background-tasks');

const Params = z.object({
  chatId: z.string().min(1),
  taskId: z.string().min(1).optional(),
});

const OutputQuery = z.object({
  bytes: z.coerce
    .number()
    .int()
    .positive()
    .max(1024 * 1024)
    .optional(),
});

const MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_READ_BYTES = 8 * 1024;

export interface BackgroundTaskRoutesDeps {
  tracker: BackgroundTaskTracker;
  sessionForChat: (chatId: string) => SessionLike | null;
  validator?: SpoolValidator;
  killImpl?: typeof killBackgroundTask;
}

function defaultValidator(): SpoolValidator {
  return makeSpoolValidator({
    platform: process.platform,
    getuid: typeof process.getuid === 'function' ? process.getuid.bind(process) : undefined,
    env: process.env,
  });
}

function makeListHandler(tracker: BackgroundTaskTracker) {
  return (req: Request, res: Response): void => {
    const parsed = Params.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json({ tasks: tracker.list(parsed.data.chatId) });
  };
}

async function readTail(outputPath: string, maxBytes: number): Promise<Buffer> {
  const st = await stat(outputPath);
  const start = Math.max(0, st.size - maxBytes);
  const length = st.size - start;
  const buf = Buffer.alloc(length);
  const fh = await open(outputPath, 'r');
  try {
    await fh.read(buf, 0, length, start);
    return buf;
  } finally {
    await fh.close().catch((err) => log.warn({ err }, 'failed to close spool fd'));
  }
}

function makeOutputHandler(tracker: BackgroundTaskTracker, validator: SpoolValidator) {
  return async (req: Request, res: Response): Promise<void> => {
    const p = Params.safeParse(req.params);
    const q = OutputQuery.safeParse(req.query);
    if (!p.success || !q.success || !p.data.taskId) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const task = tracker.get(p.data.chatId, p.data.taskId);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (task.outputPath === null) {
      res.status(409).json({ reason: 'no_output' });
      return;
    }
    const valid = await validator(task.outputPath, task.id);
    if (!valid) {
      log.warn(
        { chatId: p.data.chatId, taskId: p.data.taskId, outputPath: task.outputPath },
        'spool-root validation failed',
      );
      res.status(409).json({ reason: 'invalid_path' });
      return;
    }
    const maxBytes = Math.min(q.data.bytes ?? DEFAULT_READ_BYTES, MAX_READ_BYTES);
    try {
      const buf = await readTail(task.outputPath, maxBytes);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(buf.toString('utf-8'));
    } catch (err) {
      log.warn({ err, outputPath: task.outputPath }, 'failed to read spool file');
      res.status(500).json({ error: 'read failed' });
    }
  };
}

function makeKillHandler(
  tracker: BackgroundTaskTracker,
  sessionForChat: (chatId: string) => SessionLike | null,
  killImpl: typeof killBackgroundTask,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const p = Params.safeParse(req.params);
    if (!p.success || !p.data.taskId) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const task = tracker.get(p.data.chatId, p.data.taskId);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    const session = sessionForChat(p.data.chatId);
    if (!session) {
      res.status(503).json({ error: 'no active session for chat' });
      return;
    }
    const result = await killImpl({ chatId: p.data.chatId, taskId: p.data.taskId, session, tracker });
    if (result.ok) res.status(204).end();
    else res.status(502).json({ error: result.error });
  };
}

export function backgroundTaskRoutes(deps: BackgroundTaskRoutesDeps): Router {
  const router = Router();
  const validator = deps.validator ?? defaultValidator();
  const killImpl = deps.killImpl ?? killBackgroundTask;

  router.get('/api/chats/:chatId/background-tasks', makeListHandler(deps.tracker));
  router.get('/api/chats/:chatId/background-tasks/:taskId/output', makeOutputHandler(deps.tracker, validator));
  router.post(
    '/api/chats/:chatId/background-tasks/:taskId/kill',
    makeKillHandler(deps.tracker, deps.sessionForChat, killImpl),
  );

  return router;
}
