'use client';

/**
 * Per-chat runtime hook — mirrors react-opencode's `useOpenCodeThreadRuntime`.
 *
 * Wires a ChatThreadController to assistant-ui's `useExternalStoreRuntime`.
 * The controller is created once per chatId (via the registry in
 * ChatRuntimeProvider) and disposed on switch/unmount.
 *
 * `extras` carries all non-message state + action callbacks, surfaced via
 * `useAuiState(s => s.thread.extras)` and the convenience hooks below.
 * No separate store — the controller's reducer state is the sole source.
 *
 * Exposed extras fields (Phase 2A groundwork):
 *  - state          — full ChatThreadState snapshot (for debugging / advanced use)
 *  - permissions    — Record<requestId, ChatPermissionEntry> (pending only)
 *  - queued         — Record<uuid, QueuedMessageRef> (queued messages waiting)
 *  - cancel()       — interrupt the current run
 *  - replyToPermission(requestId, response) — send a permission response
 */
import { useExternalStoreRuntime, useAuiState } from '@assistant-ui/react';
import { createAttachmentAdapter } from '../composer/attachment-adapter';

/** Stateless — the per-chat daemon upload happens in the controller on send. */
const ATTACHMENT_ADAPTER = createAttachmentAdapter();
import type { AssistantRuntime, ThreadMessage } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ControlResponse } from '@qlan-ro/mainframe-types';
import type { ChatThreadController } from '../controller/chat-thread-controller';
import type { ChatThreadState, ChatPermissionEntry } from '../controller/chat-thread-state';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { projectChatThreadRepository } from '../controller/project-messages';
import { selectPermissionFront } from '../gates/select-front';

// ---------------------------------------------------------------------------
// Extras shape + brand
// ---------------------------------------------------------------------------

const symbolMfExtras = Symbol('mainframe-chat-extras');

export interface ChatRuntimeExtras {
  readonly [symbolMfExtras]: true;
  readonly state: ChatThreadState;
  readonly permissions: Readonly<Record<string, ChatPermissionEntry>>;
  readonly queued: Readonly<Record<string, QueuedMessageRef>>;
  readonly port: number;
  readonly cancel: () => Promise<void>;
  readonly replyToPermission: (requestId: string, response: ControlResponse) => Promise<void>;
  readonly cancelQueued: (messageId: string) => Promise<void>;
  readonly editQueued: (messageId: string, content: string) => Promise<void>;
}

function isChatRuntimeExtras(extras: unknown): extras is ChatRuntimeExtras {
  return typeof extras === 'object' && extras != null && symbolMfExtras in extras;
}

// ---------------------------------------------------------------------------
// Controller state → useSyncExternalStore
// ---------------------------------------------------------------------------

export function useControllerState(controller: ChatThreadController): ChatThreadState {
  // The subscribe/getSnapshot callbacks MUST be stable. An inline arrow gets a
  // fresh identity every render, which makes useSyncExternalStore re-subscribe
  // on every render — and `controller.subscribe` runs `ensureWsSubscription()`
  // (→ resumeChat) on subscribe and `detachWs()` when listeners hit 0, so each
  // re-subscribe fires a resume. Combined with chat.updated → run.* re-renders,
  // that self-sustains into a resume/chat.updated storm. Keep them stable.
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const getSnapshot = useCallback(() => controller.getState(), [controller]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------
// isRunning derivation (mirrors react-opencode's isOpenCodeStateRunning)
// ---------------------------------------------------------------------------

function isRunningFromState(state: ChatThreadState): boolean {
  return state.runState.type === 'running' || state.runState.type === 'cancelling';
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useChatThreadRuntime(controller: ChatThreadController, port: number): AssistantRuntime {
  const state = useControllerState(controller);

  // Seed from REST once on mount (deduped by loadPromise inside controller).
  useEffect(() => {
    void controller.load();
  }, [controller]);

  const isRunning = isRunningFromState(state);

  const messageRepository = useMemo(() => projectChatThreadRepository(state), [state]);

  const extras = useMemo(
    (): ChatRuntimeExtras => ({
      [symbolMfExtras]: true as const,
      state,
      permissions: state.interactions.permissions,
      queued: state.interactions.queued,
      port,
      cancel: () => controller.cancel(),
      replyToPermission: (requestId, response) => controller.replyToPermission(requestId, response),
      cancelQueued: (messageId) => controller.cancelQueued(messageId),
      editQueued: (messageId, content) => controller.editQueued(messageId, content),
    }),
    [controller, port, state],
  );

  return useExternalStoreRuntime<ThreadMessage>({
    isLoading: state.loadState.type === 'loading',
    isRunning,
    messageRepository,
    extras,
    adapters: { attachments: ATTACHMENT_ADAPTER },
    onNew: async (message) => {
      await controller.sendMessage(message);
    },
    onCancel: async () => {
      await controller.cancel();
    },
  });
}

// ---------------------------------------------------------------------------
// Public convenience hooks (mirror useOpenCode* hooks in react-opencode)
// ---------------------------------------------------------------------------

/** Read full extras from any component inside the chat runtime tree. */
export function useChatExtras(): ChatRuntimeExtras | undefined {
  return useAuiState((s: { thread: { extras: unknown } }) =>
    isChatRuntimeExtras(s.thread.extras) ? s.thread.extras : undefined,
  );
}

/** Pending permission requests as an array. */
export function useChatPermissions(): {
  pending: ChatPermissionEntry[];
  reply: (requestId: string, response: ControlResponse) => Promise<void>;
} {
  const extras = useChatExtras();
  return useMemo(() => {
    const pending = extras ? Object.values(extras.permissions).filter((e): e is ChatPermissionEntry => e != null) : [];
    const reply: (requestId: string, response: ControlResponse) => Promise<void> =
      extras?.replyToPermission ??
      (async () => {
        throw new Error('Chat runtime not ready');
      });
    return { pending, reply };
  }, [extras]);
}

/** Queued messages (waiting to be sent to the CLI). */
export function useChatQueuedMessages(): QueuedMessageRef[] {
  const extras = useChatExtras();
  return useMemo(
    () => (extras ? Object.values(extras.queued).filter((q): q is QueuedMessageRef => q != null) : []),
    [extras],
  );
}

/** Queue-front gate: pending sorted by askedAt asc, take [0]. Stable ref via useMemo([extras]). */
export function useChatPermissionFront(): {
  front: ChatPermissionEntry | undefined;
  reply: (requestId: string, response: ControlResponse) => Promise<void>;
} {
  const extras = useChatExtras();
  return useMemo(() => {
    const front = selectPermissionFront(extras?.permissions);
    const reply: (requestId: string, response: ControlResponse) => Promise<void> =
      extras?.replyToPermission ??
      (async () => {
        throw new Error('Chat runtime not ready');
      });
    return { front, reply };
  }, [extras]);
}
