/**
 * Shared fixtures for the AcpSessionAttachment test pair — the guard/bypass
 * file and the full-replay file (todo #350, T40). NOT a `.test.ts` file:
 * vitest's include glob only picks up `*.test.ts(x)`, so this module
 * contributes no cases of its own (same convention as `acp-test-kit.ts`).
 */
import { vi } from 'vitest';
import type { ChatStateEvent } from '../chat-thread-state';
import {
  AcpSessionAttachment,
  type AcpSessionAttachmentHost,
  type AcpSessionClientPort,
} from '../acp-session-attachment';
import { CHAT_ID, makeFakeAcpClient } from './acp-test-kit';

export type ResumeResult = Awaited<ReturnType<AcpSessionClientPort['resume']>>;

export function makeHost(overrides: { hasAccumulatedItems?: () => boolean } = {}) {
  // Stateful on purpose: the cursor/accumulator resets are what a wipe is FOR,
  // so a test has to be able to observe them, not just count the calls.
  const state = { settledItemId: null as string | null, hasItems: false };
  const dispatch = vi.fn<(event: ChatStateEvent) => void>();
  const resetAccumulator = vi.fn<() => void>(() => {
    state.hasItems = false;
  });
  const resetSettledCursor = vi.fn<() => void>(() => {
    state.settledItemId = null;
  });
  const host: AcpSessionAttachmentHost = {
    getChatId: () => CHAT_ID,
    dispatch,
    isDisposed: () => false,
    getLastSettledItemId: () => state.settledItemId,
    resetSettledCursor,
    resetAccumulator,
    hasAccumulatedItems: overrides.hasAccumulatedItems ?? (() => state.hasItems),
    onSessionUpdate: vi.fn(),
    onPermissionRequest: vi.fn(),
    onGateResolvedForSession: vi.fn(),
  };
  return { host, state, dispatch, resetAccumulator, resetSettledCursor };
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Real-timer macrotask hop — flushes every microtask the reattach chain queues. */
export const tick = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

/** An attached attachment whose `resume` is a mock the test drives. */
export async function attachedWithStubbedResume(bundle = makeHost()) {
  const client = makeFakeAcpClient();
  const { host, state, dispatch } = bundle;
  const attachment = new AcpSessionAttachment(host);
  await attachment.attach(client as unknown as AcpSessionClientPort);
  const resume = vi.fn<AcpSessionClientPort['resume']>();
  client.resume = resume;
  return { attachment, client, resume, dispatch, state };
}
