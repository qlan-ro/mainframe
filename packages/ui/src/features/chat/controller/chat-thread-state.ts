/**
 * Pure state shape + reducer for a single chat thread.
 *
 * Mirrors react-opencode's `openCodeThreadState.ts`, adapted to the two
 * planes the controller composes (desktop-cutover pass):
 *  - messages — the CONVERTED transcript, dispatched whole by the ACP
 *    session plane (`transcript.updated`) each time the item accumulator
 *    changes; the reducer never sees raw wire frames
 *  - loadState — facade attach status
 *  - runState — facade `state_update` frames + legacy chat.updated
 *    isRunning (both derive from the same ChatManager truth) + the
 *    optimistic send
 *  - interactions.permissions — facade `session/request_permission` /
 *    `gate_resolved`, still keyed by `ControlRequest.requestId`
 *  - interactions.queued — facade `_mainframe.dev/queue_state` snapshots
 *    (full replacements, live and post-resume)
 *  - pendingUserMessages — optimistic send, reconciled on echo (the
 *    `local.message.*` sub-reducer lives with the reconcile matcher in
 *    `chat-reconcile.ts`)
 *  - the environment slice (chat config, background tasks, workflow runs,
 *    worktree offers) — side-band `/` WS events, reduced in
 *    `chat-environment-state.ts`
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ControlRequest, PermissionOption, PromptSendMeta, QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { createEnvironmentSlice, type ChatEnvironmentSlice, type EnvironmentEvent } from './chat-environment-state';
import type { LocalMessageEvent } from './chat-reconcile';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface PendingUserMessage {
  clientId: string;
  chatId: string;
  text: string;
  createdAt: number;
  status: 'pending' | 'failed';
  error?: unknown;
  stage?: 'upload' | 'send';
  attachmentsRestored?: boolean;
  /** The send meta (e.g. a `/command` invocation) a retry must re-carry — text-only, attachmentIds are never re-added here. */
  sendMeta?: PromptSendMeta;
}

export interface ChatPermissionEntry {
  requestId: string;
  request: ControlRequest;
  askedAt: number;
  /**
   * The adapter-supplied, ordered option list off the wire `RequestPermissionRequest`
   * (spec decision 12) — the gate renders exactly this set/order/labels and must not
   * infer an option's effect from its id or label, only from `kind`.
   */
  options: PermissionOption[];
  /**
   * `true` when the daemon's `_meta.controlRequest` was absent/unparseable and
   * `request` is the client's own stand-in (spec decision 27) — `ChatGateMount`
   * routes these to the generic `PermissionGate` regardless of `toolName`,
   * since a synthesized request never carries real `input` for the rich
   * Plan/AskUserQuestion cards to read.
   */
  synthesizedRequest?: boolean;
}

export type LoadState = { type: 'idle' } | { type: 'loading' } | { type: 'ready' } | { type: 'error'; error: unknown };

export type RunState =
  { type: 'idle' } | { type: 'running' } | { type: 'cancelling' } | { type: 'error'; error: unknown };

export interface ChatThreadState extends ChatEnvironmentSlice {
  /**
   * The network id for this chat — starts as the `__LOCALID_*` placeholder for a
   * thread created this session, then flips to the daemon id via `chat.id.adopted`
   * once `ChatThreadController.setRemoteId` resolves. Every `extras.state.chatId`
   * reader (composer tuning PATCHes, the diff-expand fetch, the `@`-file search
   * scope) depends on this flip to stop targeting a dead local id after adopt.
   */
  readonly chatId: string;
  readonly authoritativeItemStreaming: boolean;
  readonly loadState: LoadState;
  readonly runState: RunState;
  /** The converted transcript, projected as-is into the message repository. */
  readonly messages: readonly ThreadMessageLike[];
  readonly interactions: {
    readonly permissions: Readonly<Record<string, ChatPermissionEntry>>;
    readonly queued: Readonly<Record<string, QueuedMessageRef>>;
  };
  readonly pendingUserMessages: Readonly<Record<string, PendingUserMessage>>;
  /**
   * CLI-reported context-window usage (facade `usage_update`). Null until
   * the first report; the session bar falls back to a token estimate from
   * chatConfig when null.
   */
  readonly contextUsage: { percentage: number; totalTokens: number; maxTokens: number } | null;
  /** True between the compaction `started` and `done` phases (also cleared on
   *  run end) — drives the transcript "Compacting…" pill. */
  readonly compacting: boolean;
}

// ---------------------------------------------------------------------------
// Events (internal reducer events, distinct from DaemonEvents)
// ---------------------------------------------------------------------------

export type ChatStateEvent =
  | { type: 'capabilities.updated'; authoritativeItemStreaming: boolean }
  | { type: 'history.loading' }
  | { type: 'history.refresh.refused' }
  | { type: 'history.ready' }
  | { type: 'history.failed'; error: unknown }
  | { type: 'transcript.updated'; messages: readonly ThreadMessageLike[] }
  | { type: 'transcript.cleared' }
  | { type: 'run.started' }
  | { type: 'run.cancelling' }
  | { type: 'run.stopped' }
  | { type: 'run.failed'; error: unknown }
  | {
      type: 'permission.requested';
      requestId: string;
      request: ControlRequest;
      options: PermissionOption[];
      synthesizedRequest?: boolean;
    }
  | { type: 'permission.resolved'; requestId: string }
  | { type: 'queued.snapshot'; refs: QueuedMessageRef[] }
  | { type: 'chat.id.adopted'; chatId: string }
  | { type: 'context.usage'; percentage: number; totalTokens: number; maxTokens: number }
  | { type: 'compact.started' }
  | { type: 'compact.done' }
  | LocalMessageEvent
  | EnvironmentEvent;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createChatThreadState(chatId: string): ChatThreadState {
  return {
    chatId,
    authoritativeItemStreaming: false,
    loadState: { type: 'idle' },
    runState: { type: 'idle' },
    messages: [],
    interactions: {
      permissions: {} as Readonly<Record<string, ChatPermissionEntry>>,
      queued: {} as Readonly<Record<string, QueuedMessageRef>>,
    },
    pendingUserMessages: {} as Readonly<Record<string, PendingUserMessage>>,
    contextUsage: null,
    compacting: false,
    ...createEnvironmentSlice(),
  };
}

export { reduceChatThreadState } from './chat-thread-reducer';
