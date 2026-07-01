/**
 * use-review-data — loads the changed-file set (status + per-file stat) and the
 * current branch when the Review panel opens. Merges stat counts into each
 * ReviewFile via gitStatusToFiles. Returns the files, repo-wide totals, branch,
 * and a load-error flag.
 */
import { useEffect, useState } from 'react';
import { getGitStatus, getGitBranch, getWorkingStat } from '@/lib/api/git';
import { gitStatusToFiles, type ReviewFile } from './git-status-to-files';

interface ReviewData {
  files: ReviewFile[];
  totalAdditions: number;
  totalDeletions: number;
  branch: string | null;
  loadError: boolean;
}

const EMPTY: ReviewData = { files: [], totalAdditions: 0, totalDeletions: 0, branch: null, loadError: false };

export function useReviewData(open: boolean, port: number, projectId: string | null, chatId?: string): ReviewData {
  const [data, setData] = useState<ReviewData>(EMPTY);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setData(EMPTY);
    Promise.all([
      getGitStatus(port, projectId, chatId),
      getWorkingStat(port, projectId, chatId).catch(() => undefined),
      getGitBranch(port, projectId, chatId).catch(() => ({ branch: null })),
    ])
      .then(([statusFiles, stat, branchRes]) => {
        if (cancelled) return;
        setData({
          files: gitStatusToFiles(statusFiles, stat),
          totalAdditions: stat?.totalAdditions ?? 0,
          totalDeletions: stat?.totalDeletions ?? 0,
          branch: branchRes.branch,
          loadError: false,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn('[ReviewPanel] failed to load git status', projectId, err);
        setData({ ...EMPTY, loadError: true });
      });
    return () => {
      cancelled = true;
    };
  }, [open, port, projectId, chatId]);

  return data;
}
