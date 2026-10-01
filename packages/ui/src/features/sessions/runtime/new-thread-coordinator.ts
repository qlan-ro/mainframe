import { archiveChat, discardChat } from '../../../lib/api/chats';
import { useDraftReturnTarget } from '../new-thread/use-draft-return-target';
import { getDraftConfig, clearDraftConfig } from './draft-config';
import { useNewThreadReady } from './new-thread-ready-store';
import { markChatDiscarded } from './ghost-chat-queue';
import {
  applyDraftTuning,
  applyPendingWorktree,
  createDraftChat,
  requireInitializedDraft,
  type InitializedDraft,
} from './new-thread-creation-settings';

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
const lifecycleListeners = new Set<() => void>();

export function subscribeCreateLifecycle(listener: () => void): () => void {
  lifecycleListeners.add(listener);
  return () => {
    lifecycleListeners.delete(listener);
  };
}

function publishLifecycle(): void {
  for (const listener of lifecycleListeners) listener();
}

export function isCreatePending(localId: string): boolean {
  return workflows.get(localId)?.promise !== undefined;
}

function archiveAbandonedWorkflow(workflow: CreateWorkflow): void {
  if (!workflow.chatId || workflow.archiveRequested) return;
  workflow.archiveRequested = true;
  const chatId = workflow.chatId;
  const cleanup = workflow.cfg.temporary
    ? discardChat(workflow.port, chatId)
    : archiveChat(workflow.port, chatId, true);
  void cleanup
    .then(() => {
      // Discards disappear from list responses, so the stale local entry needs explicit pruning.
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
  publishLifecycle();
}

// Boot routing also protects failed workflows retained for retry.
export function isCreateInFlight(localId: string): boolean {
  return workflows.has(localId);
}

function requireOwnedWorkflow(localId: string, workflow: CreateWorkflow): void {
  if (!workflow.abandoned && workflows.get(localId) === workflow) return;
  archiveAbandonedWorkflow(workflow);
  throw new Error(`new-thread-coordinator: workflow abandoned for ${localId}`);
}

async function runWorkflow(localId: string, workflow: CreateWorkflow): Promise<{ remoteId: string }> {
  const { cfg, port } = workflow;
  if (!workflow.chatId) workflow.chatId = (await createDraftChat(port, cfg)).id;
  requireOwnedWorkflow(localId, workflow);
  if (!workflow.worktreeApplied) {
    await applyPendingWorktree(port, workflow.chatId, cfg);
    workflow.worktreeApplied = true;
  }
  requireOwnedWorkflow(localId, workflow);
  await applyDraftTuning(port, workflow.chatId, cfg);
  requireOwnedWorkflow(localId, workflow);
  clearDraftConfig(localId);
  useNewThreadReady.getState().clearReady(localId);
  // Both first-send callers converge here, including native adapter.initialize.
  useDraftReturnTarget.getState().clear();
  return { remoteId: workflow.chatId };
}

function newWorkflow(localId: string, port: number): CreateWorkflow {
  const stored = getDraftConfig(localId);
  if (!stored) throw new Error(`new-thread-coordinator: no draft config for ${localId}`);
  const cfg = requireInitializedDraft(localId, stored);
  return {
    cfg: { ...cfg, ...(cfg.pendingWorktree ? { pendingWorktree: { ...cfg.pendingWorktree } } : {}) },
    port,
    worktreeApplied: false,
    abandoned: false,
    archiveRequested: false,
  };
}

export function createForLocal(localId: string, port: number): Promise<{ remoteId: string }> {
  const existing = workflows.get(localId);
  if (existing?.promise) return existing.promise;
  let workflow: CreateWorkflow;
  try {
    workflow = existing ?? newWorkflow(localId, port);
  } catch (error) {
    return Promise.reject(error);
  }
  workflows.set(localId, workflow);
  const promise = runWorkflow(localId, workflow).then(
    (result) => {
      if (workflows.get(localId) === workflow) workflows.delete(localId);
      publishLifecycle();
      return result;
    },
    (error: unknown) => {
      if (workflows.get(localId) === workflow) {
        workflow.promise = undefined;
        if (!workflow.chatId) workflows.delete(localId);
        publishLifecycle();
      }
      throw error;
    },
  );
  workflow.promise = promise;
  publishLifecycle();
  return promise;
}
