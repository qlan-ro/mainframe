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
 *
 * BOOT-SELECT RACE (todo #346): the first
 * fix attempt gated `useSessionListRouter`'s boot auto-select on the active
 * thread's message count (`mainMessageCount === 0`), reasoning that a send
 * already in flight would show as a non-empty thread. Live evidence showed
 * that guard is a no-op: `onNew` (`use-chat-thread-runtime.ts`) awaits
 * `createForLocal` to fully settle — through `applyPendingWorktree` and
 * `applyDraftTuning` — before `sendChatMessage` ever dispatches the optimistic
 * pending message, so the message count reads 0 for the ENTIRE window the
 * abandon race lives in, on every run, not just some. The real fix is
 * `isCreateInFlight` below: boot-select consumes its one-shot the moment it
 * sees a workflow open for the draft it would otherwise switch off of (round
 * 3 correction — see `useSessionListRouter`'s own comment for why deferring
 * that consumption instead raced its handoff switch), so it never competes
 * with an in-progress first send regardless of message count.
 *
 * RETURN-TARGET RETIREMENT (todo #346): a deliberate New
 * stamps `useDraftReturnTarget` with the thread it came from, so discarding
 * the unsent draft can restore that selection. Once the draft COMMITS here,
 * that return target is stale and must be cleared — left alone, a LATER,
 * unrelated archive/discard of the thread the draft came from is misread by
 * `reconcileDraftHandoff` as "still just a deliberate New" and swallowed,
 * stranding the user on an empty draft instead of the fallback that archive
 * should have produced. This is the one place to clear it, not
 * `useSessionListRouter`'s own first-send-handoff branch: aui's native
 * `adapter.initialize()` seam can win the create-once race and move
 * `mainThreadId` onto the remote id itself before that branch's own
 * `items`-reload check ever turns true, so a clear placed there never fires
 * for that path. Both callers converge on `createForLocal` (see IDEMPOTENCY
 * above), so its success below is the only race-free "this draft just
 * committed" signal.
 */
import type { Chat, SessionTuning } from '@qlan-ro/mainframe-types';
import { archiveChat, createChat, discardChat, setChatConfig, setChatTuning } from '../../../lib/api/chats';
import { enableWorktree } from '../../../lib/api/git';
import { mfToast } from '../../../lib/toast';
import { useDraftReturnTarget } from '../new-thread/use-draft-return-target';
import { getDraftConfig, clearDraftConfig, type DraftCfg } from './draft-config';
import { useNewThreadReady } from './new-thread-ready-store';
import { markChatDiscarded } from './ghost-chat-queue';

interface CreateWorkflow {
  cfg: InitializedDraft;
  port: number;
  chatId?: string;
  worktreeApplied: boolean;
  abandoned: boolean;
  archiveRequested: boolean;
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
 * A temporary chat 409s on archive (todo #346 rule 5) — abandoning one must
 * discard it instead, or the cleanup call itself fails.
 */
function archiveAbandonedWorkflow(workflow: CreateWorkflow): void {
  if (!workflow.chatId || workflow.archiveRequested) return;
  workflow.archiveRequested = true;
  const chatId = workflow.chatId;
  const cleanup = workflow.cfg.temporary
    ? discardChat(workflow.port, chatId)
    : archiveChat(workflow.port, chatId, true);
  void cleanup
    .then(() => {
      // A discard removes the chat from every future `list()` response
      // without flagging the change, so aui's stale local entry never
      // self-heals via the normal reload merge — prune it explicitly
      // (todo #346). An archive DOES self-heal (the chat stays
      // listed, just re-flagged 'archived'), so only the discard path needs this.
      if (workflow.cfg.temporary) markChatDiscarded(chatId);
    })
    .catch((err: unknown) => console.warn('[new-thread-coordinator] abandon cleanup failed', { chatId, err }));
}

export function abandonCreateForLocal(localId: string): void {
  const workflow = workflows.get(localId);
  if (!workflow) return;
  workflows.delete(localId);
  workflow.abandoned = true;
  archiveAbandonedWorkflow(workflow);
}

/**
 * Whether a create workflow is still open for `localId` — from the moment
 * `createForLocal` first stages it until it settles (success, failure, or
 * abandon). `useSessionListRouter`'s boot auto-select consults this to skip
 * switching the main thread off a draft mid-create (todo #346).
 */
export function isCreateInFlight(localId: string): boolean {
  return workflows.has(localId);
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
  // A no-project draft never carries a pendingWorktree (the popover disables
  // it), but skip defensively rather than ask the daemon to isolate a chat
  // that has no project to branch from. Same for temporary — the composer
  // makes Temporary and worktree mutually exclusive, but a temporary chat
  // must never run enableWorktree even if a draft somehow carries one (todo
  // #346).
  if (!cfg.pendingWorktree || cfg.projectId == null || cfg.temporary === true) return;
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
  let workflow = existing;
  if (!workflow) {
    const stored = getDraftConfig(localId);
    if (!stored) return Promise.reject(new Error(`new-thread-coordinator: no draft config for ${localId}`));
    let cfg: InitializedDraft;
    try {
      cfg = requireInitializedDraft(localId, stored);
    } catch (error) {
      return Promise.reject(error);
    }
    workflow = {
      cfg: {
        ...cfg,
        ...(cfg.pendingWorktree ? { pendingWorktree: { ...cfg.pendingWorktree } } : {}),
      },
      port,
      worktreeApplied: false,
      abandoned: false,
      archiveRequested: false,
    };
  }
  workflows.set(localId, workflow);
  const cfg = workflow.cfg;
  const promise = (async () => {
    try {
      if (!workflow.chatId) {
        const chat: Chat = await createChat(port, {
          ...(cfg.projectId != null ? { projectId: cfg.projectId } : { noProject: true }),
          adapterId: cfg.adapterId,
          model: cfg.model,
          permissionMode: cfg.permissionMode,
          // Never send worktree fields for a no-project chat — the daemon
          // rejects the combination, and a no-project draft never has one set.
          // Never send them for a temporary chat either — the composer keeps
          // Temporary and worktree mutually exclusive, but this is the
          // defensive backstop (todo #346).
          ...(cfg.projectId != null && cfg.temporary !== true && cfg.worktreePath !== undefined
            ? { worktreePath: cfg.worktreePath }
            : {}),
          ...(cfg.projectId != null && cfg.temporary !== true && cfg.branchName !== undefined
            ? { branchName: cfg.branchName }
            : {}),
          ...(cfg.temporary === true ? { temporary: true } : {}),
        });
        workflow.chatId = chat.id;
      }
      if (workflow.abandoned) {
        archiveAbandonedWorkflow(workflow);
        throw new Error(`new-thread-coordinator: workflow abandoned for ${localId}`);
      }
      if (!workflow.worktreeApplied) {
        await applyPendingWorktree(port, workflow.chatId, cfg);
        workflow.worktreeApplied = true;
      }
      if (workflow.abandoned) {
        archiveAbandonedWorkflow(workflow);
        throw new Error(`new-thread-coordinator: workflow abandoned for ${localId}`);
      }
      await applyDraftTuning(port, workflow.chatId, cfg);
      if (workflow.abandoned || workflows.get(localId) !== workflow) {
        archiveAbandonedWorkflow(workflow);
        throw new Error(`new-thread-coordinator: workflow abandoned for ${localId}`);
      }
      clearDraftConfig(localId);
      useNewThreadReady.getState().clearReady(localId);
      // See the module docstring's RETURN-TARGET RETIREMENT note — this is the
      // one race-free "this draft just committed" signal.
      useDraftReturnTarget.getState().clear();
      workflows.delete(localId);
      return { remoteId: workflow.chatId };
    } catch (error) {
      if (workflows.get(localId) === workflow) {
        workflow.promise = undefined;
        if (!workflow.chatId) workflows.delete(localId);
      }
      throw error;
    }
  })();
  workflow.promise = promise;
  return promise;
}
