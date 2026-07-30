/**
 * useSessionReferences — per-thread map of `@session[label]` → absolute
 * transcript path, recorded when a session is picked and read once at send
 * (todo #240).
 *
 * Keyed by the aui thread item id, exactly like `useComposerSegments`: the
 * draft and the send path must agree on the key or every reference line is
 * silently dropped. In-memory only, no `persist` — a reference is draft state,
 * and the composed message body is the durable artifact.
 *
 * Same `__LOCALID_*` caveat as the segment store: assistant-ui reuses one
 * new-thread slot until the first send, so an abandoned draft's references
 * would come back on the next New. `resetNewThreadDraft` clears this store for
 * that reason.
 *
 * Labels, not chat ids, are the key: the composed token carries the label, and
 * the label is what survives into the sent body and back out of a reload.
 */
import { create } from 'zustand';

const EMPTY_REFERENCES: Record<string, string> = {};

interface SessionReferencesState {
  /** threadId → label → absolute transcript path. */
  byThread: Record<string, Record<string, string>>;
  record: (threadId: string, label: string, path: string) => void;
  clear: (threadId: string) => void;
}

export const useSessionReferences = create<SessionReferencesState>((set) => ({
  byThread: {},
  record: (threadId, label, path) =>
    set((s) => ({
      byThread: { ...s.byThread, [threadId]: { ...(s.byThread[threadId] ?? EMPTY_REFERENCES), [label]: path } },
    })),
  clear: (threadId) => set((s) => ({ byThread: { ...s.byThread, [threadId]: EMPTY_REFERENCES } })),
}));

/** The draft's references as the `Map` shape `prependSessionReferences` takes. */
export function sessionReferencesFor(threadId: string): ReadonlyMap<string, string> {
  return new Map(Object.entries(useSessionReferences.getState().byThread[threadId] ?? EMPTY_REFERENCES));
}
