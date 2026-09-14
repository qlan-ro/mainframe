/**
 * AcpSessionAttachment — direct unit tests for the connect/replay half split
 * out of AcpSessionPlane (todo #350 plan review fixes, group 3 step 0).
 * Behavior tests through the plane stay in `acp-session-plane.test.ts`; this
 * file covers the guard/bypass distinction that only this class's narrower
 * host interface can isolate cleanly (R2.2 / R1.3, T24).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ChatStateEvent } from '../chat-thread-state';
import {
  AcpSessionAttachment,
  type AcpSessionAttachmentHost,
  type AcpSessionClientPort,
} from '../acp-session-attachment';
import { CHAT_ID, makeFakeAcpClient } from './acp-test-kit';

function makeHost(overrides: { hasAccumulatedItems?: () => boolean } = {}) {
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

describe('AcpSessionAttachment — empty full-replay guard', () => {
  it('refuses an empty full replay on a plain attach when the transcript already holds items', async () => {
    const client = makeFakeAcpClient() as unknown as AcpSessionClientPort;
    const { host, dispatch, resetAccumulator } = makeHost({ hasAccumulatedItems: () => true });
    const attachment = new AcpSessionAttachment(host);
    await attachment.attach(client);
    dispatch.mockClear();
    resetAccumulator.mockClear();

    (client as ReturnType<typeof makeFakeAcpClient>).nextResumeMeta = { itemCount: 0, fullReplay: true };
    await attachment.attach(client);

    expect(dispatch).toHaveBeenCalledWith({ type: 'history.refresh.refused' });
    expect(resetAccumulator).not.toHaveBeenCalled();
  });

  it('reattach() bypasses the guard — a server-initiated wipe wins even when items raced back in during the round-trip', async () => {
    const client = makeFakeAcpClient() as unknown as AcpSessionClientPort;
    // Simulates a live update repopulating the accumulator while the wipe's
    // resume() call is in flight (R2.2's race): the guard's inputs say
    // "refuse", but a reattach must never honor that.
    const { host, dispatch, resetAccumulator, resetSettledCursor } = makeHost({ hasAccumulatedItems: () => true });
    const attachment = new AcpSessionAttachment(host);
    await attachment.attach(client);
    dispatch.mockClear();
    resetAccumulator.mockClear();

    (client as ReturnType<typeof makeFakeAcpClient>).nextResumeMeta = { itemCount: 0, fullReplay: true };
    await attachment.reattach();

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'history.refresh.refused' });
    // Pre-reset (before the round-trip) plus the post-bypass reset in
    // resume() — both fire by design; reset is idempotent either way.
    expect(resetAccumulator).toHaveBeenCalled();
    expect(resetSettledCursor).toHaveBeenCalled();
  });
});
