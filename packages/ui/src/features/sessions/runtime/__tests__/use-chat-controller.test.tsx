/**
 * useChatController — a mounted holder must not keep a controller the
 * registry has disposed or replaced. The tests drive it through a named hook
 * (`useHolder`) so the React Compiler compiles the caller the way it compiles
 * `useTaskChat` or `SubagentZone`.
 */
import { useState } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

// A plain `function` (not an arrow) so tinyspy can `new` it; see chat-controller-registry.test.ts.
vi.mock('../../../chat/controller/acp-chat-controller', () => ({
  AcpChatController: vi.fn().mockImplementation(function (chatId: string) {
    return { chatId, dispose: vi.fn(), setRemoteId: vi.fn() };
  }),
}));

import type { AcpChatController } from '../../../chat/controller/acp-chat-controller';
import { chatControllerRegistry } from '../chat-controller-registry';
import { useChatController } from '../use-chat-controller';

const PORT = 31415;

/**
 * Shaped like the real callers: the port comes from a hook (`useDaemonPort`
 * there) and a value is derived from the controller, so the compiler compiles
 * the holder and would cache an inline lookup per (chatId, port).
 */
function useHolder(chatId: string): { controller: AcpChatController } {
  const [port] = useState(PORT);
  const controller = useChatController(chatId, port);
  return { controller };
}

afterEach(() => {
  chatControllerRegistry.disposeAll();
  vi.clearAllMocks();
});

it('keeps the same controller across renders while the registry holds it', () => {
  const { result, rerender } = renderHook(() => useHolder('chat-1'));
  const first = result.current.controller;
  rerender();
  expect(result.current.controller).toBe(first);
});

it('re-resolves on the next render after the registry disposes it', () => {
  const { result, rerender } = renderHook(() => useHolder('chat-1'));
  const disposed = result.current.controller;

  chatControllerRegistry.dispose('chat-1');
  rerender();

  expect(result.current.controller).not.toBe(disposed);
  expect(result.current.controller).toBe(chatControllerRegistry.getOrCreate('chat-1', PORT));
});

it('picks up the adopted controller that replaced a stale one under the remote id', () => {
  const { result, rerender } = renderHook(() => useHolder('remote-1'));
  const stale = result.current.controller;
  const draft = chatControllerRegistry.getOrCreate('__LOCALID_draft', PORT);

  chatControllerRegistry.adopt(draft, 'remote-1');
  rerender();

  expect(result.current.controller).not.toBe(stale);
  expect(result.current.controller).toBe(draft);
});
