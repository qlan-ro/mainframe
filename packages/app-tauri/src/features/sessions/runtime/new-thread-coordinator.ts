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
import { getDraftConfig, clearDraftConfig, type DraftCfg } from './draft-config';
import { useNewThreadReady } from './new-thread-ready-store';

/** In-flight (and just-settled) create promises, keyed by the local thread id. */
const inFlight = new Map<string, Promise<{ remoteId: string }>>();

/**
 * Apply the draft fields createChat does NOT accept — planMode (PATCH /config)
 * and effort/features (PATCH /tuning) — to the freshly created chat, before the
 * first send spawns the CLI. Best-effort: a tuning hiccup is logged, never
 * thrown, so it can't orphan an already-created chat.
 */
async function applyDraftTuning(port: number, chatId: string, cfg: DraftCfg): Promise<void> {
  const tuning: SessionTuning = {};
  if (cfg.effort !== undefined) tuning.effort = cfg.effort;
  if (cfg.fast != null) tuning.fast = cfg.fast;
  if (cfg.ultracode != null) tuning.ultracode = cfg.ultracode;
  if (cfg.adaptiveThinking != null) tuning.adaptiveThinking = cfg.adaptiveThinking;
  try {
    if (Object.keys(tuning).length > 0) await setChatTuning(port, chatId, tuning);
    if (cfg.planMode != null) await setChatConfig(port, chatId, { planMode: cfg.planMode });
  } catch (err) {
    console.warn('[new-thread-coordinator] applyDraftTuning failed', { chatId, err });
  }
}

/**
 * Create the daemon chat for a local thread from its stashed draft config.
 * Returns the new chat's id as `remoteId`. Idempotent per localId: concurrent
 * or repeat calls return the same in-flight promise (one POST, one chat).
 * Throws if no draft exists or the POST fails (cache + draft preserved for retry).
 */
export function createForLocal(localId: string, port: number): Promise<{ remoteId: string }> {
  const existing = inFlight.get(localId);
  if (existing) return existing;

  const cfg = getDraftConfig(localId);
  if (!cfg) {
    return Promise.reject(new Error(`new-thread-coordinator: no draft config for ${localId}`));
  }

  const promise = createChat(port, {
    projectId: cfg.projectId,
    adapterId: cfg.adapterId,
    ...(cfg.model !== undefined ? { model: cfg.model } : {}),
    // Omit when unset so the daemon's createChatWithDefaults applies the user's
    // provider defaultMode (matching desktop) instead of forcing 'default'.
    ...(cfg.permissionMode !== undefined ? { permissionMode: cfg.permissionMode } : {}),
    ...(cfg.worktreePath !== undefined ? { worktreePath: cfg.worktreePath } : {}),
    ...(cfg.branchName !== undefined ? { branchName: cfg.branchName } : {}),
  })
    .then(async (chat: Chat) => {
      // Carry the draft fields createChat can't take (planMode/effort/features)
      // onto the new chat BEFORE the first send spawns the CLI.
      await applyDraftTuning(port, chat.id, cfg);
      // Created — the draft is consumed and the cache entry can be evicted so a
      // future recycled localId starts fresh. The reactive ready flag is cleared
      // too (its job — switching the surface to the composer — is done; the thread
      // now flips to a real chat). The resolved value still flows to every awaiter
      // that shares this promise.
      clearDraftConfig(localId);
      useNewThreadReady.getState().clearReady(localId);
      inFlight.delete(localId);
      return { remoteId: chat.id };
    })
    .catch((err: unknown) => {
      // Keep the draft intact AND drop the cached rejection so the next call
      // (user retry) starts a fresh POST rather than re-throwing the stale one.
      inFlight.delete(localId);
      throw err;
    });

  inFlight.set(localId, promise);
  return promise;
}
