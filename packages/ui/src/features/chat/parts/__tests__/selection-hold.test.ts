/**
 * `selection-hold.ts`'s own registry behavior — mount/unmount bookkeeping and
 * the independent review round-2 finding-4 performance contract. The perf
 * assertion counts `Range.intersectsNode` invocations (the expensive
 * operation the review flagged), not wall-clock time, so this stays a fast,
 * deterministic unit test rather than a benchmark.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useSelectionHold, recheckHeld } from '../selection-hold';

function selectWithin(el: Element, needle: string): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const idx = node.data.indexOf(needle);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return;
    }
  }
  throw new Error(`selectWithin: "${needle}" not found`);
}

function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
}

/** Mounts a `[data-text-part]` container with the given text and wires `useSelectionHold` to it. */
function mountPart(text: string) {
  const el = document.createElement('div');
  el.setAttribute('data-text-part', '');
  el.textContent = text;
  document.body.appendChild(el);
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = el;
  const hook = renderHook(() => useSelectionHold(ref));
  return { el, hook };
}

describe('selection-hold.ts registry', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('unmounting a held part cleans up its registration — no leaked update on a later selectionchange (independent review round 2)', () => {
    const { el, hook } = mountPart('Hello wonderful world');
    act(() => selectWithin(el, 'wonderful'));
    expect(hook.result.current).toBe(true);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hook.unmount();

    // A later selectionchange must not try to update the now-unmounted
    // hook's state — React logs an act()/unmounted-component warning via
    // console.error if the cleanup had leaked the registration.
    expect(() => act(() => clearSelection())).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('mounting N parts with an existing, non-intersecting selection calls Range.intersectsNode O(N) times, not O(N^2) (independent review round 2, finding 4)', () => {
    // An unrelated, already-active selection elsewhere in the document — the
    // OLD `recomputeAll()` design re-evaluated EVERY already-registered
    // entry (via `intersectsNode`) on EVERY new mount, so N sequential
    // mounts cost 1+2+...+N = O(N^2) total calls. The fix only ever
    // evaluates the ONE entry being mounted: exactly N calls for N mounts.
    const other = document.createElement('div');
    other.textContent = 'unrelated text elsewhere';
    document.body.appendChild(other);
    const range = document.createRange();
    range.setStart(other.firstChild!, 0);
    range.setEnd(other.firstChild!, 'unrelated'.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    const intersectsNodeSpy = vi.spyOn(Range.prototype, 'intersectsNode');

    const N = 50;
    const hooks: ReturnType<typeof mountPart>['hook'][] = [];
    for (let i = 0; i < N; i++) {
      const { hook } = mountPart(`part number ${i}`);
      hooks.push(hook);
    }

    for (const hook of hooks) {
      expect(hook.result.current).toBe(false); // none of the N parts intersect
    }
    // O(N): one evaluation per mount. The quadratic bug would land at
    // N*(N+1)/2 = 1275 for N=50 — comfortably clear of a generous O(N) bound.
    expect(intersectsNodeSpy.mock.calls.length).toBeLessThanOrEqual(N);
  });

  it('recheckHeld releases a held entry whose selection is gone, without waiting for a selectionchange event (independent review round 3, finding 1)', () => {
    // `held` only ever updates in response to a `selectionchange` event —
    // WebKit doesn't reliably fire one for every programmatic range change
    // (e.g. `removeAllRanges()` after a Quote action), so a hold could
    // otherwise stay stuck forever. `recheckHeld` is the safeguard a
    // consumer calls when it re-renders for its own reasons; it must release
    // on its own, with no event in between.
    const { el, hook } = mountPart('Hello wonderful world');
    act(() => selectWithin(el, 'wonderful'));
    expect(hook.result.current).toBe(true);

    // Clear the selection WITHOUT dispatching `selectionchange` — the exact
    // "missed event" scenario.
    window.getSelection()?.removeAllRanges();
    expect(hook.result.current).toBe(true); // still (wrongly) held — no event ran

    act(() => recheckHeld(el));
    expect(hook.result.current).toBe(false);
  });

  it('recheckHeld is a no-op when the held selection is still live and still intersects the container', () => {
    // Never promotes, and never releases a hold that is still legitimate —
    // only a real `selectionchange` (or an actual loss of intersection)
    // should ever end a hold that's still current.
    const { el, hook } = mountPart('Hello wonderful world');
    act(() => selectWithin(el, 'wonderful'));
    expect(hook.result.current).toBe(true);

    act(() => recheckHeld(el));
    expect(hook.result.current).toBe(true);
  });
});
