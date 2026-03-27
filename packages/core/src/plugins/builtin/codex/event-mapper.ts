// packages/core/src/plugins/builtin/codex/event-mapper.ts
import type { SessionSink } from '@qlan-ro/mainframe-types';
import type { ItemCompletedParams, TurnCompletedParams, TurnStartedParams, ThreadStartedParams } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:events');

export interface CodexSessionState {
  threadId: string | null;
  currentTurnId: string | null;
}

export function handleNotification(method: string, params: unknown, sink: SessionSink, state: CodexSessionState): void {
  log.debug({ method }, 'codex notification: %s', method);

  switch (method) {
    case 'thread/started':
      return handleThreadStarted(params as ThreadStartedParams, sink, state);
    case 'turn/started':
      return handleTurnStarted(params as TurnStartedParams, state);
    case 'item/completed':
      return handleItemCompleted(params as ItemCompletedParams, sink);
    case 'turn/completed':
      return handleTurnCompleted(params as TurnCompletedParams, sink, state);
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
    case 'item/plan/delta':
      return; // silently ignore known-but-unhandled notifications
    default:
      log.debug({ method }, 'codex: unhandled notification');
  }
}

function handleThreadStarted(params: ThreadStartedParams, sink: SessionSink, state: CodexSessionState): void {
  state.threadId = params.thread.id;
  sink.onInit(params.thread.id);
}

function handleTurnStarted(params: TurnStartedParams, state: CodexSessionState): void {
  state.currentTurnId = params.turn.id;
}

function handleItemCompleted(params: ItemCompletedParams, sink: SessionSink): void {
  const { item } = params;

  switch (item.type) {
    case 'agentMessage':
      sink.onMessage([{ type: 'text', text: item.text }]);
      return;

    case 'reasoning':
      sink.onMessage([{ type: 'thinking', thinking: item.text }]);
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
          content: item.aggregated_output,
          isError: (item.exit_code ?? 0) !== 0,
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
          content: item.result ?? item.error ?? '',
          isError: !!item.error,
        },
      ]);
      return;

    default:
      log.debug({ type: (item as { type: string }).type }, 'codex: unhandled item type');
  }
}

function handleTurnCompleted(params: TurnCompletedParams, sink: SessionSink, state: CodexSessionState): void {
  state.currentTurnId = null;
  const { turn } = params;
  const isError = turn.status === 'failed' || turn.status === 'interrupted';

  sink.onResult({
    total_cost_usd: 0,
    usage: turn.usage
      ? {
          input_tokens: turn.usage.input_tokens,
          output_tokens: turn.usage.output_tokens,
          cache_read_input_tokens: turn.usage.cached_input_tokens,
        }
      : undefined,
    subtype: isError ? 'error_during_execution' : undefined,
    is_error: isError,
  });
}
