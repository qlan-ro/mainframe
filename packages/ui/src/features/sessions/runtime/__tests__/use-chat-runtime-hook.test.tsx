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
// fork-from-message prefill) — but ONLY when the split will actually render
// (`splitFits`; ChatSurface parks the pair behind the single view otherwise —
// the review follow-up on 3e34c95c). Defaults to "no split, fits" unless a
// test opts in.
let fakeZonesState: {
  zones: [string, string] | null;
  pendingPair: [string, string] | null;
  splitFits: boolean;
} = {
  zones: null,
  pendingPair: null,
  splitFits: true,
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
  fakeZonesState = { zones: null, pendingPair: null, splitFits: true };
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
  it('calls useChatThreadRuntime with { active:false, skipDraftRestore:true } when item.id !== mainThreadId', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'other' },
    };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    // skipDraftRestore is keyed off `mainThreadId === chatId` (the instance
    // ChatSurface actually displays), independent of `active`: a warm
    // background instance for a chat nobody is looking at must never win the
    // one-shot draft-stash take ahead of whichever instance IS displayed.
    expect(thirdArg).toEqual({ active: false, chatId: 'chat-9', skipDraftRestore: true });
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
// 6. skipDraftRestore — only the instance ChatSurface actually displays
//    (`mainThreadId === chatId && !splitWillRender`) ever takes the stash;
//    every other instance defers, including a queued `pendingPair` target
//    and a plain background (non-focused, non-split) thread (finding 1 /
//    review follow-ups on 3e34c95c and 214de9d4).
// ---------------------------------------------------------------------------

describe('use-chat-runtime-hook — skipDraftRestore: only the displayed instance takes', () => {
  it('WIDE — defers when this id is the focused half of a pair that already fits', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-9' },
    };
    fakeZonesState = { zones: ['chat-parent', 'chat-9'], pendingPair: null, splitFits: true };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: true, chatId: 'chat-9', skipDraftRestore: true });
  });

  it('WIDE — defers for the pair’s OTHER (unfocused) half too; ChatZone renders both', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-parent', remoteId: 'chat-parent' },
      threads: { mainThreadId: 'chat-9' },
    };
    fakeZonesState = { zones: ['chat-parent', 'chat-9'], pendingPair: null, splitFits: true };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: false, chatId: 'chat-parent', skipDraftRestore: true });
  });

  it('NARROW — takes when a zone member never fits (ChatSurface parks it behind the single view)', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-9' },
    };
    fakeZonesState = { zones: ['chat-parent', 'chat-9'], pendingPair: null, splitFits: false };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: true, chatId: 'chat-9', skipDraftRestore: false });
  });

  it('PENDING — always defers while queued, regardless of the CURRENT splitFits reading', () => {
    // `switchToThread` already points mainThreadId at the incoming chat before
    // the reconciler resolves pendingPair into `zones` — without this
    // unconditional defer, a pending fork would read as "focused, no split
    // yet" (splitWillRender false, since zones doesn't include it yet) and
    // take immediately, which is the finding-1 bug all over again.
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-9' },
    };
    fakeZonesState = { zones: null, pendingPair: ['chat-parent', 'chat-9'], splitFits: false };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: true, chatId: 'chat-9', skipDraftRestore: true });
  });

  it('MID-WIDTH — takes right after pendingPair resolves into zones, even while splitFits still reads stale', () => {
    // `splitFits` lags `zones`: opening the pair parks the workspace panel to
    // free the width, and that resize is measured asynchronously
    // (`useMeasuredWidth`'s ResizeObserver), not in the same commit. The
    // moment pendingPair resolves, zones already includes this chat but
    // splitFits can still read its PRE-parking (false) value — this hook
    // still takes here (it's the only state it CAN act on); the handoff
    // effect in `useChatThreadRuntime` covers the hand-off to `ChatZone` once
    // splitFits catches up and skipDraftRestore flips true.
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-9' },
    };
    fakeZonesState = { zones: ['chat-parent', 'chat-9'], pendingPair: null, splitFits: false };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: true, chatId: 'chat-9', skipDraftRestore: false });
  });

  it('defers for a plain background thread nobody is looking at (not focused, no zones at all)', () => {
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-other' },
    };
    fakeZonesState = { zones: null, pendingPair: null, splitFits: true };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: false, chatId: 'chat-9', skipDraftRestore: true });
  });

  it('defers for a zone member whose pair is parked (the FOCUSED chat is not in the same pair)', () => {
    // zones includes chat-9, but mainThreadId points elsewhere — ChatSurface's
    // split branch keys off `zones.includes(mainThreadId)`, not this chat's
    // own membership, so a parked pair's member also renders single-view —
    // but not THIS instance's single view, since it isn't mainThreadId either.
    fakeAuiState = {
      threadListItem: { id: 'chat-9', remoteId: 'chat-9' },
      threads: { mainThreadId: 'chat-elsewhere' },
    };
    fakeZonesState = { zones: ['chat-parent', 'chat-9'], pendingPair: null, splitFits: true };

    renderHook(() => useChatRuntimeHook());

    const thirdArg = mockUseChatThreadRuntime.mock.calls[0]?.[2];
    expect(thirdArg).toEqual({ active: false, chatId: 'chat-9', skipDraftRestore: true });
  });
});
