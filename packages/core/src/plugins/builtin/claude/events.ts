import path from 'node:path';
import type { ControlRequest, ControlUpdate, MessageContent } from '@mainframe/types';
import type { ClaudeSession } from './session.js';
import { buildToolResultBlocks } from './history.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude-events');

export function handleStdout(session: ClaudeSession, chunk: Buffer): void {
  session.state.buffer += chunk.toString();
  const lines = session.state.buffer.split('\n');
  session.state.buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    log.trace({ sessionId: session.id, line }, 'adapter stdout');
    try {
      const event = JSON.parse(line.trim());
      handleEvent(session, event);
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

export function handleStderr(session: ClaudeSession, chunk: Buffer): void {
  const message = chunk.toString().trim();
  if (!message) return;
  if (INFORMATIONAL_PATTERNS.some((p) => p.test(message))) return;
  session.emit('error', new Error(message));
}

function handleSystemEvent(session: ClaudeSession, event: Record<string, unknown>): void {
  if (event.subtype === 'init') {
    session.state.chatId = event.session_id as string;
    session.state.status = 'ready';
    session.emit('init', event.session_id as string, event.model as string, event.tools as string[]);
  } else if (event.subtype === 'compact_boundary') {
    session.emit('compact');
  }
}

function handleAssistantEvent(session: ClaudeSession, event: Record<string, unknown>): void {
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
    session.emit('message', message.content, {
      model: message.model,
      usage: message.usage,
    });
  }
}

function handleUserEvent(session: ClaudeSession, event: Record<string, unknown>): void {
  // Live stream handles ONLY tool_result blocks from user events.
  // Text/image blocks in user entries are intentionally ignored here because:
  //   - User-typed text: already created as a ChatMessage by chat-manager.sendMessage()
  //   - Image blocks: not surfaced in live mode (no UX for them)
  // History loading (convertUserEntry) reconstructs these from JSONL since it
  // has no sendMessage() counterpart. See docs/plans/2026-02-17-unified-event-pipeline.md.
  // TODO(task-support): handle <task-notification> string content as TaskGroupCard
  const message = event.message as { content: Array<Record<string, unknown>> } | undefined;
  if (!message?.content) return;

  const tur = event.toolUseResult as Record<string, unknown> | undefined;

  // Use shared builder — same logic as convertUserEntry in claude-history.ts
  const toolResultContent: MessageContent[] = buildToolResultBlocks(message as Record<string, unknown>, tur);

  if (toolResultContent.length > 0) {
    session.emit('tool_result', toolResultContent);
  }

  for (const block of message.content) {
    if (block.type === 'tool_result') {
      const text = typeof block.content === 'string' ? block.content : '';
      const planMatch = text.match(/Your plan has been saved to: (\/\S+\.md)/);
      if (planMatch?.[1]) {
        session.emit('plan_file', planMatch[1].trim());
      }
    } else if (block.type === 'text') {
      const text = (block.text as string) || '';
      const skillMatch = text.match(/^Base directory for this skill: (.+)/m);
      if (skillMatch?.[1]) {
        session.emit('skill_file', path.join(skillMatch[1].trim(), 'SKILL.md'));
      }
    }
  }
  const rawContent = (event.message as Record<string, unknown>)?.content;
  if (typeof rawContent === 'string') {
    const skillMatch = rawContent.match(/^Base directory for this skill: (.+)/m);
    if (skillMatch?.[1]) {
      session.emit('skill_file', path.join(skillMatch[1].trim(), 'SKILL.md'));
    }
  }
}

function handleControlRequestEvent(session: ClaudeSession, event: Record<string, unknown>): void {
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
    session.emit('permission', permRequest);
  } else {
    log.warn({ subtype: request?.subtype }, 'Unhandled control_request subtype');
  }
}

function handleResultEvent(session: ClaudeSession, event: Record<string, unknown>): void {
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

  session.emit('result', {
    cost: (event.total_cost_usd as number) || 0,
    tokensInput,
    tokensOutput,
    subtype: event.subtype as string | undefined,
    isError: event.is_error as boolean | undefined,
    durationMs: event.duration_ms as number | undefined,
  });
}

function handleEvent(session: ClaudeSession, event: Record<string, unknown>): void {
  log.debug({ sessionId: session.id, type: event.type }, 'adapter event');

  switch (event.type) {
    case 'system':
      return handleSystemEvent(session, event);
    case 'assistant':
      return handleAssistantEvent(session, event);
    case 'user':
      return handleUserEvent(session, event);
    case 'control_request':
      return handleControlRequestEvent(session, event);
    case 'result':
      return handleResultEvent(session, event);
  }
}
