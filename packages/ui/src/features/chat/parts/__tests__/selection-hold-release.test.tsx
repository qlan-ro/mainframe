/**
 * The hold/release contract itself (split out of `selection-persistence.test.tsx`
 * once that file crossed 300 lines): what the frozen snapshot guarantees on
 * release, on the part completing while held, and across a thread switch —
 * the independent review's round-2 findings 2, 3, and 5.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  Harness,
  textItem,
  messagesFromItems,
  tick,
  flush,
  selectSubstring,
  assertSelectionSurvived,
  clearSelection,
  clearSelectionWithoutEvent,
  shownText,
} from './selection-persistence-support';
import * as selectionHold from '../selection-hold';

describe('hold/release (independent review item 2: the general growing-text guarantee)', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
  });
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
  });

  it('release (selection clears) catches up to the final text', async () => {
    const items = [textItem('m1', 'Hello wonderful world', { streaming: true, origin: 'live' })];
    const r = render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);
    tick(1000);
    await flush();

    selectSubstring(document, 'wonderful');
    const grown = [
      textItem('m1', 'Hello wonderful world and even more text arrives', { streaming: true, origin: 'live' }),
    ];
    r.rerender(<Harness isRunning messages={messagesFromItems(grown, 'running')} />);
    await flush();
    tick(500);
    await flush();
    expect(shownText()).toBe('Hello wonderful world'); // still held, frozen

    clearSelection();
    await flush();
    tick(1000); // the reveal resumes catching up from the held snapshot
    await flush();
    expect(shownText()).toBe('Hello wonderful world and even more text arrives');
  });

  it('the shown text never shrinks while still held, even well after the hold engaged (independent review round 2, finding 2)', async () => {
    // Reproduces the review's probe exactly: select WHILE a growth tick is
    // still lagging (finding 1's window), then let more time pass with
    // NOTHING else changing (no new chunk, selection untouched). An earlier,
    // buggy version jumped to the full live text the instant the hold
    // engaged, then — because the primitive's OWN internal animator had
    // frozen `smooth={false}` without ever updating ITS OWN displayed-text
    // state — silently reverted back down to the much shorter pre-growth
    // value on the very next unrelated render, before retyping from there.
    const items = [textItem('m1', 'Hello wonderful world', { streaming: true, origin: 'live' })];
    const r = render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);
    tick(1000);
    await flush();

    const grownText = 'Hello wonderful world and even more text keeps going for a good while longer now';
    const grown = [textItem('m1', grownText, { streaming: true, origin: 'live' })];
    r.rerender(<Harness isRunning messages={messagesFromItems(grown, 'running')} />);
    await flush();
    tick(20); // still lagging — finding 1's exact window
    await flush();

    selectSubstring(document, 'wonderful');
    await flush();
    const heldLength = shownText().length;
    expect(heldLength).toBeGreaterThan(0);

    // Nothing else changes — no new chunk, selection untouched — just time
    // passing while still held.
    tick(500);
    await flush();
    expect(shownText().length).toBeGreaterThanOrEqual(heldLength); // must never dip

    clearSelection();
    await flush();
    tick(2000);
    await flush();
    expect(shownText()).toBe(grownText);
  });

  it('completion while held keeps the selection; releasing afterwards shows the final text (independent review round 2, finding 3)', async () => {
    // Product decision (round 2): forcing a release the instant a part
    // completes rewrites the node out from under the user — you could never
    // quote from a reply that finishes while its text is selected.
    // `selectionchange` is the ONLY release trigger now, including through
    // completion/cancel/incomplete; the final text is still guaranteed
    // (finding 2) once the user's own selection change eventually releases it.
    const items = [textItem('m1', 'Hello wonderful world', { streaming: true, origin: 'live' })];
    const r = render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);
    tick(1000);
    await flush();

    selectSubstring(document, 'wonderful');
    const final = [textItem('m1', 'Hello wonderful world, the end.', { origin: 'live' })];
    r.rerender(<Harness isRunning={false} messages={messagesFromItems(final, 'idle')} />);
    await flush();
    tick(1000);
    await flush();

    // Completion alone must NOT have released the hold — the selection is
    // still exactly what was selected, and the part is still showing the
    // (possibly stale) snapshot, not the final text.
    assertSelectionSurvived('wonderful');
    expect(shownText()).toBe('Hello wonderful world');

    clearSelection();
    await flush();
    tick(1000);
    await flush();
    expect(shownText()).toBe('Hello wonderful world, the end.');
  });

  it("a thread switch while held never shows the OLD chat's frozen text, nor flashes a fresh re-hold (independent review round 2 finding 5, round 3 finding 2)", async () => {
    // `ChatThread` isn't keyed per chat and parts render by index, so the
    // SAME `MarkdownText` instance — and hence the SAME DOM container the
    // hold registration tracks — can be reused across a thread switch. A
    // stale `held` registration surviving the switch must not let a frozen
    // snapshot captured for chat A's part leak into chat B's render.
    const items = [textItem('m1', 'Hello wonderful world', { streaming: true, origin: 'live' })];
    const r = render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);
    tick(1000);
    await flush();

    selectSubstring(document, 'wonderful');
    assertSelectionSurvived('wonderful');

    // A different chat's message renders at the SAME array position —
    // simulating the instance reuse a thread switch can cause, without an
    // unmount (the component never has a reason to unmount: `ChatThread`
    // keys by index, not by chat or message id).
    const differentChat = [textItem('m-other-chat', 'Totally unrelated content', { origin: 'replay' })];
    r.rerender(<Harness isRunning={false} messages={messagesFromItems(differentChat, 'idle')} />);
    await flush();

    // Immediately, with no settling tick: a part change releases rather
    // than re-capturing (independent review round 3, finding 2) — an
    // earlier version re-captured a fresh snapshot of the NEW part's own
    // still-settling text, flashing a partial frame before eventually
    // correcting on a later render. There should be nothing left of the
    // old chat's text, and no need to wait for it to go away.
    expect(shownText()).not.toContain('wonderful');
    expect(shownText()).toBe('Totally unrelated content');

    tick(500);
    await flush();

    expect(shownText()).not.toContain('wonderful');
    expect(shownText()).toBe('Totally unrelated content');
  });

  it('releases a stale hold on its own once something re-renders, even if selectionchange never fires again (independent review round 3, finding 1)', async () => {
    // `held` only updates in response to a `selectionchange` event. WebKit is
    // unreliable about firing it for every programmatic range change — most
    // notably `removeAllRanges()` right after a Quote action — so without a
    // safeguard a part could stay frozen forever once nothing else happens to
    // select again. `recheckHeld` is the safeguard: a consumer that already
    // re-renders for its own reasons gets a free recheck of the real DOM
    // selection against its own container, with no event required.
    //
    // jsdom (unlike WebKit's actual bug) also eventually fires `selectionchange`
    // for a programmatic `removeAllRanges()` on its own — asynchronously, via
    // an internal dispatch path (`DocumentImpl._dispatch`) that bypasses even
    // `EventTarget.prototype.dispatchEvent`, so it can't be suppressed from
    // test code. That means a `shownText()` assertion after advancing timers
    // can't tell OUR safeguard apart from jsdom's own delayed notification —
    // `selection-hold.test.ts` already covers `recheckHeld`'s release logic in
    // isolation, with no timers involved at all. What this test adds is the
    // WIRING: that a part which re-renders after a missed clear calls
    // `recheckHeld` for its OWN container, not just on some unrelated timer.
    const recheckHeldSpy = vi.spyOn(selectionHold, 'recheckHeld');
    try {
      const items = [textItem('m1', 'Hello wonderful world', { streaming: true, origin: 'live' })];
      const r = render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);
      tick(1000);
      await flush();

      selectSubstring(document, 'wonderful');
      assertSelectionSurvived('wonderful');
      expect(shownText()).toBe('Hello wonderful world');
      const container = document.querySelector('[data-text-part]');
      expect(container).not.toBeNull();

      clearSelectionWithoutEvent();
      recheckHeldSpy.mockClear();

      const grown = [
        textItem('m1', 'Hello wonderful world and it just keeps going', { streaming: true, origin: 'live' }),
      ];
      r.rerender(<Harness isRunning messages={messagesFromItems(grown, 'running')} />);
      await flush();

      expect(recheckHeldSpy).toHaveBeenCalledWith(container);
    } finally {
      recheckHeldSpy.mockRestore();
    }
  });

  it('only the selected part is held — a second, unselected streaming part keeps revealing live', async () => {
    const selected = textItem('m1', 'Hello wonderful world', { streaming: true, origin: 'live' });
    const other = { ...textItem('m2', 'Elsewhere growing', { streaming: true, origin: 'live' }) };
    const r = render(<Harness isRunning messages={messagesFromItems([selected, other], 'running')} />);
    tick(1000);
    await flush();

    selectSubstring(document, 'wonderful');
    const grownBoth = [
      textItem('m1', 'Hello wonderful world and even more text arrives', { streaming: true, origin: 'live' }),
      textItem('m2', 'Elsewhere growing longer too', { streaming: true, origin: 'live' }),
    ];
    r.rerender(<Harness isRunning messages={messagesFromItems(grownBoth, 'running')} />);
    await flush();
    tick(500);
    await flush();

    const texts = Array.from(document.querySelectorAll('[data-status]')).map((el) => el.textContent ?? '');
    expect(texts[0]).toBe('Hello wonderful world'); // held
    expect(texts[1]).toBe('Elsewhere growing longer too'); // unrelated — kept rendering live
  });
});
