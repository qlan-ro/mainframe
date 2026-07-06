/**
 * use-changes-count — returns the number of uncommitted changes for the active
 * project. Used by InspectorPane to show a live badge on the "Changes" tab.
 * Returns 0 when no project is active or data hasn't loaded yet.
 */
import { useEffect, useState } from 'react';
import { getGitStatus } from '@/lib/api/git';

export function useChangesCount(port: number, projectId: string | null | undefined, chatId?: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!projectId) {
      setCount(0);
      return;
    }
    let cancelled = false;
    getGitStatus(port, projectId, chatId)
      .then((files) => {
        if (!cancelled) setCount(files.length);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId]);

  return count;
}
