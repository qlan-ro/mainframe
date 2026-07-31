/**
 * useSessionMentionSource — the batched daemon read behind the `@` picker's
 * session rows (todo #240). AC 17, 19.
 *
 * `resolveSessionTranscripts` is mocked; `regularThreadItemsToSessionItems` is
 * driven through a mocked `useAuiState` thread-list fixture so the candidate
 * set is exactly what the test states, not recomputed from live app state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { TranscriptResolution } from '@qlan-ro/mainframe-types';

const PROJECT = 'proj-1';

let __threadItems: Array<{
  id: string;
  remoteId?: string;
  title?: string;
  status: string;
  custom?: Record<string, unknown>;
}> = [];

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { threads: { threadItems: typeof __threadItems } }) => unknown) =>
    selector({ threads: { threadItems: __threadItems } }),
}));

const resolveSessionTranscriptsSpy = vi.fn<(port: number, chatIds: string[]) => Promise<TranscriptResolution[]>>();

vi.mock('@/lib/api/session-transcripts', () => ({
  resolveSessionTranscripts: (port: number, chatIds: string[]) => resolveSessionTranscriptsSpy(port, chatIds),
}));

import { useSessionMentionSource } from '../use-session-mention-source';

function makeEntry(overrides: {
  remoteId: string;
  title?: string;
  claudeSessionId?: string | null;
  projectId?: string;
  updatedAt?: number;
}) {
  return {
    id: overrides.remoteId,
    remoteId: overrides.remoteId,
    title: overrides.title,
    status: 'regular',
    custom: {
      projectId: overrides.projectId ?? PROJECT,
      adapterId: 'claude',
      claudeSessionId: overrides.claudeSessionId === null ? undefined : (overrides.claudeSessionId ?? 'sess'),
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      transcriptMissing: false,
      updatedAt: overrides.updatedAt ?? 100,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __threadItems = [];
});

describe('useSessionMentionSource — request on mount', () => {
  it('calls resolveSessionTranscripts once on mount with only the candidate ids', async () => {
    __threadItems = [
      makeEntry({ remoteId: 'c1', title: 'One' }),
      makeEntry({ remoteId: 'c2', title: 'Two', claudeSessionId: null }),
    ];
    resolveSessionTranscriptsSpy.mockResolvedValue([{ chatId: 'c1', state: 'resolved', path: '/t/c1.jsonl' }]);

    renderHook(() => useSessionMentionSource({ port: 31415, projectId: PROJECT, activeChatId: null }));

    await waitFor(() => expect(resolveSessionTranscriptsSpy).toHaveBeenCalledTimes(1));
    expect(resolveSessionTranscriptsSpy).toHaveBeenCalledWith(31415, ['c1']);
  });
});

describe('useSessionMentionSource — refresh()', () => {
  it('issues a second call when refresh() is invoked', async () => {
    __threadItems = [makeEntry({ remoteId: 'c1', title: 'One' })];
    resolveSessionTranscriptsSpy.mockResolvedValue([{ chatId: 'c1', state: 'resolved', path: '/t/c1.jsonl' }]);

    const { result } = renderHook(() =>
      useSessionMentionSource({ port: 31415, projectId: PROJECT, activeChatId: null }),
    );
    await waitFor(() => expect(resolveSessionTranscriptsSpy).toHaveBeenCalledTimes(1));

    result.current.refresh();
    await waitFor(() => expect(resolveSessionTranscriptsSpy).toHaveBeenCalledTimes(2));
  });

  it('an out-of-order (slower, earlier) response does not overwrite the newer map', async () => {
    __threadItems = [makeEntry({ remoteId: 'c1', title: 'One' })];

    let resolveFirst!: (value: TranscriptResolution[]) => void;
    const firstResponse = new Promise<TranscriptResolution[]>((resolve) => {
      resolveFirst = resolve;
    });
    resolveSessionTranscriptsSpy
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() =>
        Promise.resolve([{ chatId: 'c1', state: 'unavailable', reason: 'transcript-missing' }]),
      );

    const { result, rerender } = renderHook(() =>
      useSessionMentionSource({ port: 31415, projectId: PROJECT, activeChatId: null }),
    );
    await waitFor(() => expect(resolveSessionTranscriptsSpy).toHaveBeenCalledTimes(1));

    result.current.refresh();
    await waitFor(() => expect(resolveSessionTranscriptsSpy).toHaveBeenCalledTimes(2));

    // The second (newer) request resolves first; the first (older, slower) resolves after.
    resolveFirst([{ chatId: 'c1', state: 'resolved', path: '/t/stale.jsonl' }]);
    await Promise.resolve();
    rerender();

    expect(result.current.pathByChatId.get('c1')).toBeUndefined();
  });
});

describe('useSessionMentionSource — rejection handling', () => {
  it('leaves the previous items in place and logs one tagged console.warn', async () => {
    __threadItems = [makeEntry({ remoteId: 'c1', title: 'One' })];
    resolveSessionTranscriptsSpy.mockResolvedValueOnce([{ chatId: 'c1', state: 'resolved', path: '/t/c1.jsonl' }]);

    const { result, rerender } = renderHook(() =>
      useSessionMentionSource({ port: 31415, projectId: PROJECT, activeChatId: null }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const itemsBefore = result.current.items;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveSessionTranscriptsSpy.mockRejectedValueOnce(new Error('network down'));

    result.current.refresh();
    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1));
    rerender();

    expect(warnSpy).toHaveBeenCalledWith('[session-mentions] transcript resolution failed', expect.any(Error));
    expect(result.current.items).toEqual(itemsBefore);
    warnSpy.mockRestore();
  });
});
