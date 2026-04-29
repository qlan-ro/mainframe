// packages/core/src/plugins/builtin/codex/event-mapper.ts
import type { SessionSink } from '@qlan-ro/mainframe-types';
import type {
  ItemCompletedParams,
  TurnCompletedParams,
  TurnStartedParams,
  ThreadStartedParams,
  TokenUsageUpdatedParams,
} from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:events');

export interface CodexSessionState {
  threadId: string | null;
  currentTurnId: string | null;
  currentTurnPlan: { id: string; text: string } | null;
  lastUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
}

export function handleNotification(method: string, params: unknown, sink: SessionSink, state: CodexSessionState): void {
  log.debug({ method }, 'codex notification: %s', method);

  switch (method) {
    case 'thread/started':
      return handleThreadStarted(params as ThreadStartedParams, sink, state);
    case 'turn/started':
      return handleTurnStarted(params as TurnStartedParams, state);
    case 'item/completed':
      return handleItemCompleted(params as ItemCompletedParams, sink, state);
    case 'item/plan/delta':
      return handlePlanDelta(params as { itemId: string; delta: string }, state);
    case 'turn/completed':
      return handleTurnCompleted(params as TurnCompletedParams, sink, state);
    case 'thread/tokenUsage/updated':
      return handleTokenUsage(params as TokenUsageUpdatedParams, sink, state);
    case 'thread/compacted':
      sink.onCompact();
      return;
    // TODO: future — map turn/diff/updated to file change tracking / context.updated
    // TODO: future — map turn/plan/updated to Plans panel structured plan state
    case 'turn/diff/updated':
    case 'turn/plan/updated':
    case 'thread/closed':
    case 'thread/status/changed':
    case 'item/started':
    case 'item/agentMessage/delta':
    case 'item/commandExecution/outputDelta':
    case 'item/fileChange/outputDelta':
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
    case 'account/rateLimits/updated':
    case 'thread/name/updated':
      return; // silently ignore known-but-unhandled notifications
    default:
      if (method.startsWith('codex/event/')) return;
      log.debug({ method }, 'codex: unhandled notification');
  }
}

function handleThreadStarted(params: ThreadStartedParams, sink: SessionSink, state: CodexSessionState): void {
  state.threadId = params.thread.id;
  sink.onInit(params.thread.id);
}

function handleTurnStarted(params: TurnStartedParams, state: CodexSessionState): void {
  state.currentTurnPlan = null;
  state.currentTurnId = params.turn.id;
}

function handlePlanDelta(params: { itemId: string; delta: string }, state: CodexSessionState): void {
  const { itemId, delta } = params;
  const prev = state.currentTurnPlan;
  if (prev && prev.id === itemId) {
    state.currentTurnPlan = { id: itemId, text: prev.text + delta };
  } else {
    state.currentTurnPlan = { id: itemId, text: delta };
  }
}

function handleItemCompleted(params: ItemCompletedParams, sink: SessionSink, state: CodexSessionState): void {
  const { item } = params;

  // Plan items arrive as a terminal `item/completed` with type === 'plan'.
  // They aren't part of the formal ThreadItem union (yet), so branch defensively
  // before the typed switch below.
  const itemAsUnknown = item as { id?: string; type?: string; text?: string };
  if (itemAsUnknown.type === 'plan' && typeof itemAsUnknown.text === 'string' && itemAsUnknown.id) {
    state.currentTurnPlan = { id: itemAsUnknown.id, text: itemAsUnknown.text };
    return;
  }

  switch (item.type) {
    case 'agentMessage':
      sink.onMessage([{ type: 'text', text: item.text }]);
      return;

    case 'reasoning':
      sink.onMessage([{ type: 'thinking', thinking: item.summary.join('\n') || item.content.join('\n') }]);
      return;

    case 'commandExecution':
      sink.onMessage([
        {
          type: 'tool_use',
          id: item.id,
          name: 'command_execution',
          input: { command: item.command },
        },
      ]);
      sink.onToolResult([
        {
          type: 'tool_result',
          toolUseId: item.id,
          content: item.aggregatedOutput,
          isError: (item.exitCode ?? 0) !== 0,
        },
      ]);
      return;

    case 'fileChange':
      sink.onMessage([
        {
          type: 'tool_use',
          id: item.id,
          name: 'file_change',
          input: { changes: item.changes },
        },
      ]);
      sink.onToolResult([
        {
          type: 'tool_result',
          toolUseId: item.id,
          content: 'applied',
          isError: item.status === 'failed',
        },
      ]);
      return;

    case 'mcpToolCall':
      sink.onMessage([
        {
          type: 'tool_use',
          id: item.id,
          name: item.tool,
          input: item.arguments,
        },
      ]);
      sink.onToolResult([
        {
          type: 'tool_result',
          toolUseId: item.id,
          // TODO(F-B.2): simplify — error is now { message: string } | null, string branch is dead
          content: item.error
            ? typeof item.error === 'string'
              ? item.error
              : ((item.error as unknown as { message: string }).message ?? '')
            : JSON.stringify(item.result?.content ?? ''),
          isError: !!item.error,
        },
      ]);
      return;

    default:
      log.debug({ type: (item as { type: string }).type }, 'codex: unhandled item type');
  }
}

function handleTurnCompleted(params: TurnCompletedParams, sink: SessionSink, state: CodexSessionState): void {
  state.currentTurnPlan = null;
  state.currentTurnId = null;
  const { turn } = params;
  const isError = turn.status === 'failed' || turn.status === 'interrupted';

  sink.onResult({
    total_cost_usd: 0,
    usage: state.lastUsage,
    subtype: isError ? 'error_during_execution' : undefined,
    is_error: isError,
  });
  state.lastUsage = undefined;
}

function handleTokenUsage(params: TokenUsageUpdatedParams, _sink: SessionSink, state: CodexSessionState): void {
  state.lastUsage = {
    input_tokens: params.usage.input_tokens,
    output_tokens: params.usage.output_tokens,
    cache_read_input_tokens: params.usage.cached_input_tokens,
  };
}
