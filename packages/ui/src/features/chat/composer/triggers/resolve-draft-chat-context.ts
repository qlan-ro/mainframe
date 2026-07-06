/**
 * resolveDraftChatContext — draft-aware project/adapter/chat resolution for the
 * composer's `/` skills, `@` agents and `@` file pickers.
 *
 * These pickers need a project (and, for skills/agents, an adapter). On a live
 * chat that comes from the controller's `chatConfig`. But before the first send a
 * `__LOCALID_*` thread has NO daemon chat yet, so `chatConfig` is null and the
 * pickers would come up empty — even though the draft already knows the project
 * (seeded by the picker / auto-config, the same source the tuning toolbar reads
 * via `synthesizeDraftChat`). Fall back to the draft so they populate immediately.
 *
 * Pure so both `SkillsProvider` and `ComposerTriggers` share one seam and it is
 * unit-tested without rendering the native trigger popovers.
 */
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';

/** Minimal chat-config shape the composer context needs. */
interface ChatConfigLike {
  adapterId?: string | null;
  projectId?: string | null;
}

export interface DraftChatContext {
  /** Project for skills/agents/file lookups — the live chat's, else the draft's. */
  projectId: string | null;
  /** Adapter for skills/agents — the live chat's, else the draft's. */
  adapterId: string | null;
  /** Daemon chat id for worktree-scoped file APIs; null for a not-yet-created draft. */
  fileChatId: string | null;
  /** True for a `__LOCALID_*` thread with no daemon chat yet. */
  isLocalDraft: boolean;
}

export function resolveDraftChatContext(
  chatId: string | null,
  chatConfig: ChatConfigLike | null,
  draft: DraftCfg | undefined,
): DraftChatContext {
  const isLocalDraft = chatId != null && chatId.startsWith('__LOCALID_') && chatConfig == null;
  const projectId = chatConfig?.projectId ?? (isLocalDraft ? (draft?.projectId ?? null) : null);
  const adapterId = chatConfig?.adapterId ?? (isLocalDraft ? (draft?.adapterId ?? null) : null);
  // A __LOCALID_* placeholder is not a real daemon chat id, and a draft has no
  // worktree — never scope the file API to it (search the project root instead).
  const fileChatId = isLocalDraft ? null : chatId;
  return { projectId, adapterId, fileChatId, isLocalDraft };
}
