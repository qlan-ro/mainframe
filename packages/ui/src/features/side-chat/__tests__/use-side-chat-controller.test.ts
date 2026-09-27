// @vitest-environment jsdom
/**
 * use-side-chat-controller — hasPendingGate + the shared registry-backed
 * controller hooks (todo #344, UI rule 8): three call sites (SideChatHost,
 * SideChatToggle, SideChatPanelHeader) must all resolve to the SAME instance
 * for a given side-chat id, and reading state must tolerate a null controller
 * (no side chat yet) with no conditional hook call at the use site.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

const controllers = new Map<string, unknown>();
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: (id: string) => {
      if (!controllers.has(id)) controllers.set(id, { id, listeners: new Set<() => void>() });
      return controllers.get(id);
    },
  },
}));

import { hasPendingGate, useOptionalControllerState, useSideChatController } from '../use-side-chat-controller';

function makeState(permissions: Record<string, unknown> = {}): ChatThreadState {
  return {
    interactions: { permissions, queued: {} },
  } as unknown as ChatThreadState;
}

describe('hasPendingGate', () => {
  it('is false with no pending permissions', () => {
    expect(hasPendingGate(makeState())).toBe(false);
  });

  it('is true with any pending permission/question/plan gate', () => {
    expect(hasPendingGate(makeState({ req1: { askedAt: 1 } }))).toBe(true);
  });
});

describe('useSideChatController', () => {
  it('returns null with no side-chat id', () => {
    const { result } = renderHook(() => useSideChatController(null));
    expect(result.current).toBeNull();
  });

  it('returns the SAME registry instance for the same id across two hook calls', () => {
    const a = renderHook(() => useSideChatController('side-1'));
    const b = renderHook(() => useSideChatController('side-1'));
    expect(a.result.current).not.toBeNull();
    expect(a.result.current).toBe(b.result.current);
  });
});

describe('useOptionalControllerState', () => {
  it('returns null for a null controller, with no crash', () => {
    const { result } = renderHook(() => useOptionalControllerState(null));
    expect(result.current).toBeNull();
  });

  it("reads the controller's current snapshot", () => {
    const state = makeState();
    const controller = {
      getState: () => state,
      subscribeState: (_listener: () => void) => () => undefined,
    };
    const { result } = renderHook(() => useOptionalControllerState(controller as never));
    expect(result.current).toBe(state);
  });
});
