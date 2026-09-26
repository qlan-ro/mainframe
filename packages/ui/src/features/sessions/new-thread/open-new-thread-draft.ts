/**
 * openNewThreadDraft — the order-sensitive new-thread sequence (spec §2.4).
 *
 * Pure and dependency-injected so both call sites (the sidebar "New" button
 * and the selection toolbar's "New session" action) share one implementation.
 * Every dependency is read fresh via `runtimeThreads.getState()` rather than
 * captured once, because a call site can unmount mid-await.
 */
export interface OpenNewThreadDraftDeps {
  filterProjectIds: ReadonlySet<string>;
  clearProjectFilter: () => void;
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
  initializeDraft: (args: { localId: string; projectId: string; adapterId?: string }) => Promise<unknown>;
  setText: (text: string) => void;
  mfToastError: (title: string, options: { description: string }) => void;
}

export interface OpenNewThreadDraftArgs {
  projectId: string;
  adapterId?: string;
  prefill?: string;
}

const SWITCHED_DRAFT_POLL_INTERVAL_MS = 16;
const SWITCHED_DRAFT_POLL_BOUND_MS = 1000;

/**
 * `switchToNewThread()` owns the slot, but right after it resolves the slot
 * can still read as empty for one macrotask (assistant-ui 0.15's `threads`
 * scope, observed after a draft's first send commits it — spec §2.4). Poll
 * until the switched-to draft is observable and settled (`newThreadId` is the
 * active item), checking immediately first so an already-populated slot
 * resolves on the first read. Bounded so a slot that never settles fails
 * loudly instead of hanging.
 */
async function waitForSwitchedDraft(runtimeThreads: OpenNewThreadDraftDeps['runtimeThreads']): Promise<string | null> {
  const deadline = Date.now() + SWITCHED_DRAFT_POLL_BOUND_MS;
  for (;;) {
    const state = runtimeThreads.getState();
    if (state.newThreadId != null && state.newThreadId === state.mainThreadId) {
      return state.newThreadId;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, SWITCHED_DRAFT_POLL_INTERVAL_MS));
  }
}

export async function openNewThreadDraft(args: OpenNewThreadDraftArgs, deps: OpenNewThreadDraftDeps): Promise<void> {
  const { projectId, adapterId, prefill } = args;
  const {
    filterProjectIds,
    clearProjectFilter,
    runtimeThreads,
    setReturnTarget,
    resetNewThreadDraft,
    initializeDraft,
    setText,
    mfToastError,
  } = deps;

  if (filterProjectIds.size > 0 && !filterProjectIds.has(projectId)) {
    clearProjectFilter();
  }

  const preSwitch = runtimeThreads.getState();
  // Skip when the active thread already IS the new-thread slot (a second
  // trigger on the draft being initialized, todo #365) — keep the return
  // target recorded when the draft was first opened rather than overwriting
  // it with the draft itself, which would strand a discard on the draft.
  if (preSwitch.newThreadId == null || preSwitch.newThreadId !== preSwitch.mainThreadId) {
    setReturnTarget(preSwitch.mainThreadId ?? null);
  }

  resetNewThreadDraft(runtimeThreads.getState().newThreadId);
  await runtimeThreads.switchToNewThread();
  const newThreadId = await waitForSwitchedDraft(runtimeThreads);
  if (newThreadId == null) {
    mfToastError('Couldn’t open a new session', {
      description: 'The new session never became active. Try again.',
    });
    return;
  }

  try {
    await initializeDraft({ localId: newThreadId, projectId, adapterId });
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
