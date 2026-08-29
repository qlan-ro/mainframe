'use client';

/**
 * Per-chat runtime hook — mirrors react-opencode's `useOpenCodeThreadRuntime`.
 *
 * Wires an AcpChatController to assistant-ui's `useExternalStoreRuntime`.
 * The controller is created once per thread id (global registry) and kept warm
 * across switches via `subscribeState`; `opts.active` gates `subscribeLive` (the
 * live WS sub). `onNew` creates the daemon chat for a `__LOCALID_*` thread
 * (createForLocal → setRemoteId) before the first send.
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
 *  - replyToPermission(response) — send a permission response
 */
import { useExternalStoreRuntime, useAuiState } from '@assistant-ui/react';
import { createAttachmentAdapter } from '../composer/attachment-adapter';

/** Stateless — the per-chat daemon upload happens in the controller on send.
 *  Exported for the split-view zone mount (ChatZone), which builds an
 *  ExternalThread client with the same adapter. */
export const CHAT_ATTACHMENT_ADAPTER = createAttachmentAdapter();
const ATTACHMENT_ADAPTER = CHAT_ATTACHMENT_ADAPTER;
import type { AppendMessage, AssistantRuntime, ThreadMessage } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ControlResponse } from '@qlan-ro/mainframe-types';
import type { AcpChatController } from '../controller/acp-chat-controller';
import type { ChatThreadState, ChatPermissionEntry } from '../controller/chat-thread-state';
import type { QueuedMessageRef, WorktreeSwitchOffer } from '@qlan-ro/mainframe-types';
import { projectChatThreadRepository } from '../controller/project-messages';
import { selectPermissionFront } from '../gates/select-front';
import { createForLocal } from '../../sessions/runtime/new-thread-coordinator';
import { chatControllerRegistry } from '../../sessions/runtime/chat-controller-registry';

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
  readonly replyToPermission: (response: ControlResponse, selectedOptionId?: string) => Promise<void>;
  readonly cancelQueued: (messageId: string) => Promise<void>;
  readonly editQueued: (messageId: string, content: string) => Promise<void>;
  /** Re-send a failed optimistic user message (the "Failed to send" indicator). */
  readonly retryMessage: (clientId: string) => Promise<void>;
  /** Re-run the history load — used to retry after `state.loadState.type === 'error'`. */
  readonly retry: () => Promise<void>;
  readonly acceptWorktreeOffer: (worktreePath: string) => Promise<void>;
  readonly dismissWorktreeOffer: (worktreePath: string) => Promise<void>;
  readonly clearWorktreeSwitch: () => void;
}

function isChatRuntimeExtras(extras: unknown): extras is ChatRuntimeExtras {
  return typeof extras === 'object' && extras != null && symbolMfExtras in extras;
}

/**
 * The one place extras are assembled — shared by the native runtime hook and
 * the split-view zone mount so `useChatExtras()` consumers (gates, markers,
 * composer toolbar) behave identically in a zone. Lives here because the brand
 * symbol is module-private on purpose.
 */
export function buildChatExtras(
  controller: AcpChatController,
  port: number,
  state: ChatThreadState,
): ChatRuntimeExtras {
  return {
    [symbolMfExtras]: true as const,
    state,
    permissions: state.interactions.permissions,
    queued: state.interactions.queued,
    port,
    cancel: () => controller.cancel(),
    replyToPermission: (response, selectedOptionId) => controller.replyToPermission(response, selectedOptionId),
    cancelQueued: (messageId) => controller.cancelQueued(messageId),
    editQueued: (messageId, content) => controller.editQueued(messageId, content),
    retryMessage: (clientId) => controller.retryMessage(clientId),
    retry: () => controller.refresh(),
    acceptWorktreeOffer: (worktreePath) => controller.acceptWorktreeOffer(worktreePath),
    dismissWorktreeOffer: (worktreePath) => controller.dismissWorktreeOffer(worktreePath),
    clearWorktreeSwitch: () => controller.clearWorktreeSwitch(),
  };
}

// ---------------------------------------------------------------------------
// Controller state → useSyncExternalStore
// ---------------------------------------------------------------------------

export function useControllerState(controller: AcpChatController): ChatThreadState {
  // The subscribe/getSnapshot callbacks MUST be stable. An inline arrow gets a
  // fresh identity every render, which makes useSyncExternalStore re-subscribe
  // on every render. `subscribeState` only registers a state-change listener
  // (it never opens a WS sub), so this stays cheap; the live WS sub is gated
  // separately via `subscribeLive` in the active effect. Keep them stable.
  const subscribe = useCallback((listener: () => void) => controller.subscribeState(listener), [controller]);
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
// Failed send → attachments back to the composer
// ---------------------------------------------------------------------------

async function restoreAttachments(
  runtime: AssistantRuntime | null,
  attachments: AppendMessage['attachments'],
): Promise<boolean> {
  const composer = runtime?.thread.composer;
  const pending = attachments ?? [];
  if (!composer || pending.length === 0) return false;

  let restored = 0;
  for (const attachment of pending) {
    const file = attachment.file;
    if (!file) continue;
    try {
      await composer.addAttachment(file);
      restored += 1;
    } catch (error) {
      console.warn('[chat-runtime] could not restore an attachment to the composer', error);
    }
  }
  return restored === pending.length;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useChatThreadRuntime(
  controller: AcpChatController,
  port: number,
  opts?: { active?: boolean },
): AssistantRuntime {
  const state = useControllerState(controller); // uses controller.subscribeState (always)

  // Seed from REST once on mount (deduped by loadPromise inside controller).
  // A __LOCALID_* thread is a no-op here — controller.load() early-returns until
  // setRemoteId adopts a real daemon id (which re-fires the load itself).
  useEffect(() => {
    void controller.load();
  }, [controller]);

  // Dormancy (D4): open the live WS sub only while this is the active thread.
  // The effect cleanup is the live teardown, so deactivation drops the sub.
  const active = opts?.active ?? false;
  useEffect(() => {
    if (!active) return;
    const stop = controller.subscribeLive();
    return stop;
  }, [controller, active]);

  const isRunning = isRunningFromState(state);

  const messageRepository = useMemo(() => projectChatThreadRepository(state), [state]);

  const extras = useMemo(() => buildChatExtras(controller, port, state), [controller, port, state]);

  // The restore below needs the runtime this hook produces, which doesn't exist
  // yet when onNew is created — the ref closes that loop.
  const runtimeRef = useRef<AssistantRuntime | null>(null);

  // onNew: a new (__LOCALID_*) thread has no daemon chat yet — create it, adopt
  // its id (setRemoteId), then send. A thread that already has a remoteId
  // (pre-existing chat, or one created earlier this session) just sends.
  const onNew = useCallback(
    async (message: AppendMessage): Promise<void> => {
      // createChat can 401 before a pending bubble exists, after the composer reset.
      try {
        if (!controller.hasRemoteId()) {
          const { remoteId } = await createForLocal(controller.getThreadId(), port);
          chatControllerRegistry.adopt(controller, remoteId);
        }
        await controller.sendMessage(message);
      } catch (error) {
        // Safe against the composer reset: sendMessage cannot reject before its
        // first await (the upload fetch), so this lands after append() has
        // dropped this promise and use-submit-composition has reset the composer.
        if (await restoreAttachments(runtimeRef.current, message.attachments)) {
          controller.markAttachmentsRestoredForFailure(error);
        }
        throw error;
      }
    },
    [controller, port],
  );

  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isLoading: state.loadState.type === 'loading',
    isRunning,
    messageRepository,
    extras,
    adapters: { attachments: ATTACHMENT_ADAPTER },
    onNew,
    onCancel: async () => {
      await controller.cancel();
    },
  });
  runtimeRef.current = runtime;

  return runtime;
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

/** Queued messages (waiting to be sent to the CLI). */
export function useChatQueuedMessages(): QueuedMessageRef[] {
  const extras = useChatExtras();
  return useMemo(
    () => (extras ? Object.values(extras.queued).filter((q): q is QueuedMessageRef => q != null) : []),
    [extras],
  );
}

/**
 * Worktree-switch offers for this chat, oldest first, plus the in-flight switch,
 * the chat's live binding, and the three actions. Stable ref via useMemo([extras]).
 *
 * `busy` mirrors the daemon's refusal to rebind mid-turn: accepting restarts the
 * CLI, which would cut the answer off. The offer keeps until the turn ends.
 */
export function useWorktreeOffer(): {
  offers: WorktreeSwitchOffer[];
  switching: ChatThreadState['switching'];
  current: { worktreePath: string | null; branchName: string | null };
  busy: boolean;
  accept: (worktreePath: string) => Promise<void>;
  dismiss: (worktreePath: string) => Promise<void>;
  clear: () => void;
} {
  const extras = useChatExtras();
  return useMemo(() => {
    const offers = Object.values(extras?.state.worktreeOffers ?? {}).sort((a, b) => a.detectedAt - b.detectedAt);
    const chat = extras?.state.chatConfig ?? null;
    return {
      offers,
      switching: extras?.state.switching ?? null,
      busy: extras !== undefined && isRunningFromState(extras.state),
      current: {
        worktreePath: chat?.worktreePath ?? null,
        branchName: chat?.branchName ?? null,
      },
      accept: extras?.acceptWorktreeOffer ?? notReady,
      dismiss: extras?.dismissWorktreeOffer ?? notReady,
      clear: extras?.clearWorktreeSwitch ?? (() => undefined),
    };
  }, [extras]);
}

async function notReady(): Promise<never> {
  throw new Error('Chat runtime not ready');
}

/** Queue-front gate: pending sorted by askedAt asc, take [0]. Stable ref via useMemo([extras]). */
export function useChatPermissionFront(): {
  front: ChatPermissionEntry | undefined;
  reply: (response: ControlResponse, selectedOptionId?: string) => Promise<void>;
} {
  const extras = useChatExtras();
  return useMemo(() => {
    const front = selectPermissionFront(extras?.permissions);
    const reply: (response: ControlResponse, selectedOptionId?: string) => Promise<void> =
      extras?.replyToPermission ??
      (async () => {
        throw new Error('Chat runtime not ready');
      });
    return { front, reply };
  }, [extras]);
}
