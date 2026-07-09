import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent } from '@qlan-ro/mainframe-types';
import { buildToolResultBlocks } from './history-tool-result.js';

/**
 * isMeta user entries whose first text block starts with
 * "Base directory for this skill: <dir>" are the CLI's skill-content
 * injections. We keep them out of the chat transcript (as before) but
 * synthesize a transient system message with a `skill_loaded` block so
 * SkillLoadedCard renders on history replay.
 */
/**
 * "Unknown command: /X" user entries are CLI feedback — the CLI never writes
 * the original user-typed /X to JSONL, so on replay the typed bubble is lost.
 * Synthesize both components: the invocation bubble and the error pill, so
 * history mirrors what the user saw live.
 */
export function synthesizeUnknownCommandFromUserEntry(
  entry: Record<string, unknown>,
  chatId: string,
): ChatMessage[] | null {
  const message = entry.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content !== 'string') return null;
  // Match both CLI error variants. "Unknown command:" comes from the
  // MalformedCommandError path (processSlashCommand.tsx:820) and retains the
  // leading slash. "Unknown skill:" comes from the !hasCommand path
  // (processSlashCommand.tsx:347) and omits the slash — we add it back so the
  // synthesized user bubble consistently reads like "/foo".
  const match = /^Unknown (?:command|skill):\s+\/?(\S+)/.exec(content.trim());
  if (!match?.[1]) return null;
  const cmd = `/${match[1]}`;
  const uuid = (entry.uuid as string) ?? nanoid();
  const timestamp = (entry.timestamp as string) ?? new Date().toISOString();
  return [
    {
      id: `unknown-cmd-user-${uuid}`,
      chatId,
      type: 'user',
      content: [{ type: 'text', text: cmd }],
      timestamp,
    },
    {
      id: `unknown-cmd-err-${uuid}`,
      chatId,
      type: 'system',
      content: [{ type: 'text', text: content.trim() }],
      timestamp,
    },
  ];
}

export function synthesizeSkillLoadedFromUserEntry(entry: Record<string, unknown>, chatId: string): ChatMessage | null {
  const message = entry.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0] as { type?: string; text?: string } | undefined;
  if (first?.type !== 'text' || typeof first.text !== 'string') return null;
  const match = /^Base directory for this skill:\s*(.+?)(?:\n|$)/m.exec(first.text);
  if (!match?.[1]) return null;
  const baseDir = match[1].trim();
  const skillName = path.basename(baseDir);
  const skillPath = path.extname(baseDir) ? baseDir : path.join(baseDir, 'SKILL.md');
  const skillContent = first.text.replace(/^Base directory for this skill:[^\n]*\n?/m, '').trim();
  const uuid = (entry.uuid as string) ?? nanoid();
  return {
    id: `skill-loaded-${uuid}`,
    chatId,
    type: 'system',
    content: [{ type: 'skill_loaded', skillName, path: skillPath, content: skillContent }],
    timestamp: (entry.timestamp as string) ?? new Date().toISOString(),
  };
}

/**
 * Extract text/image content blocks from a raw user-role block array (JSONL
 * `message.content` or a queued-command `prompt`). The two call sites differ
 * on empty text: history replay keeps empty text blocks and drops CLI
 * interrupt markers (`skipInterrupted`), while queued-command prompts drop
 * empty/whitespace-only text and never carry an interrupt marker.
 */
export function extractUserContentBlocks(
  blocks: Array<Record<string, unknown>>,
  opts: { skipInterrupted?: boolean } = {},
): MessageContent[] {
  const result: MessageContent[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = block.text as string | undefined;
      if (opts.skipInterrupted) {
        const t = text || '';
        if (!t.startsWith('[Request interrupted')) result.push({ type: 'text', text: t });
      } else if (typeof text === 'string' && text.trim()) {
        result.push({ type: 'text', text });
      }
    } else if (block.type === 'image') {
      const source = block.source as Record<string, unknown> | undefined;
      if (source?.type === 'base64') {
        result.push({ type: 'image', mediaType: source.media_type as string, data: source.data as string });
      }
    }
  }
  return result;
}

function convertUserEntry(
  entry: Record<string, unknown>,
  message: Record<string, unknown>,
  chatId: string,
): ChatMessage | null {
  const rawContent = message.content;
  const contentBlocks: MessageContent[] = [];
  const toolUseResult = entry.toolUseResult as Record<string, unknown> | undefined;

  if (typeof rawContent === 'string') {
    // String rawContent: user-typed text stored by Claude CLI when message.content
    // is not an array. History must render it; live stream doesn't re-emit it
    // (sendMessage() already created that ChatMessage).
    // Known internal strings are filtered below — add new patterns here if they
    // appear in JSONL but should never render in UI.
    // TODO(task-support): render <task-notification> content once task UI is ready
    if (rawContent.startsWith('<task-notification>')) return null;
    contentBlocks.push({ type: 'text', text: rawContent });
  } else if (Array.isArray(rawContent)) {
    // Tool results — use shared builder (same logic as live stream)
    const toolResults = buildToolResultBlocks(message, toolUseResult);
    contentBlocks.push(...toolResults);

    // Text and image blocks are intentionally only in history:
    // live stream doesn't re-emit them because sendMessage() already created
    // the user ChatMessage and tool results come via a separate tool_result entry.
    contentBlocks.push(
      ...extractUserContentBlocks(rawContent as Array<Record<string, unknown>>, { skipInterrupted: true }),
    );
  }

  if (contentBlocks.length === 0) return null;

  const hasToolResult = contentBlocks.some((b) => b.type === 'tool_result');
  return {
    id: (entry.uuid as string) || nanoid(),
    chatId,
    type: hasToolResult ? 'tool_result' : 'user',
    content: contentBlocks,
    timestamp: (entry.timestamp as string) || new Date().toISOString(),
    metadata: { source: 'history' },
  };
}

function convertAssistantEntry(
  entry: Record<string, unknown>,
  message: Record<string, unknown>,
  chatId: string,
): ChatMessage | null {
  const rawContent = message.content;
  const contentBlocks: MessageContent[] = [];

  if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
      if (block.type === 'text') {
        contentBlocks.push({ type: 'text', text: block.text || '' });
      } else if (block.type === 'thinking') {
        // Hidden-thinking models emit signature-only blocks with empty prose — skip them.
        const thinking = (block.thinking as string) || '';
        if (thinking.trim()) contentBlocks.push({ type: 'thinking', thinking });
      } else if (block.type === 'tool_use') {
        contentBlocks.push({
          type: 'tool_use',
          id: block.id || '',
          name: block.name || '',
          input: (block.input as Record<string, unknown>) || {},
        });
      }
    }
  }

  if (contentBlocks.length === 0) return null;

  const meta: Record<string, unknown> = { source: 'history' };
  if (message.model) meta.model = message.model;
  const usage = message.usage as
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      }
    | undefined;
  if (usage) meta.usage = usage;

  return {
    id: (entry.uuid as string) || nanoid(),
    chatId,
    type: 'assistant',
    content: contentBlocks,
    timestamp: (entry.timestamp as string) || new Date().toISOString(),
    metadata: meta,
  };
}

/**
 * A queued message the CLI drained mid-turn persists to JSONL as a structured
 * `attachment` entry (type queued_command), NOT as a user entry — verified
 * against CLI 2.1.198 on the stream-json + --replay-user-messages path
 * (docs/adapters/claude/QUEUE.md, local capture 2026-07-04). Converting it
 * here is what keeps mid-turn-drained messages visible after reload, at their
 * consumption point.
 */
function convertQueuedCommandEntry(entry: Record<string, unknown>, chatId: string): ChatMessage | null {
  const attachment = entry.attachment as Record<string, unknown> | undefined;
  if (attachment?.type !== 'queued_command' || attachment.commandMode !== 'prompt') return null;

  const prompt = attachment.prompt;
  const contentBlocks: MessageContent[] = [];
  if (typeof prompt === 'string') {
    if (prompt.trim()) contentBlocks.push({ type: 'text', text: prompt });
  } else if (Array.isArray(prompt)) {
    contentBlocks.push(...extractUserContentBlocks(prompt as Array<Record<string, unknown>>));
  }
  if (contentBlocks.length === 0) return null;

  return {
    id: (entry.uuid as string) || nanoid(),
    chatId,
    type: 'user',
    content: contentBlocks,
    timestamp: (entry.timestamp as string) || (attachment.timestamp as string) || new Date().toISOString(),
    metadata: { source: 'history' },
  };
}

export function convertHistoryEntry(entry: Record<string, unknown>, chatId: string): ChatMessage | null {
  const type = entry.type as string;

  if (type === 'attachment') return convertQueuedCommandEntry(entry, chatId);

  if (type === 'system' && entry.subtype === 'compact_boundary') {
    return {
      id: (entry.uuid as string) || nanoid(),
      chatId,
      type: 'system',
      content: [{ type: 'compaction' }],
      timestamp: (entry.timestamp as string) || new Date().toISOString(),
      metadata: { source: 'history', internal: true },
    };
  }

  if (type === 'result' && entry.subtype === 'error_during_execution' && entry.is_error !== false) {
    return {
      id: (entry.uuid as string) || nanoid(),
      chatId,
      type: 'error',
      content: [{ type: 'error', message: 'Session ended unexpectedly' }],
      timestamp: (entry.timestamp as string) || new Date().toISOString(),
      metadata: { source: 'history' },
    };
  }

  if (type !== 'user' && type !== 'assistant') return null;

  const message = entry.message as Record<string, unknown> | undefined;
  if (!message) return null;

  if (type === 'user') return convertUserEntry(entry, message, chatId);
  if (type === 'assistant') return convertAssistantEntry(entry, message, chatId);
  return null;
}
