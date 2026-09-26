// @vitest-environment jsdom

/**
 * useParentChat — resolves a fork's parent when it's missing from the
 * sidebar's loaded set entirely (archived or deleted), via one cached
 * `GET /api/chats/:id` per parent id.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Chat } from '@qlan-ro/mainframe-types';

const getChatMock = vi.fn<(port: number, id: string) => Promise<Chat>>();

vi.mock('@/lib/api/chats', () => ({
  getChat: (port: number, id: string) => getChatMock(port, id),
}));

import { ApiRequestError } from '@/lib/api/http';
import { DaemonPortProvider } from '../runtime/daemon-port-context';
import { __resetParentChatCacheForTests, useParentChat } from '../use-parent-chat';

function wrapper({ children }: { children: ReactNode }) {
  return <DaemonPortProvider port={31415}>{children}</DaemonPortProvider>;
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'parent-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

beforeEach(() => {
  getChatMock.mockReset();
  __resetParentChatCacheForTests();
});

describe('useParentChat', () => {
  it('returns undefined for a null parent id and never fetches', () => {
    const { result } = renderHook(() => useParentChat(null), { wrapper });
    expect(result.current).toBeUndefined();
    expect(getChatMock).not.toHaveBeenCalled();
  });

  it('resolves archived, carrying the parent title', async () => {
    getChatMock.mockResolvedValue(chat({ status: 'archived', title: 'Old Idea' }));
    const { result } = renderHook(() => useParentChat('parent-1'), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toEqual({ kind: 'archived', title: 'Old Idea' });
  });

  it('resolves deleted on a 404', async () => {
    getChatMock.mockRejectedValue(new ApiRequestError('not found', [], 404));
    const { result } = renderHook(() => useParentChat('parent-1'), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toEqual({ kind: 'deleted' });
  });

  it('fetches a given parent id only once across multiple hook instances', async () => {
    getChatMock.mockResolvedValue(chat({ status: 'archived' }));
    const { result: a } = renderHook(() => useParentChat('parent-1'), { wrapper });
    const { result: b } = renderHook(() => useParentChat('parent-1'), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getChatMock).toHaveBeenCalledTimes(1);
    expect(a.current).toEqual({ kind: 'archived', title: undefined });
    expect(b.current).toEqual({ kind: 'archived', title: undefined });
  });
});
