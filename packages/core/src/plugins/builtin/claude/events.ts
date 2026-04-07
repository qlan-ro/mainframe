import path from 'node:path';
import type {
  ContextUsage,
  ControlRequest,
  ControlUpdate,
  MessageContent,
  SessionSink,
} from '@qlan-ro/mainframe-types';
import type { ClaudeSession } from './session.js';
import { buildToolResultBlocks } from './history.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude:events');

export function handleStdout(session: ClaudeSession, chunk: Buffer, sink: SessionSink): void {
  session.state.buffer += chunk.toString();
  const lines = session.state.buffer.split('\n');
  session.state.buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    log.trace({ sessionId: session.id, line }, 'adapter stdout');
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

export function handleStderr(session: ClaudeSession, chunk: Buffer, sink: SessionSink): void {
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
  } else if (event.subtype === 'task_notification') {
    session.state.activeTasks.delete(event.task_id as string);
  } else if (event.subtype === 'status') {
    if (event.status === 'compacting') {
      sink.onCompactStart();
    }
  }
}

function handleAssistantEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  const message = event.message as {
    model?: string;
    content: MessageContent[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  if (message?.usage) {
    session.state.lastAssistantUsage = message.usage;
  }
  if (message?.content) {
    for (const block of message.content) {
      if (block.type === 'tool_use' && block.name === 'TodoWrite') {
        const input = block.input as { todos?: unknown[] };
        if (Array.isArray(input?.todos)) {
          const valid = input.todos.filter(
            (t): t is import('@qlan-ro/mainframe-types').TodoItem =>
              typeof t === 'object' &&
              t !== null &&
              typeof (t as Record<string, unknown>).content === 'string' &&
              typeof (t as Record<string, unknown>).status === 'string',
          );
          if (valid.length > 0) sink.onTodoUpdate(valid);
        }
      }
    }

    sink.onMessage(message.content, {
      model: message.model,
      usage: message.usage,
    });
  }
}

function handleUserEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  // Detect queued message processed by CLI (isReplay from SDK mode)
  const isReplay = event.isReplay === true || event.is_replay === true;
  const uuid = (event.uuid as string) || undefined;
  if (isReplay && uuid) {
    sink.onQueuedProcessed(uuid);
  }

  // Live stream handles ONLY tool_result blocks from user events.
  // Text/image blocks in user entries are intentionally ignored here because:
  //   - User-typed text: already created as a ChatMessage by chat-manager.sendMessage()
  //   - Image blocks: not surfaced in live mode (no UX for them)
  // History loading (convertUserEntry) reconstructs these from JSONL since it
  // has no sendMessage() counterpart. See docs/plans/2026-02-17-unified-event-pipeline.md.
  // TODO(task-support): handle <task-notification> string content as TaskGroupCard
  const message = event.message as { content: Array<Record<string, unknown>> } | undefined;
  if (!message?.content) return;

  // Stream-json uses snake_case; JSONL uses camelCase
  const tur = (event.tool_use_result ?? event.toolUseResult) as Record<string, unknown> | undefined;

  // Use shared builder — same logic as convertUserEntry in claude-history.ts
  const toolResultContent: MessageContent[] = buildToolResultBlocks(message as Record<string, unknown>, tur);

  if (toolResultContent.length > 0) {
    sink.onToolResult(toolResultContent);
  }

  for (const block of message.content) {
    if (block.type === 'tool_result') {
      const text = typeof block.content === 'string' ? block.content : '';
      const planMatch = text.match(/Your plan has been saved to: (\/\S+\.md)/);
      if (planMatch?.[1]) {
        sink.onPlanFile(planMatch[1].trim());
      }
    } else if (block.type === 'text') {
      const text = (block.text as string) || '';
      const skillMatch = text.match(/^Base directory for this skill: (.+)/m);
      if (skillMatch?.[1]) {
        const basePath = skillMatch[1].trim();
        const skillPath = path.join(basePath, 'SKILL.md');
        const skillName = basePath.split('/').pop() ?? basePath;
        sink.onSkillFile({ path: skillPath, displayName: skillName });
      }
    }
  }
  const rawContent = (event.message as Record<string, unknown>)?.content;
  if (typeof rawContent === 'string') {
    const skillMatch = rawContent.match(/^Base directory for this skill: (.+)/m);
    if (skillMatch?.[1]) {
      const basePath = skillMatch[1].trim();
      const skillPath = path.join(basePath, 'SKILL.md');
      const skillName = basePath.split('/').pop() ?? basePath;
      sink.onSkillFile({ path: skillPath, displayName: skillName });
    }
  }
}

function handleControlRequestEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
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

function handleControlResponseEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
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

  // Route cancel_async_message responses to pending callbacks
  const requestId = (response.request_id as string) || undefined;
  const innerResponse = response.response as Record<string, unknown> | undefined;
  if (requestId && innerResponse && typeof innerResponse.cancelled === 'boolean') {
    const callback = session.state.pendingCancelCallbacks.get(requestId);
    if (callback) {
      session.state.pendingCancelCallbacks.delete(requestId);
      callback(innerResponse.cancelled);
    }
  }
}

function handleResultEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
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
      return handleResultEvent(session, event, sink);
  }
}
