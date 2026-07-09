import { realpath, lstat, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { BackgroundTask, Chat } from '@qlan-ro/mainframe-types';
import type { BackgroundTaskTracker } from './tracker.js';
import { encodeCwdSegment } from './encoding.js';
import { lsofWriters } from './lsof.js';
import { makeSpoolValidator, type SpoolValidator } from './spool-validator.js';
import { spoolRoot as defaultSpoolRoot } from './spool-root.js';
import { walkSpoolTasks } from './spool-walker.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('background-tasks:reconcile');

export interface ReconcileDeps {
  tracker: BackgroundTaskTracker;
  db: {
    chats: { listAll: () => Chat[] };
    projects: { get: (id: string) => { path: string } | null };
  };
  spoolRoot?: string;
  /** Injected for tests so we don't depend on `process.getuid()` matching CI. */
  validator?: SpoolValidator;
}

export async function reconcileBackgroundTasks(deps: ReconcileDeps): Promise<void> {
  const spoolRoot = deps.spoolRoot ?? defaultSpoolRoot();
  try {
    await reconcileInner(deps, spoolRoot);
  } catch (err) {
    log.warn({ err, spoolRoot }, 'reconcileBackgroundTasks aborted');
  }
}

function buildRecoveredSnapshot(taskId: string, fp: string, st: Stats, writers: number[]): BackgroundTask {
  const running = writers.length > 0;
  return {
    id: taskId,
    kind: 'bash', // only bash tasks spool to disk, so only they can be recovered
    toolName: 'Bash',
    toolUseId: '',
    command: '<recovered>',
    description: '',
    outputPath: fp,
    startedAt: st.ctimeMs,
    endedAt: running ? null : st.mtimeMs,
    status: running ? 'running' : 'stopped',
    lastOutputLine: null,
    summary: running ? null : 'recovered after daemon restart',
    usage: null,
    recovered: true,
  };
}

async function reconcileInner(deps: ReconcileDeps, spoolRoot: string): Promise<void> {
  const sessionToChat = new Map<string, Chat>();
  for (const chat of deps.db.chats.listAll()) {
    if (chat.claudeSessionId && chat.status !== 'archived') {
      sessionToChat.set(chat.claudeSessionId, chat);
    }
  }
  if (sessionToChat.size === 0) return;

  const validator =
    deps.validator ??
    makeSpoolValidator({
      platform: process.platform,
      getuid: typeof process.getuid === 'function' ? process.getuid.bind(process) : undefined,
      env: process.env,
    });

  await walkSpoolTasks({
    root: spoolRoot,
    onTask: async ({ cwdSeg, sess, taskId, fp }) => {
      const chat = sessionToChat.get(sess);
      if (!chat) return;
      const project = deps.db.projects.get(chat.projectId);
      const effectivePath = chat.worktreePath ?? project?.path;
      if (!effectivePath) return;
      let realEffective: string;
      try {
        realEffective = await realpath(effectivePath);
      } catch {
        return;
      }
      if (encodeCwdSegment(realEffective) !== cwdSeg) return;

      if (!(await validator(fp, taskId))) return;

      let st: Stats;
      try {
        const ls = await lstat(fp);
        if (!ls.isFile() || ls.isSymbolicLink()) return;
        st = await stat(fp);
      } catch {
        return;
      }

      const writers = await lsofWriters(fp);
      deps.tracker.adopt(chat.id, buildRecoveredSnapshot(taskId, fp, st, writers), { emit: true });
      if (writers.length > 0) deps.tracker.setPid(chat.id, taskId, writers[0]!);
    },
  });
}
