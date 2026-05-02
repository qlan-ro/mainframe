// packages/core/src/plugins/builtin/codex/event-mapper.ts
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import type {
  ItemCompletedParams,
  TurnCompletedParams,
  TurnStartedParams,
  ThreadStartedParams,
  TokenUsageUpdatedParams,
  PatchChangeKind,
} from './types.js';
import { parseUnifiedDiff } from '../../../messages/parse-unified-diff.js';
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
          name: 'Bash',
          input: { command: item.command },
        },
      ]);
      sink.onToolResult([
        {
          type: 'tool_result',
          toolUseId: item.id,
          content: item.aggregatedOutput ?? '',
          isError: item.exitCode !== undefined && item.exitCode !== 0,
        },
      ]);
      return;

    case 'fileChange': {
      const isCompleted = item.status !== 'inProgress';
      const isError = item.status === 'failed' || item.status === 'declined';
      item.changes.forEach((change, index) => {
        const toolId = `${item.id}:${index}`;
        const isAdd = change.kind.type === 'add';
        const toolName = isAdd ? 'Write' : 'Edit';
        const input: Record<string, unknown> = isAdd
          ? { file_path: change.path, content: extractAddedContent(change.diff) }
          : {
              file_path: change.path,
              old_string: '',
              new_string: '',
              ...((change.kind as Extract<PatchChangeKind, { type: 'update' }>).move_path != null
                ? { move_path: (change.kind as Extract<PatchChangeKind, { type: 'update' }>).move_path }
                : {}),
            };
        sink.onMessage([{ type: 'tool_use', id: toolId, name: toolName, input }]);
        if (isCompleted) {
          const structuredPatch = parseUnifiedDiff(change.diff);
          sink.onToolResult([
            {
              type: 'tool_result',
              toolUseId: toolId,
              content: 'OK',
              isError,
              ...(structuredPatch.length ? { structuredPatch } : {}),
            },
          ]);
        }
      });
      return;
    }

    case 'imageGeneration': {
      // Codex emits the generated image inline as base64 in `result`. Prefer that;
      // fall back to reading `savedPath` from disk if the inline payload is missing.
      const prompt = item.revisedPrompt;
      const inline = item.result;
      const emit = (data: string, mediaType: string) => {
        const content: Parameters<SessionSink['onMessage']>[0] = [{ type: 'image', mediaType, data }];
        if (prompt) content.unshift({ type: 'text', text: prompt });
        sink.onMessage(content);
      };

      if (inline) {
        emit(inline, mediaTypeFromExtension(item.savedPath ?? '.png'));
        return;
      }

      const path = item.savedPath;
      if (!path) {
        log.warn({ id: item.id }, 'codex: imageGeneration missing both result and savedPath');
        return;
      }
      readFile(path)
        .then((bytes) => emit(bytes.toString('base64'), mediaTypeFromExtension(path)))
        .catch((err) => {
          log.warn({ err: String(err), path }, 'codex: failed to read generated image');
        });
      return;
    }

    case 'mcpToolCall': {
      const server = item.server ?? 'codex';
      const toolName = `mcp__${server}__${item.tool}`;
      sink.onMessage([
        {
          type: 'tool_use',
          id: item.id,
          name: toolName,
          input: item.arguments,
        },
      ]);
      sink.onToolResult([
        {
          type: 'tool_result',
          toolUseId: item.id,
          content: item.error ? (item.error.message ?? '') : JSON.stringify(item.result?.content ?? ''),
          isError: !!item.error,
        },
      ]);
      return;
    }

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

function mediaTypeFromExtension(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/** Extract added lines from a unified diff for Write tool input.content. */
function extractAddedContent(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}
