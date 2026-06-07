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
import type { Chat } from '@qlan-ro/mainframe-types';
import { createChat } from '../../../lib/api/chats';
import { getDraftConfig, clearDraftConfig } from './draft-config';

/** In-flight (and just-settled) create promises, keyed by the local thread id. */
const inFlight = new Map<string, Promise<{ remoteId: string }>>();

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
    permissionMode: cfg.permissionMode,
    ...(cfg.worktreePath !== undefined ? { worktreePath: cfg.worktreePath } : {}),
    ...(cfg.branchName !== undefined ? { branchName: cfg.branchName } : {}),
  })
    .then((chat: Chat) => {
      // Created — the draft is consumed and the cache entry can be evicted so a
      // future recycled localId starts fresh. The resolved value still flows to
      // every awaiter that shares this promise.
      clearDraftConfig(localId);
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
