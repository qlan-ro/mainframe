import type { ChatStateEvent, ChatThreadState } from './chat-thread-state';
import { reduceEnvironmentEvent, type EnvironmentEvent } from './chat-environment-state';
import { reduceLocalMessageEvent, type LocalMessageEvent } from './chat-reconcile';
import { pruneQueuedPreviews } from './local-attachments';

type LifecycleEvent = Extract<
  ChatStateEvent,
  {
    type:
      | 'history.loading'
      | 'history.refresh.refused'
      | 'history.ready'
      | 'history.failed'
      | 'transcript.updated'
      | 'transcript.cleared'
      | 'run.started'
      | 'run.cancelling'
      | 'run.stopped'
      | 'run.failed';
  }
>;
type InteractionEvent = Extract<
  ChatStateEvent,
  { type: 'permission.requested' | 'permission.resolved' | 'queued.snapshot' }
>;

function reduceLifecycle(state: ChatThreadState, event: LifecycleEvent): ChatThreadState {
  switch (event.type) {
    case 'history.loading':
      return { ...state, loadState: { type: 'loading' } };
    case 'history.refresh.refused':
      return { ...state, loadState: { type: 'ready' } };
    case 'history.ready':
      return state.loadState.type === 'ready' ? state : { ...state, loadState: { type: 'ready' } };
    case 'history.failed':
      return { ...state, loadState: { type: 'error', error: event.error } };
    case 'transcript.updated':
      return { ...state, messages: event.messages };
    case 'transcript.cleared':
      return state.messages.length === 0 && state.retry === null ? state : { ...state, messages: [], retry: null };
    case 'run.started': {
      // A later start frame without a time (a local send, a reconnect) keeps the known start of the same run.
      const known = state.runState.type === 'running' ? state.runState.startedAtMs : undefined;
      const startedAtMs = event.startedAtMs ?? known;
      // A retry belongs to its turn: only a start that continues a running turn keeps it.
      const retry = state.runState.type === 'running' ? state.retry : null;
      return {
        ...state,
        retry,
        runState: startedAtMs === undefined ? { type: 'running' } : { type: 'running', startedAtMs },
      };
    }
    case 'run.cancelling': {
      const startedAtMs = state.runState.type === 'running' ? state.runState.startedAtMs : undefined;
      return {
        ...state,
        retry: null,
        runState: startedAtMs === undefined ? { type: 'cancelling' } : { type: 'cancelling', startedAtMs },
      };
    }
    case 'run.stopped':
      return { ...state, runState: { type: 'idle' }, compacting: false, retry: null };
    case 'run.failed':
      return { ...state, runState: { type: 'error', error: event.error }, compacting: false, retry: null };
  }
}
function reduceInteraction(state: ChatThreadState, event: InteractionEvent): ChatThreadState {
  switch (event.type) {
    case 'permission.requested': {
      const entry = {
        requestId: event.requestId,
        request: event.request,
        askedAt: Date.now(),
        options: event.options,
        synthesizedRequest: event.synthesizedRequest,
      };
      return {
        ...state,
        interactions: {
          ...state.interactions,
          permissions: { ...state.interactions.permissions, [event.requestId]: entry },
        },
      };
    }
    case 'permission.resolved': {
      const permissions = { ...state.interactions.permissions };
      delete permissions[event.requestId];
      return { ...state, interactions: { ...state.interactions, permissions } };
    }
    case 'queued.snapshot': {
      const queued = Object.fromEntries(event.refs.map((ref) => [ref.uuid, ref]));
      const queuedAttachmentPreviews = pruneQueuedPreviews(
        state.queuedAttachmentPreviews,
        Object.values(state.interactions.queued),
        event.refs,
      );
      return { ...state, interactions: { ...state.interactions, queued }, queuedAttachmentPreviews };
    }
  }
}
function reduceDelegated(state: ChatThreadState, event: LocalMessageEvent | EnvironmentEvent): ChatThreadState {
  switch (event.type) {
    case 'local.message.queued':
    case 'local.message.reconciled':
    case 'local.message.failed':
    case 'local.message.attachments_restored':
    case 'local.message.retrying':
    case 'local.attachments.queued':
      return reduceLocalMessageEvent(state, event);
    default:
      return reduceEnvironmentEvent(state, event);
  }
}
type RetryEvent = Extract<ChatStateEvent, { type: 'retry.status' }>;
/** Keeps `maxAttempts` off the object when the provider gave none. */
const retryOf = ({ attempt, maxAttempts }: RetryEvent): NonNullable<ChatThreadState['retry']> =>
  maxAttempts === undefined ? { attempt } : { attempt, maxAttempts };
const sameRetry = (current: ChatThreadState['retry'], next: RetryEvent): boolean =>
  current !== null && current.attempt === next.attempt && current.maxAttempts === next.maxAttempts;

/** Compaction and reconnect state: transient flags of the running turn. */
function reduceTransient(
  state: ChatThreadState,
  event: Extract<ChatStateEvent, { type: 'compact.started' | 'compact.done' | 'retry.status' | 'retry.cleared' }>,
): ChatThreadState {
  switch (event.type) {
    case 'compact.started':
      return state.compacting ? state : { ...state, compacting: true };
    case 'compact.done':
      return state.compacting ? { ...state, compacting: false } : state;
    case 'retry.status':
      return sameRetry(state.retry, event) ? state : { ...state, retry: retryOf(event) };
    case 'retry.cleared':
      return state.retry === null ? state : { ...state, retry: null };
  }
}

export function reduceChatThreadState(state: ChatThreadState, event: ChatStateEvent): ChatThreadState {
  switch (event.type) {
    case 'history.window':
      return { ...state, historyWindow: event.history };
    case 'history.loading':
    case 'history.refresh.refused':
    case 'history.ready':
    case 'history.failed':
    case 'transcript.updated':
    case 'transcript.cleared':
    case 'run.started':
    case 'run.cancelling':
    case 'run.stopped':
    case 'run.failed':
      return reduceLifecycle(state, event);
    case 'permission.requested':
    case 'permission.resolved':
    case 'queued.snapshot':
      return reduceInteraction(state, event);
    case 'capabilities.updated':
      return state.authoritativeItemStreaming === event.authoritativeItemStreaming
        ? state
        : { ...state, authoritativeItemStreaming: event.authoritativeItemStreaming };
    case 'chat.id.adopted':
      return state.chatId === event.chatId ? state : { ...state, chatId: event.chatId };
    case 'context.usage': {
      // The adapter repeats unchanged totals; a fresh slice would move `extras`
      // and re-render every consumer for nothing.
      const prev = state.contextUsage;
      if (
        prev != null &&
        prev.percentage === event.percentage &&
        prev.totalTokens === event.totalTokens &&
        prev.maxTokens === event.maxTokens
      )
        return state;
      return {
        ...state,
        contextUsage: { percentage: event.percentage, totalTokens: event.totalTokens, maxTokens: event.maxTokens },
      };
    }
    case 'compact.started':
    case 'compact.done':
    case 'retry.status':
    case 'retry.cleared':
      return reduceTransient(state, event);
    default:
      return reduceDelegated(state, event);
  }
}
