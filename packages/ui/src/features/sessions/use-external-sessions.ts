/**
 * Paged discovery of a project's importable external sessions.
 *
 * The candidate list is unbounded — a long-lived project accumulates thousands
 * of CLI transcripts — so it arrives 50 at a time. The caller attaches
 * `sentinelRef` to a trailing element; that element scrolling into view is what
 * pulls the next page, so nothing is fetched the user never scrolls to.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExternalSession } from '@qlan-ro/mainframe-types';
import { getExternalSessions } from '@/lib/api/external-sessions';

const PAGE = 50;

export interface ExternalSessionsState {
  sessions: ExternalSession[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  retry: () => void;
}

export function useExternalSessions(port: number, projectId: string): ExternalSessionsState {
  const [sessions, setSessions] = useState<ExternalSession[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fetching = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSessions([]);
    setNextOffset(null);
    getExternalSessions(port, projectId, { offset: 0, limit: PAGE })
      .then((page) => {
        if (cancelled) return;
        setSessions(page.sessions);
        setNextOffset(page.nextOffset);
      })
      .catch((e: unknown) => {
        console.warn('[v2/useExternalSessions] page 0 failed', e);
        if (!cancelled) setError('Failed to load sessions.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, attempt]);

  const loadMore = useCallback(() => {
    if (fetching.current || nextOffset === null) return;
    fetching.current = true;
    getExternalSessions(port, projectId, { offset: nextOffset, limit: PAGE })
      .then((page) => {
        setSessions((prev) => [...prev, ...page.sessions]);
        setNextOffset(page.nextOffset);
      })
      .catch((e: unknown) => {
        console.warn('[v2/useExternalSessions] load-more failed', e);
      })
      .finally(() => {
        fetching.current = false;
      });
  }, [port, projectId, nextOffset]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (el === null || nextOffset === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [nextOffset, loadMore]);

  return {
    sessions,
    loading,
    error,
    hasMore: nextOffset !== null,
    sentinelRef,
    retry: () => setAttempt((n) => n + 1),
  };
}
