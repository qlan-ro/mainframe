// packages/core/src/plugins/builtin/codex/thread-registry.ts
//
// Reads ~/.codex/state_5.sqlite (Codex's own thread registry, read-only) to
// look up sub-agent metadata that isn't exposed via app-server JSON-RPC:
//   - agent_nickname (e.g. "Maxwell")
//   - agent_role     (e.g. "explorer") — used as the TaskGroup card title
// Falls back gracefully if the DB or row is missing.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { accessSync, constants } from 'node:fs';
import Database from 'better-sqlite3';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:thread-registry');

export interface AgentMetadata {
  nickname: string | null;
  role: string | null;
  rolloutPath: string | null;
}

const DB_PATH = join(homedir(), '.codex', 'state_5.sqlite');

/**
 * Look up agent_nickname/agent_role for the given Codex thread ids. Returns a
 * map keyed by threadId; missing rows are simply absent. Safe to call when the
 * DB doesn't exist (returns an empty map and logs once).
 */
export function lookupAgentMetadata(threadIds: readonly string[]): Map<string, AgentMetadata> {
  const result = new Map<string, AgentMetadata>();
  if (threadIds.length === 0) return result;

  try {
    accessSync(DB_PATH, constants.R_OK);
  } catch {
    log.debug({ DB_PATH }, 'codex state DB not accessible — agent name lookup skipped');
    return result;
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const placeholders = threadIds.map(() => '?').join(',');
    const rows = db
      .prepare<
        string[],
        { id: string; agent_nickname: string | null; agent_role: string | null; rollout_path: string | null }
      >(`SELECT id, agent_nickname, agent_role, rollout_path FROM threads WHERE id IN (${placeholders})`)
      .all(...threadIds);
    for (const row of rows) {
      result.set(row.id, { nickname: row.agent_nickname, role: row.agent_role, rolloutPath: row.rollout_path });
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'codex: failed to read thread registry');
  } finally {
    db?.close();
  }
  return result;
}

/** The agent's role (e.g. "explorer") — best for the card subtitle. */
export function describeAgent(meta: AgentMetadata | undefined): string | null {
  if (!meta) return null;
  return meta.role ?? meta.nickname ?? null;
}

/** The agent's nickname (e.g. "Maxwell") — used as the card title (subagent_type). */
export function agentTitle(meta: AgentMetadata | undefined): string | null {
  if (!meta) return null;
  return meta.nickname ?? meta.role ?? null;
}
