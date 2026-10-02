/**
 * Owns the ONE real reveal animation for a streaming text/reasoning part, and
 * freezes its rendered text while a document selection holds it — see
 * `selection-hold.ts`'s module doc for the mechanism this guards against.
 * Split out of `markdown-text.tsx` to keep that file under the 300-line cap.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAui, useAuiState, INTERNAL } from '@assistant-ui/react';
import { useSelectionHold, recheckHeld } from './selection-hold';

// `INTERNAL.useSmooth` is only touched inside this hook (never at module
// scope): `markdown-text.tsx`'s `markdownComponents` export is imported by
// consumers (e.g. `user-directive-renderers.tsx`) that never render
// `MarkdownText` itself, and some of those tests mock `@assistant-ui/react`
// without an `INTERNAL` key — a module-scope access would throw just from
// importing the module.

/** A part shape `useSmooth` accepts — only reached if `s.part` is ever something else while this is mounted, which should never happen (`MarkdownText` only renders for text/reasoning parts). */
const EMPTY_PART: Parameters<typeof INTERNAL.useSmooth>[0] = { type: 'text', text: '', status: { type: 'complete' } };

/**
 * `MarkdownTextPrimitive` (the caller) always runs with `smooth={false}` and
 * just displays whatever `preprocess` returns, verbatim. Doing our OWN,
 * UNCONDITIONALLY-enabled `useSmooth` here (never gated by `held`) is what
 * two bugs an earlier version had turned on (independent review, round 2):
 *  - freezing the LIVE INPUT text instead of the DISPLAYED (already-revealed)
 *    one: engaging the hold jumped the DOM straight from the revealed prefix
 *    to the full live text in one commit — the exact "replace data" collapse
 *    this feature exists to prevent.
 *  - the primitive's OWN internal animator stalling at whatever it had
 *    revealed the moment `smooth` dropped to `false`, so releasing fed it a
 *    now-much-longer target and it retyped from a visibly SHORTER string.
 *    Because our reveal never stops — it stays `smooth: true` here the whole
 *    time, hold or not — `displayedText` has already kept advancing in the
 *    background by the time the hold releases: release never shows less than
 *    was held.
 * `withSmoothContextProvider` (wrapping `MarkdownText` in `markdown-text.tsx`)
 * is reused by `MarkdownTextPrimitive`'s own internal one — the library skips
 * creating a nested provider when it finds an outer one already in the tree —
 * so `.aui-md[data-status]` keeps reporting OUR status, not the now-inert
 * primitive's own (always-disabled) one.
 */
export function useHeldDisplayedText(containerRef: React.RefObject<HTMLDivElement | null>): () => string {
  const held = useSelectionHold(containerRef);
  // Identity for the frozen snapshot is the PART's own object reference, not
  // `s.message.id` — this only needs a part scope (mirrors the vendor's own
  // `useSmooth` discontinuity check, which keys off `useAui().part` the same
  // way) rather than a message scope, so `MarkdownText` still works under a
  // bare `TextMessagePartProvider` with no enclosing message/thread/runtime.
  const aui = useAui();
  const part = useAuiState(() => aui.part);
  const partText = useAuiState((s) => (s.part.type === 'text' || s.part.type === 'reasoning' ? s.part : EMPTY_PART));
  const { text: displayedText } = INTERNAL.useSmooth(partText, true);
  // The captured snapshot for the CURRENT hold streak, if any. `releasedRef`
  // marks a streak that gave up holding mid-way (a part change — see below)
  // so a later call in the SAME streak doesn't recapture a snapshot nobody
  // asked to keep; both reset together whenever `held` itself drops.
  const frozenRef = useRef<{ part: unknown; text: string } | null>(null);
  const releasedRef = useRef(false);

  // Safeguard (independent review round 3, finding 1): `held` only updates
  // on a `selectionchange` event, which WebKit doesn't reliably fire for
  // every programmatic range change (e.g. `removeAllRanges()` after Quote).
  // Re-validate the real DOM selection against this container whenever we
  // ALREADY re-render for our own reasons (new streamed text, a part swap)
  // — catches a hold that should have released even if no such event ever
  // fires again. Only ever releases; never promotes (a real selectionchange
  // is still what starts a hold).
  useEffect(() => {
    if (!held) return;
    const container = containerRef.current;
    if (container) recheckHeld(container);
  }, [held, displayedText, part, containerRef]);

  return useCallback(() => {
    if (!held) {
      frozenRef.current = null;
      releasedRef.current = false;
      return displayedText;
    }
    if (frozenRef.current === null) {
      if (releasedRef.current) {
        // Already gave up holding for this streak — stay live until the
        // registry actually releases (held flips back to false) rather
        // than re-capturing a snapshot nobody asked to keep.
        return displayedText;
      }
      frozenRef.current = { part, text: displayedText };
      return frozenRef.current.text;
    }
    if (frozenRef.current.part !== part) {
      // Part changed while nominally held — a thread switch reusing this
      // DOM container (`ChatThread` isn't keyed per chat; parts render by
      // index). Release instead of re-capturing (independent review round
      // 3, finding 2): re-capturing showed a one-frame flash of the NEW
      // part's (often much shorter, still-settling) text before the stale
      // hold was actually cleared, and held a pointless fresh snapshot
      // besides. Finding 1's safeguard above clears the registry entry
      // itself on the next tick; this just stops freezing immediately.
      frozenRef.current = null;
      releasedRef.current = true;
      return displayedText;
    }
    return frozenRef.current.text;
    // `useCallback`'s only job here is giving `preprocess` a fresh identity
    // whenever `held`/`displayedText`/`part` move — `preprocess` ignores
    // its own argument entirely (we ALWAYS supply our own `displayedText` or
    // the frozen snapshot of it, never the primitive's own raw live text) —
    // `MarkdownTextPrimitive`'s internal `useMemo` only re-evaluates
    // `preprocess` when either it or that raw subscription changes, and the
    // latter can lag several of our OWN reveal ticks behind (it is a
    // completely separate subscription that only moves once per real chunk).
  }, [held, displayedText, part]);
}
