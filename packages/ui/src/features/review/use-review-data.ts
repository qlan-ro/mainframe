/**
 * use-review-data — the Review panel's view of `useWorkingChanges`: the
 * uncommitted scope, fetched only while the panel is open.
 *
 * The fetching, merging and invalidation all live in the shared hook now; this
 * only adapts its shape to what the review surfaces render.
 */
import { useMemo } from 'react';
import type { ReviewFile } from './git-status-to-files';
import { useWorkingChanges } from './use-working-changes';

interface ReviewData {
  files: ReviewFile[];
  totalAdditions: number;
  totalDeletions: number;
  branch: string | null;
  loadError: boolean;
}

export function useReviewData(open: boolean, port: number, projectId: string | null, chatId?: string): ReviewData {
  const { files, totalAdditions, totalDeletions, branch, error } = useWorkingChanges({
    port,
    projectId,
    chatId,
    scope: 'uncommitted',
    enabled: open,
  });

  return useMemo(
    () => ({
      // Every uncommitted row carries a status and counts, so the fallbacks here
      // are unreachable — they only satisfy the shared shape, which allows the
      // scopes that genuinely have neither.
      files: files.map((file) => ({
        path: file.path,
        status: file.status ?? 'modified',
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
      })),
      totalAdditions: totalAdditions ?? 0,
      totalDeletions: totalDeletions ?? 0,
      branch,
      loadError: error,
    }),
    [files, totalAdditions, totalDeletions, branch, error],
  );
}
