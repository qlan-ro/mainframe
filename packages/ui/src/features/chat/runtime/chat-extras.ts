'use client';

/**
 * The chat runtime's `extras` contract and its consumer hooks — the surface
 * gates, markers, composer toolbar, session panel, and skills read through
 * `useAuiState(s => s.thread.extras)`. Split from `use-chat-thread-runtime.ts`
 * along the producer/consumer seam: that module builds the runtime (and is
 * imported exactly twice), this one is what the rest of the app imports.
 *
 * `extras` carries all non-message state + action callbacks. No separate
 * store — the controller's reducer state is the sole source.
 */
import { useAuiState } from '@assistant-ui/react';
import { useMemo } from 'react';
import type { ControlResponse, QueuedMessageRef, WorktreeSwitchOffer } from '@qlan-ro/mainframe-types';
import type { AcpChatController } from '../controller/acp-chat-controller';
import type { ChatThreadState, ChatPermissionEntry } from '../controller/chat-thread-state';
import { selectPermissionFront } from '../gates/select-front';

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
 * the split-view zone mount so `useChatExtras()` consumers behave identically
 * in a zone. Lives here because the brand symbol is module-private on purpose.
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

/** isRunning derivation (mirrors react-opencode's isOpenCodeStateRunning). */
export function isRunningFromState(state: ChatThreadState): boolean {
  return state.runState.type === 'running' || state.runState.type === 'cancelling';
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
