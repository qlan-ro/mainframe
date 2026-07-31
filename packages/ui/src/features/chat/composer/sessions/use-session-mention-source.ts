'use client';

/**
 * useSessionMentionSource — the `@` picker's session rows plus the transcript
 * path each one resolved to (todo #240).
 *
 * Resolution is a batched daemon read, not a per-row lookup: offerability is
 * settled before the popover draws, so every visible row is actionable. The
 * request fires on mount and whenever the candidate set changes, and
 * `refresh()` lets the composer re-ask when the popover opens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import type { TranscriptResolution } from '@qlan-ro/mainframe-types';
import type { TriggerItem } from '@/components/trigger-engine/types';
import { regularThreadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { resolveSessionTranscripts } from '@/lib/api/session-transcripts';
import { buildSessionMentionItems, sessionResolutionCandidates } from './build-session-mention-items';

export interface SessionMentionSource {
  items: TriggerItem[];
  pathByChatId: ReadonlyMap<string, string>;
  refresh: () => void;
}

const NO_RESOLUTIONS: ReadonlyMap<string, TranscriptResolution> = new Map();
const NO_IDS: string[] = [];

export function useSessionMentionSource(args: {
  port: number | null;
  projectId: string | null;
  activeChatId: string | null;
}): SessionMentionSource {
  const { port, projectId, activeChatId } = args;
  // Select the stable store array, derive outside the selector — a derived
  // array inside it returns a fresh reference every read and loops getSnapshot.
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const sessions = useMemo(() => regularThreadItemsToSessionItems(threadItems), [threadItems]);

  // Round-tripped through a joined key so the array's IDENTITY changes only when
  // its CONTENTS do — every thread-list update reprojects `sessions`, and an
  // identity-churning dep would re-fire the request on each one. Chat ids match
  // `^[a-zA-Z0-9_-]+$`, so `,` can never appear inside one.
  const candidateKey = useMemo(
    () =>
      sessionResolutionCandidates({ sessions, projectId, activeChatId })
        .map((c) => c.chatId)
        .join(','),
    [sessions, projectId, activeChatId],
  );
  const candidateIds = useMemo(() => (candidateKey === '' ? NO_IDS : candidateKey.split(',')), [candidateKey]);

  const [resolutions, setResolutions] = useState<ReadonlyMap<string, TranscriptResolution>>(NO_RESOLUTIONS);
  const requestToken = useRef(0);

  const refresh = useCallback(() => {
    if (port == null || candidateIds.length === 0) return;
    const token = (requestToken.current += 1);
    resolveSessionTranscripts(port, candidateIds).then(
      (list) => {
        if (token !== requestToken.current) return; // a newer request already answered
        setResolutions(new Map(list.map((r) => [r.chatId, r])));
      },
      (err: unknown) => {
        console.warn('[session-mentions] transcript resolution failed', err);
      },
    );
  }, [port, candidateIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return useMemo(() => {
    const { items, pathByChatId } = buildSessionMentionItems({ sessions, projectId, activeChatId, resolutions });
    return { items, pathByChatId, refresh };
  }, [sessions, projectId, activeChatId, resolutions, refresh]);
}
