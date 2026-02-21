import path from 'node:path';
import type { PermissionRequest, PermissionUpdate, MessageContent, DiffHunk } from '@mainframe/types';
import type { ClaudeProcess, ClaudeEventEmitter } from './claude-types.js';
import { deriveModifiedFile } from './claude-history.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('claude-events');

export function handleStdout(
  processId: string,
  chunk: Buffer,
  processes: Map<string, ClaudeProcess>,
  emitter: ClaudeEventEmitter,
): void {
  const cp = processes.get(processId);
  if (!cp) return;

  cp.buffer += chunk.toString();
  const lines = cp.buffer.split('\n');
  cp.buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    log.trace({ processId, line }, 'adapter stdout');
    try {
      const event = JSON.parse(line.trim());
      handleEvent(processId, event, processes, emitter);
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

export function handleStderr(processId: string, chunk: Buffer, emitter: ClaudeEventEmitter): void {
  const message = chunk.toString().trim();
  if (!message) return;
  if (INFORMATIONAL_PATTERNS.some((p) => p.test(message))) return;
  emitter.emit('error', processId, new Error(message));
}

function handleSystemEvent(
  processId: string,
  event: Record<string, unknown>,
  cp: ClaudeProcess,
  emitter: ClaudeEventEmitter,
): void {
  if (event.subtype === 'init') {
    cp.chatId = event.session_id as string;
    cp.status = 'ready';
    emitter.emit('init', processId, event.session_id as string, event.model as string, event.tools as string[]);
  } else if (event.subtype === 'compact_boundary') {
    emitter.emit('compact', processId);
  }
}

function handleAssistantEvent(
  processId: string,
  event: Record<string, unknown>,
  cp: ClaudeProcess,
  emitter: ClaudeEventEmitter,
): void {
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
    cp.lastAssistantUsage = message.usage;
  }
  if (message?.content) {
    emitter.emit('message', processId, message.content, {
      model: message.model,
      usage: message.usage,
    });
  }
}

function handleUserEvent(processId: string, event: Record<string, unknown>, emitter: ClaudeEventEmitter): void {
  const message = event.message as { content: Array<Record<string, unknown>> } | undefined;
  if (!message?.content) return;

  const tur = event.toolUseResult as Record<string, unknown> | undefined;
  const sp = tur?.structuredPatch as DiffHunk[] | undefined;
  const originalFile = tur?.originalFile as string | undefined;
  const modifiedFile = deriveModifiedFile(tur, originalFile);

  const toolResultContent: MessageContent[] = [];
  for (const block of message.content) {
    if (block.type === 'tool_result') {
      toolResultContent.push({
        type: 'tool_result',
        toolUseId: (block.tool_use_id as string) || '',
        content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
        isError: !!block.is_error,
        ...(sp?.length ? { structuredPatch: sp } : {}),
        ...(originalFile != null ? { originalFile } : {}),
        ...(modifiedFile != null ? { modifiedFile } : {}),
      });
    }
  }

  if (toolResultContent.length > 0) {
    emitter.emit('tool_result', processId, toolResultContent);
  }

  for (const block of message.content) {
    if (block.type === 'tool_result') {
      const text = typeof block.content === 'string' ? block.content : '';
      const planMatch = text.match(/Your plan has been saved to: (\/\S+\.md)/);
      if (planMatch?.[1]) {
        emitter.emit('plan_file', processId, planMatch[1].trim());
      }
    } else if (block.type === 'text') {
      const text = (block.text as string) || '';
      const skillMatch = text.match(/^Base directory for this skill: (.+)/m);
      if (skillMatch?.[1]) {
        emitter.emit('skill_file', processId, path.join(skillMatch[1].trim(), 'SKILL.md'));
      }
    }
  }
  const rawContent = (event.message as Record<string, unknown>)?.content;
  if (typeof rawContent === 'string') {
    const skillMatch = rawContent.match(/^Base directory for this skill: (.+)/m);
    if (skillMatch?.[1]) {
      emitter.emit('skill_file', processId, path.join(skillMatch[1].trim(), 'SKILL.md'));
    }
  }
}

function handleControlRequestEvent(
  processId: string,
  event: Record<string, unknown>,
  emitter: ClaudeEventEmitter,
): void {
  const request = event.request as Record<string, unknown>;
  if (request?.subtype === 'can_use_tool') {
    const permRequest: PermissionRequest = {
      requestId: event.request_id as string,
      toolName: request.tool_name as string,
      toolUseId: request.tool_use_id as string,
      input: request.input as Record<string, unknown>,
      suggestions: (request.permission_suggestions as PermissionUpdate[]) || [],
      decisionReason: request.decision_reason as string | undefined,
    };
    emitter.emit('permission', processId, permRequest);
  } else {
    log.warn({ subtype: request?.subtype }, 'Unhandled control_request subtype');
  }
}

function handleResultEvent(
  processId: string,
  event: Record<string, unknown>,
  cp: ClaudeProcess,
  emitter: ClaudeEventEmitter,
): void {
  const lastUsage = cp.lastAssistantUsage;
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
  cp.lastAssistantUsage = undefined;

  emitter.emit('result', processId, {
    cost: (event.total_cost_usd as number) || 0,
    tokensInput,
    tokensOutput,
    subtype: event.subtype as string | undefined,
    isError: event.is_error as boolean | undefined,
    durationMs: event.duration_ms as number | undefined,
  });
}

function handleEvent(
  processId: string,
  event: Record<string, unknown>,
  processes: Map<string, ClaudeProcess>,
  emitter: ClaudeEventEmitter,
): void {
  const cp = processes.get(processId);
  if (!cp) return;

  log.debug({ processId, type: event.type }, 'adapter event');

  switch (event.type) {
    case 'system':
      return handleSystemEvent(processId, event, cp, emitter);
    case 'assistant':
      return handleAssistantEvent(processId, event, cp, emitter);
    case 'user':
      return handleUserEvent(processId, event, emitter);
    case 'control_request':
      return handleControlRequestEvent(processId, event, emitter);
    case 'result':
      return handleResultEvent(processId, event, cp, emitter);
  }
}
