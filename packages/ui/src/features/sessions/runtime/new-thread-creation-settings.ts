import type { Chat, SessionTuning } from '@qlan-ro/mainframe-types';
import { createChat, setChatConfig, setChatTuning } from '../../../lib/api/chats';
import { enableWorktree } from '../../../lib/api/git';
import { mfToast } from '../../../lib/toast';
import type { DraftCfg } from './draft-config';

export type InitializedDraft = DraftCfg &
  Required<
    Pick<DraftCfg, 'model' | 'permissionMode' | 'planMode' | 'effort' | 'fast' | 'ultracode' | 'adaptiveThinking'>
  >;

export function requireInitializedDraft(localId: string, cfg: DraftCfg): InitializedDraft {
  const fields = ['model', 'permissionMode', 'planMode', 'effort', 'fast', 'ultracode', 'adaptiveThinking'] as const;
  const missing = fields.filter((field) => cfg[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`new-thread-coordinator: incomplete draft config for ${localId}: ${missing.join(', ')}`);
  }
  return cfg as InitializedDraft;
}

export async function applyDraftTuning(port: number, chatId: string, cfg: InitializedDraft): Promise<void> {
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

export async function applyPendingWorktree(port: number, chatId: string, cfg: DraftCfg): Promise<void> {
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

export function createDraftChat(port: number, cfg: InitializedDraft): Promise<Chat> {
  const useWorktree = cfg.projectId != null && cfg.temporary !== true;
  return createChat(port, {
    ...(cfg.projectId != null ? { projectId: cfg.projectId } : { noProject: true }),
    adapterId: cfg.adapterId,
    model: cfg.model,
    permissionMode: cfg.permissionMode,
    ...(useWorktree && cfg.worktreePath !== undefined ? { worktreePath: cfg.worktreePath } : {}),
    ...(useWorktree && cfg.branchName !== undefined ? { branchName: cfg.branchName } : {}),
    ...(cfg.temporary === true ? { temporary: true } : {}),
  });
}
