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
  const dispatch = vi.fn<(event: ChatStateEvent) => void>();
  const resetAccumulator = vi.fn<() => void>();
  const resetSettledCursor = vi.fn<() => void>();
  const host: AcpSessionAttachmentHost = {
    getChatId: () => CHAT_ID,
    dispatch,
    isDisposed: () => false,
    getLastSettledItemId: () => null,
    resetSettledCursor,
    resetAccumulator,
    hasAccumulatedItems: overrides.hasAccumulatedItems ?? (() => false),
    onSessionUpdate: vi.fn(),
    onPermissionRequest: vi.fn(),
    onGateResolvedForSession: vi.fn(),
  };
  return { host, dispatch, resetAccumulator, resetSettledCursor };
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** An attached attachment whose `resume` is a mock the test drives. */
export async function attachedWithStubbedResume() {
  const client = makeFakeAcpClient();
  const { host, dispatch } = makeHost();
  const attachment = new AcpSessionAttachment(host);
  await attachment.attach(client as unknown as AcpSessionClientPort);
  const resume = vi.fn<AcpSessionClientPort['resume']>();
  client.resume = resume;
  return { attachment, client, resume, dispatch };
}
