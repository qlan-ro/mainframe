// packages/core/src/plugins/builtin/codex/rollout-reader.ts
//
// Parses a Codex rollout JSONL file into ThreadItem[]. The rollout is the raw
// per-thread session log Codex writes to ~/.codex/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl
// — it contains every ResponseItem the agent processed (function_call,
// function_call_output, message, reasoning), unlike `thread/read` which filters
// child-thread `commandExecution`s out.
//
// We only use it for SUB-AGENT child threads on history reload, so the TaskGroup
// card can show nested bash commands. The parent thread continues to use the
// JSON-RPC `thread/read` path (which works fine).

import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import type {
  ThreadItem,
  AgentMessageItem,
  CommandExecutionItem,
  ReasoningItem,
  UserMessageItem,
} from './item-types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:rollout');

/** Only paths inside ~/.codex/sessions are allowed — rollout_path comes from an
 * externally-owned SQLite DB so we treat it as untrusted input. */
const SESSIONS_ROOT = join(homedir(), '.codex', 'sessions') + sep;

interface RolloutLine {
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
    summary?: Array<{ type?: string; text?: string }>;
  };
}

/**
 * Read a rollout JSONL and return ThreadItems in the same shape as `thread/read`,
 * but with `commandExecution` items reconstructed from the raw `function_call` /
 * `function_call_output` records.
 */
export async function readRolloutItems(rolloutPath: string, expectedThreadId?: string): Promise<ThreadItem[]> {
  // Resolve symlinks and ensure the file lives inside ~/.codex/sessions/. Rejects
  // path-traversal attempts even though the value comes from Codex's own DB.
  let resolved: string;
  try {
    resolved = await realpath(rolloutPath);
  } catch (err) {
    log.warn({ err: String(err), rolloutPath }, 'codex: rollout file not found');
    return [];
  }
  if (!resolved.startsWith(SESSIONS_ROOT)) {
    log.warn({ rolloutPath, resolved }, 'codex: rollout path outside ~/.codex/sessions, refusing to read');
    return [];
  }
  // Sanity check: the rollout filename should embed the thread id (Codex's own
  // convention is `rollout-<timestamp>-<threadId>.jsonl`).
  if (expectedThreadId && !resolved.includes(expectedThreadId)) {
    log.warn({ rolloutPath, expectedThreadId }, 'codex: rollout filename does not match thread id, refusing to read');
    return [];
  }

  let raw: string;
  try {
    raw = await readFile(resolved, 'utf8');
  } catch (err) {
    log.warn({ err: String(err), rolloutPath }, 'codex: failed to read rollout file');
    return [];
  }

  const items: ThreadItem[] = [];
  // Track function_call records by call_id so we can pair them with their outputs.
  const pendingExec = new Map<string, { command: string }>();
  let counter = 0;
  const nextId = () => `rollout-${counter++}`;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec: RolloutLine;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type !== 'response_item' || !rec.payload) continue;
    const p = rec.payload;

    // ─── Messages ────────────────────────────────────────────────────────────
    if (p.type === 'message' && Array.isArray(p.content)) {
      const text = p.content
        .filter((c) => c.type === 'output_text' || c.type === 'input_text')
        .map((c) => c.text ?? '')
        .join('');
      if (!text) continue;
      if (p.role === 'assistant') {
        const msg: AgentMessageItem = { id: nextId(), type: 'agentMessage', text, phase: null };
        items.push(msg);
      } else if (p.role === 'user') {
        const msg: UserMessageItem = { id: nextId(), type: 'userMessage', text };
        items.push(msg);
      }
      continue;
    }

    // ─── Reasoning ───────────────────────────────────────────────────────────
    if (p.type === 'reasoning' && Array.isArray(p.summary)) {
      const summary = p.summary.map((s) => s.text ?? '').filter(Boolean);
      if (summary.length === 0) continue;
      const msg: ReasoningItem = { id: nextId(), type: 'reasoning', summary, content: [] };
      items.push(msg);
      continue;
    }

    // ─── Bash exec (function_call → exec_command) ────────────────────────────
    if (p.type === 'function_call' && p.name === 'exec_command' && p.call_id && p.arguments) {
      try {
        const args = JSON.parse(p.arguments) as { cmd?: string };
        if (args.cmd) pendingExec.set(p.call_id, { command: args.cmd });
      } catch {
        /* malformed arguments — skip */
      }
      continue;
    }

    if (p.type === 'function_call_output' && p.call_id) {
      const exec = pendingExec.get(p.call_id);
      if (!exec) continue;
      pendingExec.delete(p.call_id);
      const { exitCode, output } = parseRolloutOutput(p.output ?? '');
      const cmd: CommandExecutionItem = {
        id: p.call_id,
        type: 'commandExecution',
        command: exec.command,
        aggregatedOutput: output,
        exitCode,
        status: exitCode === 0 ? 'completed' : 'failed',
      };
      items.push(cmd);
      continue;
    }
  }

  return items;
}

/**
 * Parse Codex's function_call_output payload. The string starts with a header:
 *   "Chunk ID: f71ecd\nWall time: 0.0000 seconds\nProcess exited with code N\n
 *    Original token count: 1052\nOutput:\n<actual output>"
 * Extract the exit code and strip the header.
 */
function parseRolloutOutput(raw: string): { exitCode: number; output: string } {
  const exitMatch = raw.match(/^Process exited with code (-?\d+)/m);
  const exitCode = exitMatch ? Number.parseInt(exitMatch[1]!, 10) : 0;
  const marker = '\nOutput:\n';
  const idx = raw.indexOf(marker);
  const output = idx >= 0 ? raw.slice(idx + marker.length) : raw;
  return { exitCode, output };
}
