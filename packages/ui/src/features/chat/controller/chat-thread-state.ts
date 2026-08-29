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
import type { ControlRequest, PermissionOption, QueuedMessageRef } from '@qlan-ro/mainframe-types';
import {
  createEnvironmentSlice,
  reduceEnvironmentEvent,
  type ChatEnvironmentSlice,
  type EnvironmentEvent,
} from './chat-environment-state';
import { reduceLocalMessageEvent, type LocalMessageEvent } from './chat-reconcile';

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
  | { type: 'permission.requested'; requestId: string; request: ControlRequest; options: PermissionOption[] }
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

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduceChatThreadState(state: ChatThreadState, event: ChatStateEvent): ChatThreadState {
  switch (event.type) {
    case 'history.loading':
      return { ...state, loadState: { type: 'loading' } };

    // A background re-seed came back empty for a thread that holds messages, and
    // was refused (see the controller). Only the load state settles — the
    // transcript is deliberately left alone.
    case 'history.refresh.refused':
      return { ...state, loadState: { type: 'ready' } };

    case 'history.ready':
      return state.loadState.type === 'ready' ? state : { ...state, loadState: { type: 'ready' } };

    case 'transcript.updated':
      return { ...state, messages: event.messages };

    case 'transcript.cleared':
      return state.messages.length === 0 ? state : { ...state, messages: [] };

    case 'history.failed':
      return { ...state, loadState: { type: 'error', error: event.error } };

    case 'run.started':
      return { ...state, runState: { type: 'running' } };

    case 'run.cancelling':
      return { ...state, runState: { type: 'cancelling' } };

    // Run-end also clears `compacting`: a run that dies mid-compaction never
    // sends compact.done, and the pill must not strand.
    case 'run.stopped':
      return { ...state, runState: { type: 'idle' }, compacting: false };

    case 'run.failed':
      return { ...state, runState: { type: 'error', error: event.error }, compacting: false };

    case 'chat.id.adopted':
      return state.chatId === event.chatId ? state : { ...state, chatId: event.chatId };

    case 'permission.requested': {
      const entry: ChatPermissionEntry = {
        requestId: event.requestId,
        request: event.request,
        askedAt: Date.now(),
        options: event.options,
      };
      return {
        ...state,
        interactions: {
          ...state.interactions,
          permissions: {
            ...state.interactions.permissions,
            [event.requestId]: entry,
          },
        },
      };
    }

    case 'permission.resolved': {
      const permissions = { ...state.interactions.permissions };
      delete permissions[event.requestId];
      return {
        ...state,
        interactions: { ...state.interactions, permissions },
      };
    }

    case 'queued.snapshot': {
      // Rehydrates the queued list on open/reconnect: replace the entire queued
      // map with a fresh record built from the snapshot refs.
      const queued: Record<string, QueuedMessageRef> = {};
      for (const ref of event.refs) {
        queued[ref.uuid] = ref;
      }
      return {
        ...state,
        interactions: { ...state.interactions, queued },
      };
    }

    case 'context.usage':
      return {
        ...state,
        contextUsage: {
          percentage: event.percentage,
          totalTokens: event.totalTokens,
          maxTokens: event.maxTokens,
        },
      };

    case 'compact.started':
      return state.compacting ? state : { ...state, compacting: true };

    case 'compact.done':
      return state.compacting ? { ...state, compacting: false } : state;

    case 'local.message.queued':
    case 'local.message.reconciled':
    case 'local.message.failed':
    case 'local.message.attachments_restored':
    case 'local.message.retrying':
      return reduceLocalMessageEvent(state, event);

    case 'chat.config.updated':
    case 'workflow.runs.seeded':
    case 'workflow.run.updated':
    case 'background.upsert':
    case 'background.ended':
    case 'background.snapshot':
    case 'worktree.offer.added':
    case 'worktree.offer.removed':
    case 'worktree.offer.snapshot':
    case 'worktree.switch.started':
    case 'worktree.switch.failed':
    case 'worktree.switch.cleared':
      return reduceEnvironmentEvent(state, event);
  }
}
