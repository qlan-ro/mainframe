import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { lookupAgentMetadata, type AgentMetadata } from './thread-registry.js';

interface CodexTranscriptDeps {
  /** Registry lookup — injectable for tests; defaults to Codex's state DB. */
  lookup?: (threadIds: readonly string[]) => Map<string, AgentMetadata>;
  /** Sessions root the rollout must live under — injectable for tests. */
  sessionsRoot?: string;
}

/**
 * Whether the Codex rollout transcript for `threadId` still exists on disk.
 * Returns `null` (cannot determine — don't flag) when the state DB has no row,
 * the row carries no rollout path, or the path escapes `~/.codex/sessions`
 * (untrusted input, mirrors rollout-reader.ts containment).
 */
export async function isCodexTranscriptPresent(threadId: string, deps?: CodexTranscriptDeps): Promise<boolean | null> {
  const lookup = deps?.lookup ?? lookupAgentMetadata;
  const rolloutPath = lookup([threadId]).get(threadId)?.rolloutPath;
  if (!rolloutPath) return null;

  let resolved: string;
  try {
    resolved = await realpath(rolloutPath);
  } catch {
    /* expected: rollout file deleted */
    return false;
  }

  const rootBase = deps?.sessionsRoot ?? join(homedir(), '.codex', 'sessions');
  let rootResolved = rootBase;
  try {
    rootResolved = await realpath(rootBase);
  } catch {
    /* expected: root may not exist yet — compare against the literal path */
  }
  if (!resolved.startsWith(rootResolved + sep)) return null;
  return true;
}
