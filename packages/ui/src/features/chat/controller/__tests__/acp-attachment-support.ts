/**
 * Shared fixtures for the AcpSessionAttachment test pair — the guard/bypass
 * file and the full-replay file (todo #350, T40). NOT a `.test.ts` file:
 * vitest's include glob only picks up `*.test.ts(x)`, so this module
 * contributes no cases of its own (same convention as `acp-test-kit.ts`).
 */
import { vi } from 'vitest';
import type { MainframeCapabilities, RevisionCursor } from '@qlan-ro/mainframe-types';
import type { ReplayCursor } from '../../../../lib/daemon/acp-client';
import type { ChatStateEvent } from '../chat-thread-state';
import {
  AcpSessionAttachment,
  type AcpSessionAttachmentHost,
  type AcpSessionClientPort,
} from '../acp-session-attachment';
import { ReplayStage } from '../acp-replay-stage';
import { CHAT_ID, makeFakeAcpClient } from './acp-test-kit';

export type ResumeResult = Awaited<ReturnType<AcpSessionClientPort['resume']>>;

export function makeHost(overrides: { hasAccumulatedItems?: () => boolean } = {}) {
  // Stateful on purpose: the cursor/accumulator resets are what a wipe is FOR,
  // so a test has to be able to observe them, not just count the calls.
  const state = {
    settledItemId: null as string | null,
    hasItems: false,
    durableCursor: null as RevisionCursor | null,
  };
  const dispatch = vi.fn<(event: ChatStateEvent) => void>();
  const resetAccumulator = vi.fn<() => void>(() => {
    state.hasItems = false;
  });
  const resetSettledCursor = vi.fn<() => void>(() => {
    state.settledItemId = null;
  });
  const clearDurableCursor = vi.fn<() => void>(() => {
    state.durableCursor = null;
  });
  // Mirrors `ResumeCursorTracker.advanceFromNotification` — kept minimal here
  // since the tracker's own behavior is unit-tested in `acp-resume-cursor.test.ts`.
  const advanceCursorFromNotification = vi.fn<(cursor: RevisionCursor) => void>((cursor) => {
    if (!state.durableCursor || state.durableCursor.epoch !== cursor.epoch) {
      state.durableCursor = null;
      return;
    }
    if (cursor.revision > state.durableCursor.revision) state.durableCursor = cursor;
  });
  const nextReplayFrom = vi.fn<(capabilities: MainframeCapabilities | null | undefined) => ReplayCursor>(
    (capabilities) => {
      if (capabilities?.revisionCursors === true && capabilities?.replayComplete === true && state.durableCursor) {
        return { type: 'revision', epoch: state.durableCursor.epoch, revision: state.durableCursor.revision };
      }
      return state.settledItemId ? { type: 'item', itemId: state.settledItemId } : { type: 'start' };
    },
  );
  const beginReplay = vi.fn<(opts: { full: boolean }) => ReplayStage>((opts) => new ReplayStage(opts.full, null));
  const completeReplay = vi.fn<(stage: ReplayStage) => void>();
  const discardReplay = vi.fn<(stage: ReplayStage) => void>();
  const host: AcpSessionAttachmentHost = {
    getChatId: () => CHAT_ID,
    dispatch,
    isDisposed: () => false,
    nextReplayFrom,
    resetSettledCursor,
    clearDurableCursor,
    advanceCursorFromNotification,
    resetAccumulator,
    hasAccumulatedItems: overrides.hasAccumulatedItems ?? (() => state.hasItems),
    onSessionUpdate: vi.fn(),
    onPermissionRequest: vi.fn(),
    onGateResolvedForSession: vi.fn(),
    beginReplay,
    completeReplay,
    discardReplay,
  };
  return {
    host,
    state,
    dispatch,
    resetAccumulator,
    resetSettledCursor,
    clearDurableCursor,
    beginReplay,
    completeReplay,
    discardReplay,
  };
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
