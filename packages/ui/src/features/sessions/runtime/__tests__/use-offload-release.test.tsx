/**
 * useOffloadRelease — React glue tests. Mirrors use-session-list-router.test.tsx's
 * mock harness: the `createOffloadRelease` factory is mocked to capture the deps
 * object and return spy-backed { recheck, dispose }.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useZonesStore } from '../../../chat/zones/zones-store';

let mainThreadIdValue: string | null;
let fakeThreadItems: Array<{ id: string; remoteId?: string }>;
let recheckSpy: ReturnType<typeof vi.fn<() => void>>;
let disposeSpy: ReturnType<typeof vi.fn<() => void>>;
let factoryCallCount: number;
let detachSpy: ReturnType<typeof vi.fn<(id: string) => void>>;
let disposeControllerSpy: ReturnType<typeof vi.fn<(id: string) => void>>;

interface CapturedDeps {
  getThreadItems: () => readonly { id: string; remoteId: string | undefined }[];
  getMainThreadId: () => string | null;
  getZones: () => readonly [string, string] | null;
  detachItem: (id: string) => void;
  disposeController: (chatId: string) => void;
  markForStash: (id: string) => void;
}
let capturedDeps: CapturedDeps;

vi.mock('../../../../lib/daemon/ws-client', () => ({
  daemonWs: { onEvent: vi.fn(() => () => {}) },
}));

vi.mock('../offload-release', () => ({
  createOffloadRelease: vi.fn((_ws: unknown, deps: CapturedDeps) => {
    capturedDeps = deps;
    factoryCallCount += 1;
    return { recheck: recheckSpy, dispose: disposeSpy };
  }),
}));

vi.mock('../chat-controller-registry', () => ({
  chatControllerRegistry: { dispose: (id: string) => disposeControllerSpy(id) },
}));

vi.mock('../../../chat/runtime/draft-stash', () => ({
  markForStash: vi.fn(),
}));

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  const threads = {
    getState: () => ({ mainThreadId: mainThreadIdValue, threadItems: fakeThreadItems }),
    item: (selector: { id: string }) => ({ detach: () => detachSpy(selector.id) }),
  };
  const auiClient = { threads };
  return {
    ...actual,
    useAui: () => auiClient,
    useAuiState: (sel: (s: { threads: { mainThreadId: string | null } }) => unknown) =>
      sel({ threads: { mainThreadId: mainThreadIdValue } }),
  };
});

import { useOffloadRelease } from '../use-offload-release';
import { markForStash } from '../../../chat/runtime/draft-stash';

beforeEach(() => {
  mainThreadIdValue = null;
  fakeThreadItems = [];
  recheckSpy = vi.fn();
  disposeSpy = vi.fn();
  detachSpy = vi.fn();
  disposeControllerSpy = vi.fn();
  factoryCallCount = 0;
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
});

it('constructs the release exactly once per threads-scope identity', () => {
  const { rerender } = renderHook(() => useOffloadRelease());
  rerender();
  rerender();

  expect(factoryCallCount).toBe(1);
});

it('wires getThreadItems/getMainThreadId/getZones to the live aui + zones state', () => {
  mainThreadIdValue = 'chat-9';
  fakeThreadItems = [{ id: 'chat-9', remoteId: undefined }];
  useZonesStore.setState({ zones: ['a', 'b'], focusedIndex: 0 });

  renderHook(() => useOffloadRelease());

  expect(capturedDeps.getThreadItems()).toEqual(fakeThreadItems);
  expect(capturedDeps.getMainThreadId()).toBe('chat-9');
  expect(capturedDeps.getZones()).toEqual(['a', 'b']);
});

it('wires detachItem to the aui thread-list-item detach() method', () => {
  renderHook(() => useOffloadRelease());

  capturedDeps.detachItem('chat-5');

  expect(detachSpy).toHaveBeenCalledWith('chat-5');
});

it('wires disposeController to the controller registry', () => {
  renderHook(() => useOffloadRelease());

  capturedDeps.disposeController('chat-5');

  expect(disposeControllerSpy).toHaveBeenCalledWith('chat-5');
});

it('wires markForStash to the draft-stash module', () => {
  renderHook(() => useOffloadRelease());

  capturedDeps.markForStash('chat-5');

  expect(vi.mocked(markForStash)).toHaveBeenCalledWith('chat-5');
});

it('calls recheck() again when mainThreadId changes (beyond the mount-time call)', () => {
  const { rerender } = renderHook(() => useOffloadRelease());
  const afterMount = recheckSpy.mock.calls.length;

  mainThreadIdValue = 'chat-1';
  act(() => rerender());

  expect(recheckSpy.mock.calls.length).toBeGreaterThan(afterMount);
});

it('calls recheck() again when the zones pair changes (beyond the mount-time call)', () => {
  const { rerender } = renderHook(() => useOffloadRelease());
  const afterMount = recheckSpy.mock.calls.length;

  act(() => useZonesStore.setState({ zones: ['a', 'b'], focusedIndex: 0 }));
  rerender();

  expect(recheckSpy.mock.calls.length).toBeGreaterThan(afterMount);
});

it('calls dispose() exactly once on unmount', () => {
  const { unmount } = renderHook(() => useOffloadRelease());

  unmount();

  expect(disposeSpy).toHaveBeenCalledTimes(1);
});
