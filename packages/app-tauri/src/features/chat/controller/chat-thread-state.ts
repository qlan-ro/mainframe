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
import type { DisplayMessage, ControlRequest, QueuedMessageRef } from '@qlan-ro/mainframe-types';

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
  | { type: 'local.message.queued'; pending: PendingUserMessage }
  | { type: 'local.message.reconciled'; clientId: string }
  | { type: 'local.message.failed'; clientId: string; error: unknown };

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
  }
}
