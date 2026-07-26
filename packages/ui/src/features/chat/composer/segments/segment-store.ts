/**
 * useComposerSegments — per-thread segment store (spec §2.2 store lifecycle).
 *
 * In-memory only, keyed by the aui thread item id (the same key the
 * controller uses; stays `__LOCALID_*` for a draft's life). No `persist`, no
 * `daemonScopedKey` — segments do not survive an app restart, and a stale
 * entry for an ARCHIVED thread is unreachable memory, not a leak to guard.
 *
 * The `__LOCALID_*` draft key is the exception: assistant-ui reuses one slot
 * for every New until the first send, so an abandoned draft's segments ARE
 * reachable — they return as pills on the next New, in whatever project that
 * one targets. `resetNewThreadDraft` clears this store for that reason.
 */
import { create } from 'zustand';
import { appendQuote, dismissQuote, updateSegmentText, type Composition } from './segment-model';

const EMPTY_COMPOSITION: Composition = { committed: [], liveQuote: null };

interface ComposerSegmentsState {
  byThread: Record<string, Composition>;
  append: (threadId: string, args: { quote: string; liveText: string }) => void;
  dismiss: (threadId: string, segmentId: string) => void;
  updateText: (threadId: string, segmentId: string, text: string) => void;
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
  updateText: (threadId, segmentId, text) =>
    set((s) => {
      const current = s.byThread[threadId];
      if (!current) return s;
      return { byThread: { ...s.byThread, [threadId]: updateSegmentText(current, segmentId, text) } };
    }),
  clear: (threadId) => set((s) => ({ byThread: { ...s.byThread, [threadId]: EMPTY_COMPOSITION } })),
}));
