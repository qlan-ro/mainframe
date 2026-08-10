/**
 * openNewThreadDraft — the order-sensitive new-thread sequence (spec §2.4).
 *
 * Pure and dependency-injected so both call sites (the sidebar "New" button
 * and the selection toolbar's "New session" action) share one implementation.
 * Every dependency is read fresh via `runtimeThreads.getState()` rather than
 * captured once, because a call site can unmount mid-await.
 */
export interface OpenNewThreadDraftDeps {
  filterProjectId: string | null;
  setFilterProjectId: (id: string | null) => void;
  /**
   * Widened to accept the aui `threads` scope as-is: it declares `newThreadId`
   * as `string | null`, `mainThreadId` as `string`, and `switchToNewThread()`
   * as `void` — narrower than the legacy thread-list runtime this replaced.
   */
  runtimeThreads: {
    getState: () => { newThreadId: string | null | undefined; mainThreadId: string | null };
    switchToNewThread: () => void | Promise<void>;
  };
  setReturnTarget: (id: string | null) => void;
  resetNewThreadDraft: (id: string | null | undefined) => void;
  initializeDraft: (args: { localId: string; projectId: string }) => Promise<unknown>;
  setText: (text: string) => void;
  mfToastError: (title: string, options: { description: string }) => void;
}

export interface OpenNewThreadDraftArgs {
  projectId: string;
  prefill?: string;
}

export async function openNewThreadDraft(args: OpenNewThreadDraftArgs, deps: OpenNewThreadDraftDeps): Promise<void> {
  const { projectId, prefill } = args;
  const {
    filterProjectId,
    setFilterProjectId,
    runtimeThreads,
    setReturnTarget,
    resetNewThreadDraft,
    initializeDraft,
    setText,
    mfToastError,
  } = deps;

  if (filterProjectId != null && filterProjectId !== projectId) {
    setFilterProjectId(null);
  }

  setReturnTarget(runtimeThreads.getState().mainThreadId ?? null);

  resetNewThreadDraft(runtimeThreads.getState().newThreadId);
  await runtimeThreads.switchToNewThread();
  const newThreadId = runtimeThreads.getState().newThreadId;
  if (newThreadId == null) return;

  try {
    await initializeDraft({ localId: newThreadId, projectId });
  } catch (error) {
    mfToastError('Couldn’t initialize session', {
      description: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (prefill !== undefined) {
    setText(prefill);
  }
}
