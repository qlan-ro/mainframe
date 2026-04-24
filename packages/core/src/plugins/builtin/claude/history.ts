import { createReadStream } from 'node:fs';
import { access, constants, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent, DiffHunk, SkillFileEntry } from '@qlan-ro/mainframe-types';

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

import { resolveSkillPath } from './skill-path.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude:history');

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
function synthesizeUnknownCommandFromUserEntry(entry: Record<string, unknown>, chatId: string): ChatMessage[] | null {
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

function synthesizeSkillLoadedFromUserEntry(entry: Record<string, unknown>, chatId: string): ChatMessage | null {
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

function extractToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string') {
        texts.push(block.text);
      }
    }
    if (texts.length > 0) return texts.join('\n');
  }
  return JSON.stringify(content ?? '');
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
      content: extractToolResultContent(block.content),
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

function collectAgentProgressTools(entry: Record<string, unknown>, agentTools: Map<string, MessageContent[]>): void {
  const parentId = entry.parentToolUseID as string | undefined;
  if (!parentId) return;
  const data = entry.data as Record<string, unknown>;
  const msg = data.message as Record<string, unknown> | undefined;
  const inner = msg?.message as Record<string, unknown> | undefined;
  if (!inner || inner.role !== 'assistant') return;
  const content = inner.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    const existing = agentTools.get(parentId) ?? [];
    existing.push({
      type: 'tool_use',
      id: (block.id as string) || nanoid(),
      name: block.name as string,
      input: (block.input as Record<string, unknown>) ?? {},
    });
    agentTools.set(parentId, existing);
  }
}

/** Extract tool_result blocks from subagent JSONL user entries. */
function collectSubagentToolResults(
  entry: Record<string, unknown>,
  results: Map<string, MessageContent & { type: 'tool_result' }>,
): void {
  if (entry.type !== 'user') return;
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message) return;
  const rawContent = message.content;
  if (!Array.isArray(rawContent)) return;
  const toolUseResult = entry.toolUseResult as Record<string, unknown> | undefined;
  const blocks = buildToolResultBlocks(message, toolUseResult);
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      results.set(block.toolUseId, block);
    }
  }
}

/** Inject subagent tool_result blocks after their matching tool_use in assistant messages. */
function attachSubagentToolResults(
  messages: ChatMessage[],
  results: Map<string, MessageContent & { type: 'tool_result' }>,
): void {
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    const newContent: MessageContent[] = [];
    for (const block of msg.content) {
      newContent.push(block);
      if (block.type === 'tool_use') {
        const toolResult = results.get(block.id);
        if (toolResult) newContent.push(toolResult);
      }
    }
    msg.content = newContent;
  }
}

function injectAgentChildren(messages: ChatMessage[], agentTools: Map<string, MessageContent[]>): void {
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    const newContent: MessageContent[] = [];
    for (const block of msg.content) {
      newContent.push(block);
      if (block.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task')) {
        const children = agentTools.get(block.id);
        if (children) newContent.push(...children);
      }
    }
    msg.content = newContent;
  }
}

function getSessionJsonlPath(sessionId: string, projectPath: string): { jsonlPath: string; projectDir: string } {
  const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(homedir(), '.claude', 'projects', encodedPath);
  return { jsonlPath: path.join(projectDir, sessionId + '.jsonl'), projectDir };
}

export async function discoverSessionJsonlFiles(
  sessionId: string,
  projectPath: string,
): Promise<{ primaryPath: string; allFiles: string[]; subagentFiles: Set<string> }> {
  const { jsonlPath, projectDir } = getSessionJsonlPath(sessionId, projectPath);

  try {
    await access(jsonlPath, constants.R_OK);
  } catch {
    return { primaryPath: jsonlPath, allFiles: [], subagentFiles: new Set() };
  }

  const jsonlFiles = [jsonlPath];
  const subagentFiles = new Set<string>();

  // Scan sibling .jsonl files (sidechains) with matching sessionId
  try {
    const entries = await readdir(projectDir);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl') || entry === sessionId + '.jsonl') continue;
      const filePath = path.join(projectDir, entry);
      const stream = createReadStream(filePath);
      try {
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          const first = JSON.parse(line);
          if (first.sessionId === sessionId) jsonlFiles.push(filePath);
          break;
        }
      } catch {
        /* skip unreadable files */
      } finally {
        stream.destroy();
      }
    }
  } catch {
    /* directory read failed, proceed with primary only */
  }

  // Scan subagent JSONL files
  const subagentDir = path.join(projectDir, sessionId, 'subagents');
  try {
    const subEntries = await readdir(subagentDir);
    for (const entry of subEntries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = path.join(subagentDir, entry);
      jsonlFiles.push(filePath);
      subagentFiles.add(filePath);
    }
  } catch {
    /* no subagents directory or unreadable */
  }

  return { primaryPath: jsonlPath, allFiles: jsonlFiles, subagentFiles };
}

export async function loadHistory(sessionId: string, projectPath: string): Promise<ChatMessage[]> {
  const { allFiles: jsonlFiles, subagentFiles } = await discoverSessionJsonlFiles(sessionId, projectPath);
  if (jsonlFiles.length === 0) return [];

  const messages: ChatMessage[] = [];
  const agentTools = new Map<string, MessageContent[]>();
  // Map of toolUseId → tool_result block, populated from subagent JONLs
  const subagentToolResults = new Map<string, MessageContent & { type: 'tool_result' }>();
  const seenUuids = new Set<string>();

  for (const file of jsonlFiles) {
    const isSubagentFile = subagentFiles.has(file);
    const stream = createReadStream(file);
    try {
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        log.trace({ sessionId, file, line }, '[jsonl]');
        try {
          const entry = JSON.parse(line);

          // isMeta user messages carrying skill content are written to JSONL
          // only (never emitted over stream-json), so history replay is the
          // only chance to surface a SkillLoadedCard for these turns. Detect
          // and synthesize a system 'skill_loaded' message BEFORE the generic
          // isMeta filter drops them below.
          if (entry.isMeta === true && entry.type === 'user') {
            const synthesized = synthesizeSkillLoadedFromUserEntry(entry, sessionId);
            if (synthesized) {
              if (!seenUuids.has(synthesized.id)) {
                seenUuids.add(synthesized.id);
                messages.push(synthesized);
              }
              continue;
            }
          }

          if (entry.isMeta === true) continue;
          if (entry.isCompactSummary === true || entry.isVisibleInTranscriptOnly === true) continue;

          // "Unknown command: /X" — CLI feedback for slash commands that don't
          // resolve. Split into invocation bubble + error pill on replay.
          if (entry.type === 'user') {
            const synthesized = synthesizeUnknownCommandFromUserEntry(entry, sessionId);
            if (synthesized) {
              for (const m of synthesized) {
                if (seenUuids.has(m.id)) continue;
                seenUuids.add(m.id);
                messages.push(m);
              }
              continue;
            }
          }

          // Collect tool_use blocks from agent_progress events
          if (entry.type === 'progress' && entry.data?.type === 'agent_progress') {
            collectAgentProgressTools(entry, agentTools);
            continue;
          }

          // Subagent JSONL files: only extract tool_result data to populate
          // the tool_use blocks injected via agent_progress. The subagent's own
          // assistant/user messages must NOT appear as top-level chat messages.
          if (isSubagentFile) {
            collectSubagentToolResults(entry, subagentToolResults);
            continue;
          }

          const msg = convertHistoryEntry(entry, sessionId);
          if (!msg) continue;

          // Deduplicate: primary JSONL is processed first, wins on conflicts
          if (seenUuids.has(msg.id)) continue;
          seenUuids.add(msg.id);
          messages.push(msg);
        } catch {
          // Skip malformed lines
        }
      }
    } finally {
      stream.destroy();
    }
  }

  // Inject collected subagent tool calls after their parent Agent tool_use blocks
  if (agentTools.size > 0) {
    injectAgentChildren(messages, agentTools);
  }

  // Attach tool_result data from subagent JONLs to the injected tool_use blocks
  if (subagentToolResults.size > 0) {
    attachSubagentToolResults(messages, subagentToolResults);
  }

  return messages;
}

export async function extractPlanFilePaths(sessionId: string, projectPath: string): Promise<string[]> {
  const { allFiles: jsonlFiles } = await discoverSessionJsonlFiles(sessionId, projectPath);
  if (jsonlFiles.length === 0) return [];

  const { projectDir } = getSessionJsonlPath(sessionId, projectPath);
  const planFiles: string[] = [];

  for (const file of jsonlFiles) {
    const stream = createReadStream(file);
    try {
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'user') continue;
          const tur = entry.toolUseResult as Record<string, unknown> | undefined;
          if (typeof tur?.plan === 'string' && typeof tur?.filePath === 'string') {
            planFiles.push(path.resolve(projectDir, tur.filePath as string));
          }
        } catch {
          /* skip malformed */
        }
      }
    } finally {
      stream.destroy();
    }
  }

  return planFiles;
}

export async function extractSkillFilePaths(sessionId: string, projectPath: string): Promise<SkillFileEntry[]> {
  const { allFiles: jsonlFiles } = await discoverSessionJsonlFiles(sessionId, projectPath);
  if (jsonlFiles.length === 0) return [];

  const seen = new Set<string>();
  const cache = new Map<string, string>();
  const skillFiles: SkillFileEntry[] = [];
  const push = (name: string): void => {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    skillFiles.push({ path: resolveSkillPath(projectPath, trimmed, cache), displayName: trimmed });
  };

  for (const file of jsonlFiles) {
    const stream = createReadStream(file);
    try {
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'assistant') continue;
          const content = entry.message?.content;
          if (!Array.isArray(content)) continue;
          for (const block of content) {
            if (block?.type === 'tool_use' && block.name === 'Skill') {
              const skill = (block.input as { skill?: unknown } | undefined)?.skill;
              if (typeof skill === 'string' && skill) push(skill);
            }
          }
        } catch {
          /* skip malformed */
        }
      }
    } finally {
      stream.destroy();
    }
  }

  return skillFiles;
}
