import { createReadStream } from 'node:fs';
import { access, constants, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { ChatMessage, MessageContent, SkillFileEntry } from '@qlan-ro/mainframe-types';
import { getSessionJsonlPath } from './transcript.js';
import { resolveSkillPath } from './skill-path.js';
import { createChildLogger } from '../../../logger.js';
import {
  convertHistoryEntry,
  synthesizeUnknownCommandFromUserEntry,
  synthesizeSkillLoadedFromUserEntry,
} from './history-converters.js';
import {
  collectAgentProgressTools,
  collectSubagentToolResults,
  captureAgentIdMapping,
  collectSubagentAssistantBlocks,
  attachSubagentToolResults,
  injectAgentChildren,
} from './history-subagents.js';

const log = createChildLogger('claude:history');

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
  // CLI 2.1.118+ subagent JSONLs omit parentToolUseID. The link is kept on the
  // parent's tool_result via toolUseResult.agentId. Build that map as we walk
  // the parent file so subagent-file processing can resolve the parent id.
  const agentIdToParentToolUseId = new Map<string, string>();

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
          //
          // Skip subagent and sidechain entries: each subagent loads its own
          // skills and writes its own "Base directory for this skill:" entry.
          // Live mode hides those from the parent thread (subagent activity
          // surfaces only through agent_progress + the parent's Task tool_use),
          // so promoting them on replay creates ghost SkillLoadedCards that
          // never appeared during the live session.
          if (entry.isMeta === true && entry.type === 'user' && !isSubagentFile && entry.isSidechain !== true) {
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

          // Subagent JSONL files: extract tool_result and assistant blocks to
          // inline under the parent's Agent tool_use. These entries must NOT
          // appear as top-level chat messages — they're surfaced via the
          // injectAgentChildren / attachSubagentToolResults pipeline below.
          if (isSubagentFile) {
            collectSubagentToolResults(entry, subagentToolResults);
            collectSubagentAssistantBlocks(entry, agentTools, agentIdToParentToolUseId);
            continue;
          }

          // Capture agentId → parent tool_use_id mapping from the parent's
          // tool_result for any Task/Agent dispatch. discoverSessionJsonlFiles
          // returns the parent file before subagent files, so the map is built
          // by the time subagent processing needs it.
          if (entry.type === 'user') captureAgentIdMapping(entry, agentIdToParentToolUseId);

          // Sidechain entries are subagent activity (Task/Agent tool spawns its
          // own CLI session whose messages share our sessionId but live in a
          // sibling JSONL). The subagent's first user message is its dispatch
          // prompt — converting it would render a ghost user bubble in the
          // parent thread. Skill-loaded synthesis above runs first so user-typed
          // /skill invocations are preserved.
          if (entry.isSidechain === true) continue;

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
