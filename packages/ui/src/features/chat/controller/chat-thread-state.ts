/**
 * Pure state shape + reducer for a single chat thread.
 *
 * Mirrors react-opencode's `openCodeThreadState.ts` but adapted to our
 * daemon protocol: messages arrive as whole DisplayMessage objects
 * (display.message.added / display.message.updated), not as part-level
 * deltas. The reducer only handles message-level upsert and a REST
 * refetch-on-gap trigger — no part.delta/part.updated paths.
 *
 * State holds:
 *  - messagesById / messageOrder — the daemon's display list
 *  - loadState — REST seed status
 *  - runState — derived from daemon chat.updated / process.started events
 *  - interactions.permissions — from permission.requested / permission.resolved
 *  - interactions.queued — from message.queued.* events
 *  - pendingUserMessages — optimistic send, reconciled on echo
 */
import type {
  BackgroundActivityTask,
  Chat,
  ControlRequest,
  DisplayMessage,
  QueuedMessageRef,
} from '@qlan-ro/mainframe-types';

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
}

export interface ChatPermissionEntry {
  requestId: string;
  request: ControlRequest;
  askedAt: number;
}

export type LoadState = { type: 'idle' } | { type: 'loading' } | { type: 'ready' } | { type: 'error'; error: unknown };

export type RunState =
  | { type: 'idle' }
  | { type: 'running' }
  | { type: 'cancelling' }
  | { type: 'error'; error: unknown };

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
  readonly messagesById: Readonly<Record<string, DisplayMessage>>;
  readonly messageOrder: readonly string[];
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
  /** True between `chat.compacting` and `chat.compactDone` — session-bar status. */
  readonly compacting: boolean;
  /**
   * Live background work (agents / bg bash / workflows) keyed by task id — fed
   * by `background_task.*` events, resynced from `chat.updated`'s
   * `backgroundActivity` snapshot. Drives the BackgroundActivityBar chip.
   */
  readonly backgroundTasks: Readonly<Record<string, BackgroundActivityTask>>;
}

// ---------------------------------------------------------------------------
// Events (internal reducer events, distinct from DaemonEvents)
// ---------------------------------------------------------------------------

export type ChatStateEvent =
  | { type: 'history.loading' }
  | { type: 'history.loaded'; messages: DisplayMessage[] }
  | { type: 'history.failed'; error: unknown }
  | { type: 'run.started' }
  | { type: 'run.cancelling' }
  | { type: 'run.stopped' }
  | { type: 'run.failed'; error: unknown }
  | { type: 'message.added'; message: DisplayMessage }
  | { type: 'message.updated'; message: DisplayMessage }
  | { type: 'messages.cleared' }
  | { type: 'permission.requested'; requestId: string; request: ControlRequest }
  | { type: 'permission.resolved'; requestId: string }
  | { type: 'queued.added'; ref: QueuedMessageRef }
  | { type: 'queued.removed'; uuid: string }
  | { type: 'queued.cleared' }
  | { type: 'queued.snapshot'; refs: QueuedMessageRef[] }
  | { type: 'local.message.queued'; pending: PendingUserMessage }
  | { type: 'local.message.reconciled'; clientId: string }
  | { type: 'local.message.failed'; clientId: string; error: unknown }
  | { type: 'local.message.retrying'; clientId: string }
  | { type: 'chat.config.updated'; chat: Chat }
  | { type: 'chat.id.adopted'; chatId: string }
  | { type: 'context.usage'; percentage: number; totalTokens: number; maxTokens: number }
  | { type: 'compact.started' }
  | { type: 'compact.done' }
  | { type: 'background.upsert'; task: BackgroundActivityTask }
  | { type: 'background.ended'; taskId: string }
  | { type: 'background.snapshot'; tasks: BackgroundActivityTask[] };

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createChatThreadState(chatId: string): ChatThreadState {
  return {
    chatId,
    loadState: { type: 'idle' },
    runState: { type: 'idle' },
    messagesById: {} as Readonly<Record<string, DisplayMessage>>,
    messageOrder: [],
    interactions: {
      permissions: {} as Readonly<Record<string, ChatPermissionEntry>>,
      queued: {} as Readonly<Record<string, QueuedMessageRef>>,
    },
    pendingUserMessages: {} as Readonly<Record<string, PendingUserMessage>>,
    chatConfig: null,
    contextUsage: null,
    compacting: false,
    backgroundTasks: {} as Readonly<Record<string, BackgroundActivityTask>>,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function upsertMessage(state: ChatThreadState, message: DisplayMessage): ChatThreadState {
  const isNew = !(message.id in state.messagesById);
  const messagesById = { ...state.messagesById, [message.id]: message };
  const messageOrder = isNew ? [...state.messageOrder, message.id] : state.messageOrder;
  return { ...state, messagesById, messageOrder };
}

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
    a.worktreePath === b.worktreePath &&
    a.branchName === b.branchName
  );
}

/** True when the snapshot lists exactly the tasks already in state (field-equal). */
function sameBackgroundTasks(
  current: Readonly<Record<string, BackgroundActivityTask>>,
  snapshot: BackgroundActivityTask[],
): boolean {
  if (Object.keys(current).length !== snapshot.length) return false;
  return snapshot.every((t) => {
    const c = current[t.id];
    return c !== undefined && c.kind === t.kind && c.description === t.description && c.startedAt === t.startedAt;
  });
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduceChatThreadState(state: ChatThreadState, event: ChatStateEvent): ChatThreadState {
  switch (event.type) {
    case 'history.loading':
      return { ...state, loadState: { type: 'loading' } };

    case 'history.loaded': {
      const messagesById: Record<string, DisplayMessage> = {};
      const messageOrder: string[] = [];
      for (const msg of event.messages) {
        messagesById[msg.id] = msg;
        messageOrder.push(msg.id);
      }
      return {
        ...state,
        loadState: { type: 'ready' },
        messagesById,
        messageOrder,
      };
    }

    case 'history.failed':
      return { ...state, loadState: { type: 'error', error: event.error } };

    case 'run.started':
      return { ...state, runState: { type: 'running' } };

    case 'run.cancelling':
      return { ...state, runState: { type: 'cancelling' } };

    case 'run.stopped':
      return { ...state, runState: { type: 'idle' } };

    case 'run.failed':
      return { ...state, runState: { type: 'error', error: event.error } };

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
      if (sameConfig && sameUsage) return state;
      return {
        ...state,
        chatConfig: sameConfig ? state.chatConfig : event.chat,
        contextUsage: sameUsage ? state.contextUsage : persisted,
      };
    }

    case 'message.added':
      return upsertMessage(state, event.message);

    case 'message.updated':
      return upsertMessage(state, event.message);

    case 'messages.cleared':
      return {
        ...state,
        messagesById: {} as Readonly<Record<string, DisplayMessage>>,
        messageOrder: [],
      };

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
          [event.clientId]: { ...current, status: 'failed', error: event.error },
        },
        runState: { type: 'error', error: event.error },
      };
    }

    case 'local.message.retrying': {
      const current = state.pendingUserMessages[event.clientId];
      if (!current) return state;
      const { error: _dropped, ...rest } = current;
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
