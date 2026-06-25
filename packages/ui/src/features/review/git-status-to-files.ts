/**
 * Pure mapper: GitStatusFile[] (raw XY porcelain codes from the daemon) →
 * ReviewFile[] (semantic statuses for the review UI).
 *
 * Uses the shared `gitStatusKind` helper so there is exactly one canonical
 * XY-porcelain → status-kind conversion in the codebase.
 */
import type { GitStatusFile } from '@/lib/api/git';
import { gitStatusKind } from '@/lib/git-status-kind';

export interface ReviewFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export function gitStatusToFiles(files: GitStatusFile[]): ReviewFile[] {
  return files.map((f) => ({ path: f.path, status: gitStatusKind(f.status) }));
}
