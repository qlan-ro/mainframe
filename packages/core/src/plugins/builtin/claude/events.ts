import type { ContextUsage, ControlRequest, ControlUpdate, SessionSink } from '@qlan-ro/mainframe-types';
import type { ClaudeSession } from './session.js';
import { handleAssistantEvent } from './assistant-event.js';
import { handleUserEvent } from './user-event.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude:events');

export function handleStdout(session: ClaudeSession, chunk: Buffer, sink: SessionSink): void {
  session.state.buffer += chunk.toString();
  const lines = session.state.buffer.split('\n');
  session.state.buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    session.state.lastActivityAt = Date.now();
    log.trace({ sessionId: session.id, line }, '[stream-json]');
    try {
      const event = JSON.parse(line.trim());
      handleEvent(session, event, sink);
    } catch {
      // Not JSON, skip
    }
  }
}

const INFORMATIONAL_PATTERNS = [
  /^Debugger/i,
  /^Warning:/i,
  /^DeprecationWarning/i,
  /^ExperimentalWarning/i,
  /^\(node:\d+\)/,
  /^Cloning into/,
];

export function handleStderr(_session: ClaudeSession, chunk: Buffer, sink: SessionSink): void {
  const message = chunk.toString().trim();
  if (!message) return;
  if (INFORMATIONAL_PATTERNS.some((p) => p.test(message))) return;
  sink.onError(new Error(message));
}

function handleSystemEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  if (event.subtype === 'init') {
    session.state.chatId = event.session_id as string;
    session.state.status = 'ready';
    sink.onInit(event.session_id as string);
  } else if (event.subtype === 'compact_boundary') {
    sink.onCompact();
  } else if (event.subtype === 'task_started') {
    session.state.activeTasks.set(event.task_id as string, {
      type: event.task_type as string,
      command: event.command as string | undefined,
    });
    if (session.state.mainframeChatId) {
      session.state.taskEvents.handleTaskStarted(
        session.state.mainframeChatId,
        {
          task_id: event.task_id as string,
          tool_use_id: event.tool_use_id as string | undefined,
          description: event.description as string | undefined,
        },
        { claudeSessionId: session.state.chatId, realCwd: session.state.realProjectPath },
      );
    }
  } else if (event.subtype === 'task_notification') {
    session.state.activeTasks.delete(event.task_id as string);
    if (session.state.mainframeChatId) {
      const usage = event.usage as { total_tokens: number; tool_uses: number; duration_ms: number } | undefined;
      session.state.taskEvents.handleTaskNotification(session.state.mainframeChatId, {
        task_id: event.task_id as string,
        status: event.status as string,
        output_file: event.output_file as string | undefined,
        summary: event.summary as string | undefined,
        usage,
      });
    }
  } else if (event.subtype === 'status') {
    if (event.status === 'compacting') {
      sink.onCompactStart();
    }
  }
}

function handleControlRequestEvent(_session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  const request = event.request as Record<string, unknown>;
  if (request?.subtype === 'can_use_tool') {
    const permRequest: ControlRequest = {
      requestId: event.request_id as string,
      toolName: request.tool_name as string,
      toolUseId: request.tool_use_id as string,
      input: request.input as Record<string, unknown>,
      suggestions: (request.permission_suggestions as ControlUpdate[]) || [],
      decisionReason: request.decision_reason as string | undefined,
    };
    sink.onPermission(permRequest);
  } else {
    log.warn({ subtype: request?.subtype }, 'Unhandled control_request subtype');
  }
}

export function handleControlResponseEvent(
  session: ClaudeSession,
  event: Record<string, unknown>,
  sink: SessionSink,
): void {
  const response = event.response as Record<string, unknown> | undefined;
  if (!response) return;

  const innerData = response.response as Record<string, unknown> | undefined;
  if (innerData && typeof innerData.totalTokens === 'number' && typeof innerData.percentage === 'number') {
    const usage: ContextUsage = {
      totalTokens: innerData.totalTokens,
      maxTokens: (innerData.maxTokens as number) || 0,
      percentage: innerData.percentage,
    };
    sink.onContextUsage(usage);
  }

  // Route every other control_response (set_model, apply_flag_settings, cancel_async_message,
  // stop_task, ...) through the session's single correlation channel by request_id. `response`
  // is the OUTER envelope ({subtype, request_id, response?}) — resolve() hands it to whichever
  // awaiting caller's isTerminal predicate accepts it. Unmatched ids (e.g. this same context-usage
  // response, which has no pending awaiter) return false harmlessly.
  const requestId = (response.request_id as string) || undefined;
  if (requestId) session.control.resolve(requestId, response);
}

function handleResultEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  // Surface CLI slash-command errors that reach us only via the `result`
  // event. When `shouldQuery: false` (unknown /cmd, bad /cmd args), the CLI
  // filters the "Unknown skill: /X" user message out of stream-json
  // (QueryEngine.ts:556-605 only yields <local-command-stdout|stderr> entries)
  // but the error text survives on `result.result`. We forward it as a
  // system pill so the user sees why their input had no effect.
  const resultText = typeof event.result === 'string' ? event.result.trim() : '';
  if (resultText && /^Unknown (command|skill):/i.test(resultText)) {
    sink.onCliMessage(resultText);
  }

  const lastUsage = session.state.lastAssistantUsage;
  const usage =
    lastUsage ??
    (event.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        }
      | undefined);
  const tokensInput =
    (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
  const tokensOutput = usage?.output_tokens || 0;
  session.state.lastAssistantUsage = undefined;
  session.clearInterruptTimer();

  log.debug(
    { sessionId: session.id, sessionChatId: session.state.chatId, subtype: event.subtype },
    'handling result event for parent session',
  );

  sink.onResult({
    total_cost_usd: (event.total_cost_usd as number) || 0,
    usage: usage
      ? {
          input_tokens: tokensInput,
          output_tokens: tokensOutput,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
        }
      : undefined,
    subtype: event.subtype as string | undefined,
    is_error: event.is_error as boolean | undefined,
  });

  // Request context usage after each result so the UI can show an up-to-date
  // context percentage without requiring a separate user action.
  session.requestContextUsage();
}

function handleEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  log.debug(
    { sessionId: session.id, type: event.type, subtype: event.subtype },
    'claude event: %s%s',
    event.type,
    event.subtype ? `.${event.subtype}` : '',
  );

  switch (event.type) {
    case 'system':
      return handleSystemEvent(session, event, sink);
    case 'assistant':
      return handleAssistantEvent(session, event, sink);
    case 'user':
      return handleUserEvent(session, event, sink);
    case 'control_request':
      return handleControlRequestEvent(session, event, sink);
    case 'control_response':
      return handleControlResponseEvent(session, event, sink);
    case 'result':
      // Subagent result events carry `parent_tool_use_id` and represent an
      // inner Task/Agent sub-turn completing, NOT the top-level chat turn.
      // Forwarding them to onResult() would flip processState to 'idle' while
      // the parent session is still running. Drop them here; their completion
      // is already surfaced via the tool_result block in the parent's user event.
      if (typeof event.parent_tool_use_id === 'string' && event.parent_tool_use_id) {
        log.debug(
          { sessionId: session.id, parentToolUseId: event.parent_tool_use_id },
          'claude: skipping subagent result event (parent_tool_use_id present)',
        );
        return;
      }
      return handleResultEvent(session, event, sink);
  }
}
