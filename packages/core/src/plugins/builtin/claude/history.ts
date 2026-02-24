import { createReadStream } from 'node:fs';
import { access, constants, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent, DiffHunk, SkillFileEntry } from '@mainframe/types';

export function deriveModifiedFile(
  tur: Record<string, unknown> | undefined,
  originalFile: string | undefined,
): string | undefined {
  if (!tur) return undefined;
  if (typeof tur.content === 'string' && (tur.type === 'create' || tur.type === 'update')) {
    return tur.content;
  }
  if (originalFile && typeof tur.oldString === 'string') {
    const oldStr = tur.oldString;
    const newStr = (tur.newString as string) ?? '';
    return tur.replaceAll ? originalFile.split(oldStr).join(newStr) : originalFile.replace(oldStr, newStr);
  }
  return undefined;
}

function extractSkillPathFromText(content: Array<Record<string, unknown>>): string | null {
  for (const block of content) {
    if (block.type !== 'text') continue;
    const text = block.text as string;
    const match = text.match(/^Base directory for this skill: (.+)/);
    if (match?.[1]) {
      return path.join(match[1].trim(), 'SKILL.md');
    }
  }
  return null;
}

export function buildToolResultBlocks(
  message: Record<string, unknown>,
  tur: Record<string, unknown> | undefined,
): MessageContent[] {
  const rawContent = message.content;
  if (!Array.isArray(rawContent)) return [];

  const sp = tur?.structuredPatch as DiffHunk[] | undefined;
  const originalFile = tur?.originalFile as string | undefined;
  const modifiedFile = deriveModifiedFile(tur, originalFile);

  const blocks: MessageContent[] = [];
  for (const block of rawContent) {
    if (block.type !== 'tool_result') continue;
    blocks.push({
      type: 'tool_result',
      toolUseId: (block.tool_use_id as string) || '',
      content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
      isError: !!block.is_error,
      ...(sp?.length ? { structuredPatch: sp } : {}),
      ...(originalFile != null ? { originalFile } : {}),
      ...(modifiedFile != null ? { modifiedFile } : {}),
    });
  }
  return blocks;
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
    for (const block of rawContent) {
      if (block.type === 'text') {
        const text = block.text || '';
        if (!text.startsWith('[Request interrupted')) {
          contentBlocks.push({ type: 'text', text });
        }
      } else if (block.type === 'image') {
        const source = block.source as Record<string, unknown> | undefined;
        if (source?.type === 'base64') {
          contentBlocks.push({ type: 'image', mediaType: source.media_type as string, data: source.data as string });
        }
      }
    }
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
        contentBlocks.push({ type: 'thinking', thinking: block.thinking || '' });
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

export function convertHistoryEntry(entry: Record<string, unknown>, chatId: string): ChatMessage | null {
  const type = entry.type as string;

  if (type === 'system' && entry.subtype === 'compact_boundary') {
    return {
      id: (entry.uuid as string) || nanoid(),
      chatId,
      type: 'system',
      content: [{ type: 'text', text: 'Context compacted' }],
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

export function filterSkillExpansions(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((msg) => {
    if (msg.type !== 'user') return true;
    // Filter slash-command invocation markers — they contain <command-name> tags and
    // are purely CLI metadata that should never appear in the rendered conversation.
    return !msg.content.some((b) => b.type === 'text' && /<command-name>/.test((b as { text: string }).text));
  });
}

function getSessionJsonlPath(sessionId: string, projectPath: string): { jsonlPath: string; projectDir: string } {
  const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(homedir(), '.claude', 'projects', encodedPath);
  return { jsonlPath: path.join(projectDir, sessionId + '.jsonl'), projectDir };
}

export async function loadHistory(sessionId: string, projectPath: string): Promise<ChatMessage[]> {
  const { jsonlPath, projectDir } = getSessionJsonlPath(sessionId, projectPath);

  try {
    await access(jsonlPath, constants.R_OK);
  } catch {
    return [];
  }

  const jsonlFiles = [jsonlPath];
  try {
    const entries = await readdir(projectDir);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl') || entry === sessionId + '.jsonl') continue;
      const filePath = path.join(projectDir, entry);
      try {
        const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          const first = JSON.parse(line);
          if (first.sessionId === sessionId) jsonlFiles.push(filePath);
          break;
        }
        rl.close();
      } catch {
        /* skip unreadable files */
      }
    }
  } catch {
    /* directory read failed, proceed with primary only */
  }

  const messages: ChatMessage[] = [];
  for (const file of jsonlFiles) {
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.isMeta === true) continue; // Skip metadata-only entries (skill content injections)
        if (entry.isCompactSummary === true || entry.isVisibleInTranscriptOnly === true) continue; // Skip context compaction summaries
        const msg = convertHistoryEntry(entry, sessionId);
        if (msg) messages.push(msg);
      } catch {
        // Skip malformed lines
      }
    }
  }

  return filterSkillExpansions(messages);
}

export async function extractPlanFilePaths(sessionId: string, projectPath: string): Promise<string[]> {
  const { jsonlPath } = getSessionJsonlPath(sessionId, projectPath);

  try {
    await access(jsonlPath, constants.R_OK);
  } catch {
    return [];
  }

  const planFiles: string[] = [];
  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'user') continue;
      const tur = entry.toolUseResult as Record<string, unknown> | undefined;
      if (typeof tur?.plan === 'string' && typeof tur?.filePath === 'string') {
        planFiles.push(tur.filePath as string);
      }
    } catch {
      /* skip malformed */
    }
  }

  return planFiles;
}

export async function extractSkillFilePaths(sessionId: string, projectPath: string): Promise<SkillFileEntry[]> {
  const { jsonlPath } = getSessionJsonlPath(sessionId, projectPath);

  try {
    await access(jsonlPath, constants.R_OK);
  } catch {
    return [];
  }

  const skillFiles: SkillFileEntry[] = [];
  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'user' || entry.isMeta !== true) continue;
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      const skillPath = extractSkillPathFromText(content);
      if (skillPath) {
        const segments = skillPath.split('/');
        const file = segments.pop() ?? skillPath;
        const displayName = file === 'SKILL.md' && segments.length > 0 ? segments.pop()! : file;
        skillFiles.push({ path: skillPath, displayName });
      }
    } catch {
      /* skip malformed */
    }
  }

  return skillFiles;
}
