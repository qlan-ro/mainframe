/**
 * use-chat-runtime-hook — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - chatId is item.id (stable, not remoteId): __LOCALID_x with remoteId 'chat-5'
 *    → registry keyed by '__LOCALID_x', NOT 'chat-5'.
 *  - active derivation (true): item.id === mainThreadId AND item.remoteId != null → active:true.
 *  - active derivation (false, different mainThreadId): active:false.
 *  - active derivation (false, no remoteId): __LOCALID with no remoteId → active:false even when main.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Sentinel objects for distinguishing call args / return values
// ---------------------------------------------------------------------------

const SENTINEL_RUNTIME = Symbol('sentinel-runtime');
const FAKE_CONTROLLER = Symbol('fake-controller');

// ---------------------------------------------------------------------------
// Mocks — hoisted so vi.mock calls run before imports
// ---------------------------------------------------------------------------

// State shape that useAuiState selector receives: { threadListItem, threads: { mainThreadId } }
type FakeAuiState = {
  threadListItem: { id: string; remoteId?: string; status?: string };
  threads: { mainThreadId: string };
};

let fakeAuiState: FakeAuiState = {
  threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
  threads: { mainThreadId: 'chat-9' },
};

vi.mock('@assistant-ui/react', () => ({
  useAuiState: vi.fn((selector: (s: FakeAuiState) => unknown) => selector(fakeAuiState)),
}));

vi.mock('../chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: vi.fn(() => FAKE_CONTROLLER),
  },
}));

vi.mock('../../../chat/runtime/use-chat-thread-runtime', () => ({
  useChatThreadRuntime: vi.fn(() => SENTINEL_RUNTIME),
}));

vi.mock('../daemon-port-context', () => ({
  useDaemonPort: vi.fn(() => 31415),
}));

// Split-zone membership: a thread that is (or is queued to become) a
// `ChatZone` member defers its draft-stash take to the zone (finding 1,
// fork-from-message prefill). Defaults to "no split" unless a test opts in.
let fakeZonesState: { zones: [string, string] | null; pendingPair: [string, string] | null } = {
  zones: null,
  pendingPair: null,
};

vi.mock('../../../chat/zones/zones-store', () => ({
  isVisibleZone: (zones: [string, string] | null, id: string | null | undefined) =>
    id != null && zones != null && zones.includes(id),
  useZonesStore: vi.fn((selector: (s: typeof fakeZonesState) => unknown) => selector(fakeZonesState)),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { chatControllerRegistry } from '../chat-controller-registry';
import { useChatThreadRuntime } from '../../../chat/runtime/use-chat-thread-runtime';
import { useChatRuntimeHook } from '../use-chat-runtime-hook';

const mockGetOrCreate = vi.mocked(chatControllerRegistry.getOrCreate);
const mockUseChatThreadRuntime = vi.mocked(useChatThreadRuntime);

// ---------------------------------------------------------------------------
// Reset mocks between cases
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrCreate.mockReturnValue(FAKE_CONTROLLER as unknown as ReturnType<typeof chatControllerRegistry.getOrCreate>);
  mockUseChatThreadRuntime.mockReturnValue(SENTINEL_RUNTIME as unknown as ReturnType<typeof useChatThreadRuntime>);
  fakeZonesState = { zones: null, pendingPair: null };
});

// ---------------------------------------------------------------------------
// 1. chatId is item.id (stable — never remoteId)
// ---------------------------------------------------------------------------

describe('use-chat-runtime-hook — chatId is item.id (stable), not remoteId', () => {
  it('calls getOrCreate with item.id "__LOCALID_x", not remoteId "chat-5"', () => {
    fakeAuiState = {
      threadListItem: { id: '__LOCALID_x', remoteId: 'chat-5', status: 'regular' },
      threads: { mainThreadId: '__LOCALID_x' },
    };

    renderHook(() => useChatRuntimeHook());

    expect(mockGetOrCreate).toHaveBeenCalledWith('__LOCALID_x', 31415);
    expect(mockGetOrCreate).not.toHaveBeenCalledWith('chat-5', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// 3. active derivation — true when item.id === mainThreadId AND remoteId set
// ---------------------------------------------------------------------------

describe('use-chat-runtime-hook — active:true when main thread and remoteId is set', () => {
  it('calls useChatThreadRuntime with { active:true } when id matches mainThreadId and remoteId is set', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-9' },
    };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: true, chatId: 'chat-9', skipDraftRestore: false });
  });
});

// ---------------------------------------------------------------------------
// 4. active derivation — false when mainThreadId differs
// ---------------------------------------------------------------------------

describe('use-chat-runtime-hook — active:false when mainThreadId differs', () => {
  it('calls useChatThreadRuntime with { active:false } when item.id !== mainThreadId', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'other' },
    };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: false, chatId: 'chat-9', skipDraftRestore: false });
  });
});

// ---------------------------------------------------------------------------
// 5. active derivation — false when remoteId is undefined (new local thread)
// ---------------------------------------------------------------------------

describe('use-chat-runtime-hook — active:false when remoteId is absent (new local thread)', () => {
  it('calls useChatThreadRuntime with { active:false } when __LOCALID_ has no remoteId, even if mainThread', () => {
    fakeAuiState = {
      threadListItem: { id: '__LOCALID_x', remoteId: undefined },
      threads: { mainThreadId: '__LOCALID_x' },
    };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: false, chatId: '__LOCALID_x', skipDraftRestore: false });
  });
});

// ---------------------------------------------------------------------------
// 6. skipDraftRestore — this id is a split zone's member, or its queued
//    pending-pair target (finding 1: a "Fork from here" prefill opening
//    beside its parent). This hidden instance must defer to ChatZone's own
//    restore effect, or the one-shot draft-stash take lands on a composer
//    nobody displays.
// ---------------------------------------------------------------------------

describe('use-chat-runtime-hook — skipDraftRestore defers to a split zone', () => {
  it('is true when this id is already a visible zone member', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-9' },
    };
    fakeZonesState = { zones: ['chat-parent', 'chat-9'], pendingPair: null };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: true, chatId: 'chat-9', skipDraftRestore: true });
  });

  it('is true when this id is the queued pending-pair target (not listed yet)', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-9' },
    };
    fakeZonesState = { zones: null, pendingPair: ['chat-parent', 'chat-9'] };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: true, chatId: 'chat-9', skipDraftRestore: true });
  });

  it('is false for an unrelated thread while some other pair is split', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-9' },
    };
    fakeZonesState = { zones: ['chat-a', 'chat-b'], pendingPair: null };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: true, chatId: 'chat-9', skipDraftRestore: false });
  });
});
