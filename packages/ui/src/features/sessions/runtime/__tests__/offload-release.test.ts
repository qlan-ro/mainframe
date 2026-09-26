/**
 * OffloadRelease — pure unit tests (no React), mirroring SessionListRouter's
 * DI'd-class test style. Covers AC11 (off-screen release + alias detach-then-
 * dispose) and AC12 (on-screen defer + release on recheck).
 */
import { describe, it, expect, vi } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';
import { createOffloadRelease, type OffloadReleaseDeps, type ThreadItemRef } from '../offload-release';

interface FakeWs {
  onEvent: (handler: (event: DaemonEvent) => void) => () => void;
  emit: (event: DaemonEvent) => void;
  handlerCount: () => number;
}

function fakeWs(): FakeWs {
  const handlers = new Set<(event: DaemonEvent) => void>();
  return {
    onEvent: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit: (event) => handlers.forEach((h) => h(event)),
    handlerCount: () => handlers.size,
  };
}

function offloaded(chatId: string): DaemonEvent {
  return { type: 'chat.offloaded', chatId };
}

function processStarted(chatId: string): DaemonEvent {
  return {
    type: 'process.started',
    chatId,
    process: { id: `proc-${chatId}`, adapterId: 'claude', chatId, pid: 1, status: 'ready', projectPath: '/tmp' },
  };
}

interface Harness {
  ws: FakeWs;
  calls: string[];
  items: ThreadItemRef[];
  mainThreadId: string | null;
  zones: readonly [string, string] | null;
  detachItem: ReturnType<typeof vi.fn>;
  disposeController: ReturnType<typeof vi.fn>;
  markForStash: ReturnType<typeof vi.fn>;
  deps: OffloadReleaseDeps;
}

function makeHarness(items: ThreadItemRef[] = []): Harness {
  const ws = fakeWs();
  const calls: string[] = [];
  const state = { items, mainThreadId: null as string | null, zones: null as readonly [string, string] | null };
  const detachItem = vi.fn((id: string) => calls.push(`detach:${id}`));
  const disposeController = vi.fn((id: string) => calls.push(`dispose:${id}`));
  const markForStash = vi.fn((id: string) => calls.push(`stash:${id}`));
  return {
    ws,
    calls,
    get items(): ThreadItemRef[] {
      return state.items;
    },
    set items(v: ThreadItemRef[]) {
      state.items = v;
    },
    get mainThreadId(): string | null {
      return state.mainThreadId;
    },
    set mainThreadId(v: string | null) {
      state.mainThreadId = v;
    },
    get zones(): readonly [string, string] | null {
      return state.zones;
    },
    set zones(v: readonly [string, string] | null) {
      state.zones = v;
    },
    detachItem,
    disposeController,
    markForStash,
    deps: {
      getThreadItems: () => state.items,
      getMainThreadId: () => state.mainThreadId,
      getZones: () => state.zones,
      detachItem,
      disposeController,
      markForStash,
    },
  };
}

describe('OffloadRelease — AC11 off-screen release', () => {
  it('marks for stash, detaches, then disposes once for a single-item chat', () => {
    const h = makeHarness([{ id: 'chat-1', remoteId: undefined }]);
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-1'));

    expect(h.markForStash).toHaveBeenCalledWith('chat-1');
    expect(h.detachItem).toHaveBeenCalledWith('chat-1');
    expect(h.disposeController).toHaveBeenCalledTimes(1);
    expect(h.disposeController).toHaveBeenCalledWith('chat-1');
    expect(h.calls.indexOf('detach:chat-1')).toBeLessThan(h.calls.indexOf('dispose:chat-1'));
    release.dispose();
  });

  it('an unknown chat id still calls dispose (no-op registry entry) without detaching anything', () => {
    const h = makeHarness([]);
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('ghost'));

    expect(h.detachItem).not.toHaveBeenCalled();
    expect(h.markForStash).not.toHaveBeenCalled();
    expect(h.disposeController).toHaveBeenCalledWith('ghost');
    release.dispose();
  });

  it('resolves both the orphaned local draft and the canonical item, detaches both, disposes once', () => {
    const h = makeHarness([
      { id: '__LOCALID_a', remoteId: 'chat-9' },
      { id: 'chat-9', remoteId: undefined },
    ]);
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-9'));

    expect(h.detachItem).toHaveBeenCalledTimes(2);
    expect(h.detachItem).toHaveBeenCalledWith('__LOCALID_a');
    expect(h.detachItem).toHaveBeenCalledWith('chat-9');
    expect(h.disposeController).toHaveBeenCalledTimes(1);
    expect(h.disposeController).toHaveBeenCalledWith('chat-9');

    const disposeIdx = h.calls.indexOf('dispose:chat-9');
    for (const c of h.calls.filter((c) => c.startsWith('detach:'))) {
      expect(h.calls.indexOf(c)).toBeLessThan(disposeIdx);
    }
    release.dispose();
  });

  it('a resolved item on a DIFFERENT chat is left untouched', () => {
    const h = makeHarness([
      { id: 'chat-1', remoteId: undefined },
      { id: 'chat-2', remoteId: undefined },
    ]);
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-1'));

    expect(h.detachItem).toHaveBeenCalledTimes(1);
    expect(h.detachItem).toHaveBeenCalledWith('chat-1');
    expect(h.disposeController).toHaveBeenCalledWith('chat-1');
    release.dispose();
  });
});

describe('OffloadRelease — AC12 on-screen defer', () => {
  it('defers when the resolved item is the main thread, releasing neither', () => {
    const h = makeHarness([{ id: 'chat-9', remoteId: undefined }]);
    h.mainThreadId = 'chat-9';
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-9'));

    expect(h.detachItem).not.toHaveBeenCalled();
    expect(h.disposeController).not.toHaveBeenCalled();
    release.dispose();
  });

  it('defers when a resolved item is in the zones pair, even off the main thread', () => {
    const h = makeHarness([{ id: 'chat-9', remoteId: undefined }]);
    h.zones = ['chat-9', 'other'];
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-9'));

    expect(h.detachItem).not.toHaveBeenCalled();
    expect(h.disposeController).not.toHaveBeenCalled();
    release.dispose();
  });

  it('the alias case defers while the canonical item is main, releasing neither', () => {
    const h = makeHarness([
      { id: '__LOCALID_a', remoteId: 'chat-9' },
      { id: 'chat-9', remoteId: undefined },
    ]);
    h.mainThreadId = 'chat-9';
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-9'));

    expect(h.detachItem).not.toHaveBeenCalled();
    expect(h.disposeController).not.toHaveBeenCalled();
    release.dispose();
  });

  it('releases a deferred chat once recheck() finds no on-screen items after a switch away', () => {
    const h = makeHarness([{ id: 'chat-9', remoteId: undefined }]);
    h.mainThreadId = 'chat-9';
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-9'));
    expect(h.detachItem).not.toHaveBeenCalled();

    h.mainThreadId = 'chat-other';
    release.recheck();

    expect(h.detachItem).toHaveBeenCalledWith('chat-9');
    expect(h.disposeController).toHaveBeenCalledWith('chat-9');
    release.dispose();
  });

  it('recheck() re-defers a still-on-screen chat without detaching or disposing', () => {
    const h = makeHarness([{ id: 'chat-9', remoteId: undefined }]);
    h.mainThreadId = 'chat-9';
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-9'));
    release.recheck();

    expect(h.detachItem).not.toHaveBeenCalled();
    expect(h.disposeController).not.toHaveBeenCalled();
    release.dispose();
  });

  it('recheck() with nothing deferred is a no-op', () => {
    const h = makeHarness([]);
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    expect(() => release.recheck()).not.toThrow();
    expect(h.detachItem).not.toHaveBeenCalled();
    expect(h.disposeController).not.toHaveBeenCalled();
    release.dispose();
  });

  it('drops a deferred chat once its CLI respawns, so leaving it mid-turn does not release it', () => {
    const h = makeHarness([{ id: 'chat-9', remoteId: undefined }]);
    h.mainThreadId = 'chat-9';
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-9'));
    h.ws.emit(processStarted('chat-9'));
    h.mainThreadId = 'chat-other';
    release.recheck();

    expect(h.markForStash).not.toHaveBeenCalled();
    expect(h.detachItem).not.toHaveBeenCalled();
    expect(h.disposeController).not.toHaveBeenCalled();
    release.dispose();
  });

  it('defers again when a respawned chat is offloaded a second time', () => {
    const h = makeHarness([{ id: 'chat-9', remoteId: undefined }]);
    h.mainThreadId = 'chat-9';
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-9'));
    h.ws.emit(processStarted('chat-9'));
    h.ws.emit(offloaded('chat-9'));
    h.mainThreadId = 'chat-other';
    release.recheck();

    expect(h.disposeController).toHaveBeenCalledTimes(1);
    expect(h.disposeController).toHaveBeenCalledWith('chat-9');
    release.dispose();
  });

  it('a released chat is not re-released by a later recheck()', () => {
    const h = makeHarness([{ id: 'chat-9', remoteId: undefined }]);
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit(offloaded('chat-9'));
    expect(h.disposeController).toHaveBeenCalledTimes(1);

    release.recheck();
    expect(h.disposeController).toHaveBeenCalledTimes(1);
    release.dispose();
  });
});

describe('OffloadRelease — lifecycle', () => {
  it('dispose() unsubscribes from the ws so a later event is ignored', () => {
    const h = makeHarness([{ id: 'chat-1', remoteId: undefined }]);
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    release.dispose();
    h.ws.emit(offloaded('chat-1'));

    expect(h.detachItem).not.toHaveBeenCalled();
    expect(h.disposeController).not.toHaveBeenCalled();
  });

  it('ignores non-offload events', () => {
    const h = makeHarness([{ id: 'chat-1', remoteId: undefined }]);
    const release = createOffloadRelease(h.ws as unknown as DaemonWsClient, h.deps);

    h.ws.emit({ type: 'chat.ended', chatId: 'chat-1' });

    expect(h.detachItem).not.toHaveBeenCalled();
    expect(h.disposeController).not.toHaveBeenCalled();
    release.dispose();
  });
});
