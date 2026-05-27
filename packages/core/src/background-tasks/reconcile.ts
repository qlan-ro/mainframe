import { readdir, realpath, lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Chat } from '@qlan-ro/mainframe-types';
import type { BackgroundTaskTracker } from './tracker.js';
import { encodeCwdSegment } from './encoding.js';
import { lsofWriters } from './lsof.js';
import { makeSpoolValidator, type SpoolValidator } from './spool-validator.js';
import { spoolRoot as defaultSpoolRoot } from './spool-root.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('background-tasks:reconcile');
const TASK_ID_RE = /^[a-z0-9]{6,16}$/;

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

  let cwdSegs: string[];
  try {
    cwdSegs = await readdir(spoolRoot);
  } catch {
    return;
  }

  for (const cwdSeg of cwdSegs) {
    let sessDirs: string[];
    try {
      sessDirs = await readdir(path.join(spoolRoot, cwdSeg));
    } catch {
      continue;
    }
    for (const sess of sessDirs) {
      const chat = sessionToChat.get(sess);
      if (!chat) continue;

      const project = deps.db.projects.get(chat.projectId);
      const effectivePath = chat.worktreePath ?? project?.path;
      if (!effectivePath) continue;
      let realEffective: string;
      try {
        realEffective = await realpath(effectivePath);
      } catch {
        continue;
      }
      if (encodeCwdSegment(realEffective) !== cwdSeg) continue;

      const tasksDir = path.join(spoolRoot, cwdSeg, sess, 'tasks');
      let files: string[];
      try {
        files = await readdir(tasksDir);
      } catch {
        continue;
      }

      for (const f of files) {
        if (!f.endsWith('.output')) continue;
        const taskId = f.slice(0, -'.output'.length);
        if (!TASK_ID_RE.test(taskId)) continue;
        const fp = path.join(tasksDir, f);

        if (!(await validator(fp, taskId))) continue;

        let ls, st;
        try {
          ls = await lstat(fp);
          if (!ls.isFile() || ls.isSymbolicLink()) continue;
          st = await stat(fp);
        } catch {
          continue;
        }

        const writers = await lsofWriters(fp);
        const running = writers.length > 0;

        deps.tracker.adopt(chat.id, {
          id: taskId,
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
        });
        if (running) deps.tracker.setPid(chat.id, taskId, writers[0]!);
      }
    }
  }
}
