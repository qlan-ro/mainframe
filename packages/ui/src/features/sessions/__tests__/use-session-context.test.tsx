import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

const getSessionContext = vi.fn();
const useActiveIdentity = vi.fn();
let emit: (e: DaemonEvent) => void = () => {};

vi.mock('@/lib/api/context', () => ({ getSessionContext: (...a: unknown[]) => getSessionContext(...a) }));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/use-active-identity', () => ({ useActiveIdentity: () => useActiveIdentity() }));
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (handler: (e: DaemonEvent) => void) => {
      emit = handler;
      return () => {};
    },
  },
}));

import { useSessionContext } from '../use-session-context';

const EMPTY = {
  globalFiles: [],
  projectFiles: [],
  mentions: [],
  attachments: [],
  modifiedFiles: [],
  skillFiles: [],
};

beforeEach(() => {
  getSessionContext.mockReset().mockResolvedValue(EMPTY);
  useActiveIdentity.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSessionContext', () => {
  it('fetches context for the active chat', () => {
    useActiveIdentity.mockReturnValue({ projectName: 'X', chatId: 'chat-1' });
    renderHook(() => useSessionContext());
    // fetchContext runs synchronously in the mount effect.
    expect(getSessionContext).toHaveBeenCalledWith(31415, 'chat-1');
  });

  it('refetches (debounced) only on a context.updated for the active chat', () => {
    useActiveIdentity.mockReturnValue({ projectName: 'X', chatId: 'chat-1' });
    renderHook(() => useSessionContext());
    expect(getSessionContext).toHaveBeenCalledTimes(1);

    act(() => emit({ type: 'context.updated', chatId: 'other' } as DaemonEvent));
    act(() => vi.advanceTimersByTime(600));
    expect(getSessionContext).toHaveBeenCalledTimes(1);

    act(() => emit({ type: 'context.updated', chatId: 'chat-1' } as DaemonEvent));
    act(() => vi.advanceTimersByTime(600));
    expect(getSessionContext).toHaveBeenCalledTimes(2);
  });
});
