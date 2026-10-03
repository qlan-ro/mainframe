import type { ChatStateEvent, ChatThreadState } from './chat-thread-state';
import { reduceEnvironmentEvent, type EnvironmentEvent } from './chat-environment-state';
import { reduceLocalMessageEvent, type LocalMessageEvent } from './chat-reconcile';

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
      return state.messages.length === 0 ? state : { ...state, messages: [] };
    case 'run.started':
      return { ...state, runState: { type: 'running' } };
    case 'run.cancelling':
      return { ...state, runState: { type: 'cancelling' } };
    case 'run.stopped':
      return { ...state, runState: { type: 'idle' }, compacting: false };
    case 'run.failed':
      return { ...state, runState: { type: 'error', error: event.error }, compacting: false };
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
      return { ...state, interactions: { ...state.interactions, queued } };
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
      return reduceLocalMessageEvent(state, event);
    default:
      return reduceEnvironmentEvent(state, event);
  }
}
export function reduceChatThreadState(state: ChatThreadState, event: ChatStateEvent): ChatThreadState {
  switch (event.type) {
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
    case 'context.usage':
      return {
        ...state,
        contextUsage: { percentage: event.percentage, totalTokens: event.totalTokens, maxTokens: event.maxTokens },
      };
    case 'compact.started':
      return state.compacting ? state : { ...state, compacting: true };
    case 'compact.done':
      return state.compacting ? { ...state, compacting: false } : state;
    default:
      return reduceDelegated(state, event);
  }
}
