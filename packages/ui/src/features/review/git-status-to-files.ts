/**
 * Pure mapper: GitStatusFile[] (raw XY porcelain codes from the daemon) →
 * ReviewFile[] (semantic statuses for the review UI), merging per-file
 * addition/deletion counts from the working stat when provided.
 *
 * Uses the shared `gitStatusKind` helper so there is exactly one canonical
 * XY-porcelain → status-kind conversion in the codebase.
 */
import type { GitStatusFile } from '@/lib/api/git';
import type { WorkingStat } from '@qlan-ro/mainframe-types';
import { gitStatusKind } from '@/lib/git-status-kind';

export interface ReviewFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export function gitStatusToFiles(files: GitStatusFile[], stat?: WorkingStat): ReviewFile[] {
  const counts = new Map(stat?.files.map((f) => [f.path, f]) ?? []);
  return files.map((f) => {
    const c = counts.get(f.path);
    return {
      path: f.path,
      status: gitStatusKind(f.status),
      additions: c?.additions ?? 0,
      deletions: c?.deletions ?? 0,
    };
  });
}
