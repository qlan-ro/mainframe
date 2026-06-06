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
 * POST failure leaves the draft intact so the user can retry.
 */
import type { Chat } from '@qlan-ro/mainframe-types';
import { createChat } from '../../../lib/api/chats';
import { getDraftConfig } from './draft-config';

/**
 * Create the daemon chat for a local thread from its stashed draft config.
 * Returns the new chat's id as `remoteId`. Throws if no draft exists or the
 * POST fails (draft is preserved for retry).
 */
export async function createForLocal(localId: string, port: number): Promise<{ remoteId: string }> {
  const cfg = getDraftConfig(localId);
  if (!cfg) {
    throw new Error(`new-thread-coordinator: no draft config for ${localId}`);
  }
  const chat: Chat = await createChat(port, {
    projectId: cfg.projectId,
    adapterId: cfg.adapterId,
    ...(cfg.model !== undefined ? { model: cfg.model } : {}),
    permissionMode: cfg.permissionMode,
    ...(cfg.worktreePath !== undefined ? { worktreePath: cfg.worktreePath } : {}),
    ...(cfg.branchName !== undefined ? { branchName: cfg.branchName } : {}),
  });
  return { remoteId: chat.id };
}
