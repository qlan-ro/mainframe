/**
 * use-sessions-thread-list — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - useSessionsThreadList() calls useRemoteThreadListRuntime exactly once with
 *    runtimeHook === useChatRuntimeHook (toBe) and the sentinel adapter from
 *    makeChatsRemoteAdapter.
 *  - makeChatsRemoteAdapter is called with 31415 (the port from context).
 *  - The adapter identity is stable across re-renders (useMemo([port])):
 *    re-render calls makeChatsRemoteAdapter only once for the same port.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------

const SENTINEL_RUNTIME = Symbol('sentinel-runtime');
const SENTINEL_ADAPTER = Symbol('sentinel-adapter');

// ---------------------------------------------------------------------------
// Mocks — hoisted so vi.mock factories run before imports
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useRemoteThreadListRuntime: vi.fn(() => SENTINEL_RUNTIME),
}));

vi.mock('../chats-remote-adapter', () => ({
  makeChatsRemoteAdapter: vi.fn(() => SENTINEL_ADAPTER),
}));

vi.mock('../use-chat-runtime-hook', () => ({
  useChatRuntimeHook: vi.fn(),
}));

vi.mock('../daemon-port-context', () => ({
  useDaemonPort: vi.fn(() => 31415),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { useRemoteThreadListRuntime } from '@assistant-ui/react';
import { makeChatsRemoteAdapter } from '../chats-remote-adapter';
import { useChatRuntimeHook } from '../use-chat-runtime-hook';
import { useSessionsThreadList } from '../use-sessions-thread-list';

const mockUseRemoteThreadListRuntime = vi.mocked(useRemoteThreadListRuntime);
const mockMakeChatsRemoteAdapter = vi.mocked(makeChatsRemoteAdapter);

// ---------------------------------------------------------------------------
// Reset mocks between cases
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockMakeChatsRemoteAdapter.mockReturnValue(SENTINEL_ADAPTER as unknown as ReturnType<typeof makeChatsRemoteAdapter>);
  mockUseRemoteThreadListRuntime.mockReturnValue(
    SENTINEL_RUNTIME as unknown as ReturnType<typeof useRemoteThreadListRuntime>,
  );
});

// ---------------------------------------------------------------------------
// 1. useRemoteThreadListRuntime receives runtimeHook === useChatRuntimeHook
// ---------------------------------------------------------------------------

describe('use-sessions-thread-list — runtimeHook is useChatRuntimeHook', () => {
  it('calls useRemoteThreadListRuntime exactly once with runtimeHook === useChatRuntimeHook (toBe)', () => {
    renderHook(() => useSessionsThreadList());

    expect(mockUseRemoteThreadListRuntime).toHaveBeenCalledTimes(1);
    const opts = mockUseRemoteThreadListRuntime.mock.calls[0]?.[0];
    expect(opts?.runtimeHook).toBe(useChatRuntimeHook);
  });
});

// ---------------------------------------------------------------------------
// 3. makeChatsRemoteAdapter is called with port 31415
// ---------------------------------------------------------------------------

describe('use-sessions-thread-list — makeChatsRemoteAdapter receives the daemon port', () => {
  it('calls makeChatsRemoteAdapter with 31415 (the port from useDaemonPort)', () => {
    renderHook(() => useSessionsThreadList());

    expect(mockMakeChatsRemoteAdapter).toHaveBeenCalledWith(31415);
  });
});

// ---------------------------------------------------------------------------
// 4. Adapter identity is stable across re-renders (useMemo([port]))
// ---------------------------------------------------------------------------

describe('use-sessions-thread-list — adapter is memoized by port', () => {
  it('calls makeChatsRemoteAdapter only once when re-rendered with the same port', () => {
    const { rerender } = renderHook(() => useSessionsThreadList());
    rerender();

    expect(mockMakeChatsRemoteAdapter).toHaveBeenCalledTimes(1);
  });
});
