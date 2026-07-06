/**
 * use-recent-files — the N most-recently-changed files for the active project,
 * for the empty Files-surface picker's "Recent" section. Sourced from git status
 * (recently-changed; recently-opened would need tab-history persistence we don't
 * keep). Mirrors use-changes-count's fetch pattern. Empty until loaded / no project.
 */
import { useEffect, useState } from 'react';
import { getGitStatus, type GitStatusFile } from '@/lib/api/git';

export function useRecentFiles(
  port: number,
  projectId: string | null | undefined,
  chatId: string | undefined,
  limit: number,
): GitStatusFile[] {
  const [files, setFiles] = useState<GitStatusFile[]>([]);

  useEffect(() => {
    if (!projectId) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    getGitStatus(port, projectId, chatId)
      .then((all) => {
        if (!cancelled) setFiles(all.slice(0, limit));
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId, limit]);

  return files;
}
