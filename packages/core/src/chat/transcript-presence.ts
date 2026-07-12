/**
 * Transcript-presence reconciliation (degraded-chat detection).
 *
 * The CLI owns the transcript file (Claude `~/.claude/projects/...jsonl`,
 * Codex `~/.codex/sessions/...`); retention cleanup or manual deletion leaves
 * the Mainframe chat row behind with a dead `--resume` target. This helper
 * stats the transcript via the adapter predicate and keeps the persisted
 * `transcript_missing` flag in sync — set when the file is gone, cleared when
 * it reappears (self-healing). Runs on history load and on the periodic
 * external-session sweep; idempotent, so scan/load races are harmless.
 */
import type { Adapter, Chat, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { ChatsRepository } from '../db/chats.js';
import type { ProjectsRepository } from '../db/projects.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('chat:transcript-presence');

export interface TranscriptPresenceDeps {
  db: { chats: ChatsRepository; projects: ProjectsRepository };
  adapters: { get(adapterId: string): Adapter | undefined };
  emitEvent: (event: DaemonEvent) => void;
  /** Mirror the flag into the in-memory active-chat cache (ChatManager.syncChatFields). */
  syncChatFields: (chatId: string, partial: Partial<Chat>) => void;
}

/**
 * Reconcile the persisted `transcriptMissing` flag against the transcript file
 * on disk. Returns the current missing-state after reconciliation.
 *
 * Skips (returns the existing flag unchanged) when:
 * - the chat has an active run — the CLI owns the file mid-session;
 * - the adapter has no `isTranscriptPresent` predicate;
 * - presence cannot be determined (predicate returns `null` or throws).
 */
export async function reconcileTranscriptPresence(deps: TranscriptPresenceDeps, chat: Chat): Promise<boolean> {
  const current = chat.transcriptMissing ?? false;

  if (chat.processState === 'working') return current;

  // A chat that never spawned a CLI session is new, not degraded — clear any stale flag.
  if (!chat.claudeSessionId) {
    if (current) applyFlag(deps, chat, false);
    return false;
  }

  const adapter = deps.adapters.get(chat.adapterId);
  if (!adapter?.isTranscriptPresent) return current;

  const project = deps.db.projects.get(chat.projectId);
  if (!project) return current;

  let present: boolean | null;
  try {
    present = await adapter.isTranscriptPresent(
      chat.claudeSessionId,
      chat.worktreePath ?? project.path,
      chat.sessionFilePath ?? null,
    );
  } catch (err) {
    log.warn({ err, chatId: chat.id, adapterId: chat.adapterId }, 'isTranscriptPresent failed');
    return current;
  }
  if (present === null) return current;

  const missing = !present;
  if (missing !== current) applyFlag(deps, chat, missing);
  return missing;
}

/** Persist the flipped flag, mirror it in memory, and broadcast chat.updated. */
function applyFlag(deps: TranscriptPresenceDeps, chat: Chat, missing: boolean): void {
  deps.db.chats.update(chat.id, { transcriptMissing: missing });
  chat.transcriptMissing = missing;
  deps.syncChatFields(chat.id, { transcriptMissing: missing });
  deps.emitEvent({ type: 'chat.updated', chat });
}
