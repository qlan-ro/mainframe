/**
 * New-thread coordinator (S1/S2) — the __LOCALID_* → remoteId create step.
 *
 * Native New mints a transient local thread with no daemon chat. On first send
 * (onNew) we read the draft config the picker stashed, POST createChat, and
 * return the new daemon chat id. The caller then stamps it on the controller
 * via setRemoteId() and sends the message. assistant-ui's adapter.initialize
 * also calls this (the library's own create seam) — both paths read the same
 * draft and produce a daemon chat id; there is no id-flip, so the controller
 * (keyed by the stable local id) simply learns its remote id.
 *
 * IDEMPOTENCY (the create-once invariant): on first send BOTH paths fire for
 * the same local thread within the same tick — our external-store `onNew` AND
 * assistant-ui's native `initialize` event (the latter when the optimistic
 * message flips the thread's message count 0→1, see RemoteThreadListHookInstance
 * Manager's `unstable_on("initialize")`). Without a guard each would POST
 * createChat, producing TWO daemon chats: the controller binds to the first,
 * aui stamps `item.remoteId` from the second → an orphaned empty session.
 *
 * The fix: cache the in-flight create Promise keyed by localId. Concurrent or
 * repeat calls share the SAME promise → exactly ONE POST and the SAME
 * `{ remoteId }`, so onNew (createForLocal → setRemoteId → sendMessage) and
 * adapter.initialize (createForLocal → return remoteId) converge on one chat.
 *
 * On success the draft is cleared and the cache entry settled-evicted (a later
 * unrelated New of the same recycled localId starts fresh). On failure the
 * cache entry AND the draft are left intact so the user can retry.
 */
import type { Chat, SessionTuning } from '@qlan-ro/mainframe-types';
import { createChat, setChatConfig, setChatTuning } from '../../../lib/api/chats';
import { enableWorktree } from '../../../lib/api/git';
import { mfToast } from '../../../lib/toast';
import { getDraftConfig, clearDraftConfig, type DraftCfg } from './draft-config';
import { useNewThreadReady } from './new-thread-ready-store';

interface CreateWorkflow {
  chatId?: string;
  worktreeApplied: boolean;
  promise?: Promise<{ remoteId: string }>;
}

const workflows = new Map<string, CreateWorkflow>();

type InitializedDraft = DraftCfg &
  Required<
    Pick<DraftCfg, 'model' | 'permissionMode' | 'planMode' | 'effort' | 'fast' | 'ultracode' | 'adaptiveThinking'>
  >;

function requireInitializedDraft(localId: string, cfg: DraftCfg): InitializedDraft {
  const fields = ['model', 'permissionMode', 'planMode', 'effort', 'fast', 'ultracode', 'adaptiveThinking'] as const;
  const missing = fields.filter((field) => cfg[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`new-thread-coordinator: incomplete draft config for ${localId}: ${missing.join(', ')}`);
  }
  return cfg as InitializedDraft;
}

/**
 * Apply the draft fields createChat does NOT accept — planMode (PATCH /config)
 * and effort/features (PATCH /tuning) — to the freshly created chat, before the
 * first send spawns the CLI. Both requests must settle so a failure in one does
 * not skip the other required snapshot field.
 */
async function applyDraftTuning(port: number, chatId: string, cfg: InitializedDraft): Promise<void> {
  const tuning: SessionTuning = {};
  tuning.effort = cfg.effort;
  if (cfg.fast != null) tuning.fast = cfg.fast;
  if (cfg.ultracode != null) tuning.ultracode = cfg.ultracode;
  if (cfg.adaptiveThinking != null) tuning.adaptiveThinking = cfg.adaptiveThinking;
  const results = await Promise.allSettled([
    setChatTuning(port, chatId, tuning),
    setChatConfig(port, chatId, { planMode: cfg.planMode }),
  ]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

/**
 * Create the "New" worktree chosen pre-send (WorktreePopover on a draft) —
 * enable-worktree is chat-scoped, so it can only run once the chat exists,
 * BEFORE the first send spawns the CLI (so it spawns in the worktree cwd).
 * Best-effort: on failure the session continues in the main repo, surfaced
 * with an error toast (the popover that reported errors inline is long gone).
 */
async function applyPendingWorktree(port: number, chatId: string, cfg: DraftCfg): Promise<void> {
  if (!cfg.pendingWorktree) return;
  const { baseBranch, branchName } = cfg.pendingWorktree;
  try {
    await enableWorktree(port, chatId, baseBranch, branchName);
  } catch (err) {
    console.warn('[new-thread-coordinator] applyPendingWorktree failed', { chatId, err });
    mfToast.error(`Couldn't create worktree "${branchName}"`, {
      description: 'The session continues in the main repository.',
      chatId,
    });
  }
}

/**
 * Create the daemon chat for a local thread from its stashed draft config.
 * Returns the new chat's id as `remoteId`. Idempotent per localId: concurrent
 * or repeat calls return the same in-flight promise (one POST, one chat).
 * Throws if no draft exists or the POST fails (cache + draft preserved for retry).
 */
export function createForLocal(localId: string, port: number): Promise<{ remoteId: string }> {
  const existing = workflows.get(localId);
  if (existing?.promise) return existing.promise;

  const stored = getDraftConfig(localId);
  if (!stored) {
    return Promise.reject(new Error(`new-thread-coordinator: no draft config for ${localId}`));
  }
  let cfg: InitializedDraft;
  try {
    cfg = requireInitializedDraft(localId, stored);
  } catch (error) {
    return Promise.reject(error);
  }

  const workflow = existing ?? { worktreeApplied: false };
  workflows.set(localId, workflow);
  const promise = (async () => {
    try {
      if (!workflow.chatId) {
        const chat: Chat = await createChat(port, {
          projectId: cfg.projectId,
          adapterId: cfg.adapterId,
          model: cfg.model,
          permissionMode: cfg.permissionMode,
          ...(cfg.worktreePath !== undefined ? { worktreePath: cfg.worktreePath } : {}),
          ...(cfg.branchName !== undefined ? { branchName: cfg.branchName } : {}),
        });
        workflow.chatId = chat.id;
      }
      if (!workflow.worktreeApplied) {
        await applyPendingWorktree(port, workflow.chatId, cfg);
        workflow.worktreeApplied = true;
      }
      await applyDraftTuning(port, workflow.chatId, cfg);
      clearDraftConfig(localId);
      useNewThreadReady.getState().clearReady(localId);
      workflows.delete(localId);
      return { remoteId: workflow.chatId };
    } catch (error) {
      workflow.promise = undefined;
      if (!workflow.chatId) workflows.delete(localId);
      throw error;
    }
  })();
  workflow.promise = promise;
  return promise;
}
