/**
 * Draft-config side-channel for the native New-thread flow.
 *
 * A `__LOCALID_*` thread has no daemon chat yet; the project/adapter the user
 * picks in NewThreadConfigPicker is stashed here keyed by the local threadId,
 * then read by the new-thread coordinator on first send to POST createChat.
 * Module-level singleton — keying by id keeps it correct even if aui holds
 * more than one empty thread.
 */
import type { PermissionMode } from '@qlan-ro/mainframe-types';

export interface DraftCfg {
  projectId: string;
  adapterId: string;
  model?: string;
  permissionMode: PermissionMode;
  worktreePath?: string;
  branchName?: string;
}

const drafts = new Map<string, DraftCfg>();

export function setDraftConfig(localId: string, cfg: DraftCfg): void {
  drafts.set(localId, cfg);
}

export function getDraftConfig(localId: string): DraftCfg | undefined {
  return drafts.get(localId);
}

export function clearDraftConfig(localId: string): void {
  drafts.delete(localId);
}
