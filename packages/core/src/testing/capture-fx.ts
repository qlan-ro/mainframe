// packages/core/src/testing/capture-fx.ts
// Sync git/fs here is intentional and exempt from the "no sync I/O in server code" rule: it runs
// only under E2E_MODE=record (never production) and must capture the working tree at the exact
// point a tool result is recorded. /* expected */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecordedFile } from './recording-format.js';

export interface FxSnapshot {
  files: RecordedFile[];
  deleted: string[];
}

/**
 * Snapshot the project's current working-tree changes (vs git HEAD, including untracked) so replay
 * can reproduce them on disk. Used only at record time. Best-effort: returns empty on any failure.
 */
export function captureProjectFx(projectPath: string): FxSnapshot {
  let out = '';
  try {
    out = execFileSync('git', ['-C', projectPath, 'status', '--porcelain', '--untracked-files=all'], {
      encoding: 'utf8',
    });
  } catch {
    return { files: [], deleted: [] }; /* not a git repo / git unavailable — expected */
  }
  const files: RecordedFile[] = [];
  const deleted: string[] = [];
  for (const line of out.split('\n')) {
    if (line.trim().length === 0) continue;
    const status = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (path.length === 0 || path.includes(' -> ')) continue; // skip renames (rare in test fixtures)
    if (status.includes('D')) {
      deleted.push(path);
      continue;
    }
    try {
      files.push({ path, content: readFileSync(join(projectPath, path), 'utf8') });
    } catch {
      /* unreadable (binary/removed) — skip; expected */
    }
  }
  return { files, deleted };
}
