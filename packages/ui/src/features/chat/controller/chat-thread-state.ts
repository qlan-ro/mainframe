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
 *  - interactions.queued — legacy side-band message.queued.* events (the
 *    facade has no queue-list surface yet)
 *  - pendingUserMessages — optimistic send, reconciled on echo
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type {
  BackgroundActivityTask,
  Chat,
  ClaudeWorkflowRun,
  ControlRequest,
  QueuedMessageRef,
  WorktreeSwitchOffer,
} from '@qlan-ro/mainframe-types';
import { seedWorkflowRuns, upsertWorkflowRun, type WorkflowRunsSlice } from './chat-workflow-runs';
import { sameBackgroundTasks, sameWorktreeOffers } from './snapshot-equality';

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
}

export type LoadState = { type: 'idle' } | { type: 'loading' } | { type: 'ready' } | { type: 'error'; error: unknown };

export type RunState =
  { type: 'idle' } | { type: 'running' } | { type: 'cancelling' } | { type: 'error'; error: unknown };

export interface ChatThreadState {
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
   * Latest chat metadata from the daemon's `chat.updated` broadcast — model,
   * planMode, permissionMode, effort, features, etc. Null until the first
   * `chat.updated` arrives. The composer config toolbar reads this so its
   * controls stay in sync when the daemon changes them on its own (e.g. the
   * agent exiting plan mode), instead of a stale one-shot REST snapshot.
   */
  readonly chatConfig: Chat | null;
  /**
   * CLI-reported context-window usage (daemon `chat.contextUsage`). Null until
   * the first report; the session bar falls back to a token estimate from
   * chatConfig when null.
   */
  readonly contextUsage: { percentage: number; totalTokens: number; maxTokens: number } | null;
  /** True between `chat.compacting` and `chat.compactDone` (also cleared on
   *  run end) — drives the transcript "Compacting…" pill. */
  readonly compacting: boolean;
  /**
   * Live background work (agents / bg bash / workflows) keyed by task id — fed
   * by `background_task.*` events, resynced from `chat.updated`'s
   * `backgroundActivity` snapshot. Drives the session panel's Background
   * Activity section and its rail badge.
   */
  readonly backgroundTasks: Readonly<Record<string, BackgroundActivityTask>>;
  /**
   * Claude CLI workflow runs keyed by the CLI task id — fed by
   * `claude_workflow.run.updated` and re-seeded from the history payload, which
   * is what survives a reload of a run that finished while the webview was gone.
   */
  readonly workflowRuns: WorkflowRunsSlice;
  /**
   * Worktrees the agent created during this session that the chat is not bound
   * to yet, keyed by canonical worktree path — fed by `worktree.offer.*`.
   * Drives the WorktreeSwitchBanner.
   */
  readonly worktreeOffers: Readonly<Record<string, WorktreeSwitchOffer>>;
  /**
   * An accepted offer whose rebind is in flight. `restarting` until the daemon
   * broadcasts a `chat.updated` carrying the target path, then `settled` — the
   * banner shows the confirmation and clears it after a beat.
   */
  readonly switching: { readonly worktreePath: string; readonly phase: 'restarting' | 'settled' } | null;
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
  | { type: 'workflow.runs.seeded'; runs: ClaudeWorkflowRun[] }
  | { type: 'run.started' }
  | { type: 'run.cancelling' }
  | { type: 'run.stopped' }
  | { type: 'run.failed'; error: unknown }
  | { type: 'permission.requested'; requestId: string; request: ControlRequest }
  | { type: 'permission.resolved'; requestId: string }
  | { type: 'queued.added'; ref: QueuedMessageRef }
  | { type: 'queued.removed'; uuid: string }
  | { type: 'queued.cleared' }
  | { type: 'queued.snapshot'; refs: QueuedMessageRef[] }
  | { type: 'local.message.queued'; pending: PendingUserMessage }
  | { type: 'local.message.reconciled'; clientId: string }
  | { type: 'local.message.failed'; clientId: string; error: unknown; stage?: 'upload' | 'send' }
  | { type: 'local.message.attachments_restored'; clientId: string }
  | { type: 'local.message.retrying'; clientId: string }
  | { type: 'chat.config.updated'; chat: Chat }
  | { type: 'chat.id.adopted'; chatId: string }
  | { type: 'context.usage'; percentage: number; totalTokens: number; maxTokens: number }
  | { type: 'compact.started' }
  | { type: 'compact.done' }
  | { type: 'background.upsert'; task: BackgroundActivityTask }
  | { type: 'background.ended'; taskId: string }
  | { type: 'background.snapshot'; tasks: BackgroundActivityTask[] }
  | { type: 'workflow.run.updated'; run: ClaudeWorkflowRun }
  | { type: 'worktree.offer.added'; offer: WorktreeSwitchOffer }
  | { type: 'worktree.offer.removed'; worktreePath: string }
  | { type: 'worktree.offer.snapshot'; offers: WorktreeSwitchOffer[] }
  | { type: 'worktree.switch.started'; worktreePath: string }
  | { type: 'worktree.switch.failed' }
  | { type: 'worktree.switch.cleared' };

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
    chatConfig: null,
    contextUsage: null,
    compacting: false,
    backgroundTasks: {} as Readonly<Record<string, BackgroundActivityTask>>,
    workflowRuns: {} as WorkflowRunsSlice,
    worktreeOffers: {} as Readonly<Record<string, WorktreeSwitchOffer>>,
    switching: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function removePending(state: ChatThreadState, clientId: string): ChatThreadState {
  if (!(clientId in state.pendingUserMessages)) return state;
  const pendingUserMessages = { ...state.pendingUserMessages };
  delete pendingUserMessages[clientId];
  return { ...state, pendingUserMessages };
}

/**
 * The chat row's persisted CLI-reported context usage (daemon persists it from
 * `get_context_usage` after each turn), mapped to the contextUsage slice shape.
 * Null when the chat has never reported (legacy rows, codex).
 */
function persistedContextUsage(chat: Chat | null): ChatThreadState['contextUsage'] {
  if (chat == null) return null;
  const { lastContextTotalTokens: total, lastContextMaxTokens: max } = chat;
  if (total == null || max == null || max <= 0) return null;
  return { percentage: (total / max) * 100, totalTokens: total, maxTokens: max };
}

/** True when every composer-toolbar field of two chats is equal (ignores cost/token/updatedAt churn). */
function sameComposerConfig(a: Chat | null, b: Chat): boolean {
  return (
    a !== null &&
    a.adapterId === b.adapterId &&
    a.model === b.model &&
    a.permissionMode === b.permissionMode &&
    a.planMode === b.planMode &&
    a.effort === b.effort &&
    a.fast === b.fast &&
    a.ultracode === b.ultracode &&
    a.adaptiveThinking === b.adaptiveThinking &&
    a.worktreeMissing === b.worktreeMissing &&
    a.directoryMissing === b.directoryMissing &&
    a.missingDirectoryPath === b.missingDirectoryPath &&
    a.transcriptMissing === b.transcriptMissing &&
    a.worktreePath === b.worktreePath &&
    a.branchName === b.branchName
  );
}

/**
 * The daemon's `chat.updated` carrying the target path is the only confirmation
 * that an accepted switch rebound the chat, so the settle is derived here rather
 * than optimistically on accept.
 */
function nextSwitching(state: ChatThreadState, chat: Chat): ChatThreadState['switching'] {
  const { switching } = state;
  if (switching === null || switching.phase === 'settled') return switching;
  if (chat.worktreePath !== switching.worktreePath) return switching;
  return { worktreePath: switching.worktreePath, phase: 'settled' };
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

    case 'workflow.runs.seeded':
      return { ...state, workflowRuns: seedWorkflowRuns(event.runs) };

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

    case 'chat.config.updated': {
      // chat.updated also fires for cost/token/updatedAt churn during a run.
      // Only adopt a new identity when a composer-relevant field actually changed,
      // so the toolbar doesn't re-render on every broadcast. The persisted
      // context totals are adopted separately: they keep the meter truthful on
      // controller seed and after turns completed while this chat was dormant
      // (chat.contextUsage only reaches subscribers; chat.updated is ungated).
      const persisted = persistedContextUsage(event.chat);
      const sameUsage =
        persisted == null ||
        (state.contextUsage != null &&
          state.contextUsage.totalTokens === persisted.totalTokens &&
          state.contextUsage.maxTokens === persisted.maxTokens);
      const sameConfig = sameComposerConfig(state.chatConfig, event.chat);
      const switching = nextSwitching(state, event.chat);
      if (sameConfig && sameUsage && switching === state.switching) return state;
      return {
        ...state,
        chatConfig: sameConfig ? state.chatConfig : event.chat,
        contextUsage: sameUsage ? state.contextUsage : persisted,
        switching,
      };
    }

    case 'permission.requested': {
      const entry: ChatPermissionEntry = {
        requestId: event.requestId,
        request: event.request,
        askedAt: Date.now(),
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

    case 'queued.added':
      return {
        ...state,
        interactions: {
          ...state.interactions,
          queued: {
            ...state.interactions.queued,
            [event.ref.uuid]: event.ref,
          },
        },
      };

    case 'queued.removed': {
      const queued = { ...state.interactions.queued };
      delete queued[event.uuid];
      return { ...state, interactions: { ...state.interactions, queued } };
    }

    case 'queued.cleared':
      return {
        ...state,
        interactions: {
          ...state.interactions,
          queued: {} as Readonly<Record<string, QueuedMessageRef>>,
        },
      };

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

    case 'background.upsert':
      return {
        ...state,
        backgroundTasks: { ...state.backgroundTasks, [event.task.id]: event.task },
      };

    case 'background.ended': {
      if (!(event.taskId in state.backgroundTasks)) return state;
      const backgroundTasks = { ...state.backgroundTasks };
      delete backgroundTasks[event.taskId];
      return { ...state, backgroundTasks };
    }

    case 'background.snapshot': {
      // chat.updated fires on every turn boundary — bail identity-stable when
      // the snapshot matches so the composer doesn't re-render on churn.
      if (sameBackgroundTasks(state.backgroundTasks, event.tasks)) return state;
      const backgroundTasks: Record<string, BackgroundActivityTask> = {};
      for (const task of event.tasks) backgroundTasks[task.id] = task;
      return { ...state, backgroundTasks };
    }

    case 'workflow.run.updated': {
      const workflowRuns = upsertWorkflowRun(state.workflowRuns, event.run);
      return workflowRuns === state.workflowRuns ? state : { ...state, workflowRuns };
    }

    case 'worktree.offer.added':
      return {
        ...state,
        worktreeOffers: { ...state.worktreeOffers, [event.offer.worktreePath]: event.offer },
      };

    case 'worktree.offer.removed': {
      if (!(event.worktreePath in state.worktreeOffers)) return state;
      const worktreeOffers = { ...state.worktreeOffers };
      delete worktreeOffers[event.worktreePath];
      return { ...state, worktreeOffers };
    }

    case 'worktree.offer.snapshot': {
      // Resent on every subscribe/reconnect — bail identity-stable when nothing
      // moved so the composer doesn't re-render on reconnect churn.
      if (sameWorktreeOffers(state.worktreeOffers, event.offers)) return state;
      const worktreeOffers: Record<string, WorktreeSwitchOffer> = {};
      for (const offer of event.offers) worktreeOffers[offer.worktreePath] = offer;
      return { ...state, worktreeOffers };
    }

    case 'worktree.switch.started':
      return { ...state, switching: { worktreePath: event.worktreePath, phase: 'restarting' } };

    case 'worktree.switch.failed':
    case 'worktree.switch.cleared':
      return state.switching === null ? state : { ...state, switching: null };

    case 'local.message.queued':
      return {
        ...state,
        pendingUserMessages: {
          ...state.pendingUserMessages,
          [event.pending.clientId]: event.pending,
        },
      };

    case 'local.message.reconciled':
      return removePending(state, event.clientId);

    case 'local.message.failed': {
      const current = state.pendingUserMessages[event.clientId];
      if (!current) return state;
      return {
        ...state,
        pendingUserMessages: {
          ...state.pendingUserMessages,
          [event.clientId]: { ...current, status: 'failed', error: event.error, stage: event.stage },
        },
        runState: { type: 'error', error: event.error },
      };
    }

    case 'local.message.attachments_restored': {
      const current = state.pendingUserMessages[event.clientId];
      if (!current || current.attachmentsRestored) return state;
      return {
        ...state,
        pendingUserMessages: {
          ...state.pendingUserMessages,
          [event.clientId]: { ...current, attachmentsRestored: true },
        },
      };
    }

    case 'local.message.retrying': {
      const current = state.pendingUserMessages[event.clientId];
      if (!current) return state;
      const { error: _dropped, stage: _dropped2, attachmentsRestored: _dropped3, ...rest } = current;
      return {
        ...state,
        pendingUserMessages: {
          ...state.pendingUserMessages,
          [event.clientId]: { ...rest, status: 'pending' },
        },
      };
    }
  }
}
