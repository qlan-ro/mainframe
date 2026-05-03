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

import { readFile } from 'node:fs/promises';
import type {
  ThreadItem,
  AgentMessageItem,
  CommandExecutionItem,
  ReasoningItem,
  UserMessageItem,
} from './item-types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:rollout');

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
export async function readRolloutItems(rolloutPath: string): Promise<ThreadItem[]> {
  let raw: string;
  try {
    raw = await readFile(rolloutPath, 'utf8');
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
      const cmd: CommandExecutionItem = {
        id: p.call_id,
        type: 'commandExecution',
        command: exec.command,
        aggregatedOutput: extractRolloutOutput(p.output ?? ''),
        exitCode: 0,
        status: 'completed',
      };
      items.push(cmd);
      continue;
    }
  }

  return items;
}

/** Strip Codex's chunk-metadata header from function_call_output strings. */
function extractRolloutOutput(raw: string): string {
  // Codex prefixes outputs with "Chunk ID: ...\nWall time: ...\nOriginal token count: ...\nOutput:\n"
  const marker = '\nOutput:\n';
  const idx = raw.indexOf(marker);
  return idx >= 0 ? raw.slice(idx + marker.length) : raw;
}
