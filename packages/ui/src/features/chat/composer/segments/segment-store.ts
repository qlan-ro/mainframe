/**
 * useComposerSegments — per-thread segment store (spec §2.2 store lifecycle).
 *
 * In-memory only, keyed by the aui thread item id (the same key the
 * controller uses; stays `__LOCALID_*` for a draft's life). No `persist`, no
 * `daemonScopedKey` — segments do not survive an app restart, and a stale
 * entry for an archived thread is unreachable memory, not a leak to guard.
 */
import { create } from 'zustand';
import { appendQuote, dismissQuote, type Composition } from './segment-model';

const EMPTY_COMPOSITION: Composition = { committed: [], liveQuote: null };

interface ComposerSegmentsState {
  byThread: Record<string, Composition>;
  append: (threadId: string, args: { quote: string; liveText: string }) => void;
  dismiss: (threadId: string, segmentId: string) => void;
  clear: (threadId: string) => void;
}

export const useComposerSegments = create<ComposerSegmentsState>((set) => ({
  byThread: {},
  append: (threadId, args) =>
    set((s) => ({
      byThread: { ...s.byThread, [threadId]: appendQuote(s.byThread[threadId] ?? EMPTY_COMPOSITION, args) },
    })),
  dismiss: (threadId, segmentId) =>
    set((s) => {
      const current = s.byThread[threadId];
      if (!current) return s;
      return { byThread: { ...s.byThread, [threadId]: dismissQuote(current, segmentId) } };
    }),
  clear: (threadId) => set((s) => ({ byThread: { ...s.byThread, [threadId]: EMPTY_COMPOSITION } })),
}));

/** The given thread's composition (the stable empty composition when unknown). */
export function selectComposerSegment(threadId: string): Composition {
  return useComposerSegments.getState().byThread[threadId] ?? EMPTY_COMPOSITION;
}
