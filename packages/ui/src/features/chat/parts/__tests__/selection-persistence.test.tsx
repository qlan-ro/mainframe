/**
 * Reproduces "my selection was gone" (product bug report, long-chat-and-
 * streaming follow-up): a non-collapsed DOM `Range` made in the transcript
 * must survive later streaming/re-renders elsewhere in the thread. Built the
 * same way as `streaming-smooth.test.tsx` — real `convertAcpItems` →
 * `ChatThreadState` → `projectChatThreadMessages`, and (unlike that file) our
 * REAL `MarkdownText` wrapper rather than the bare primitive, so the hold/
 * release fix it carries (`selection-hold.ts`) is actually exercised — so a
 * regression in either the conversion/identity layer or the hold mechanism
 * (not just this file's fixtures) fails here too.
 *
 * Three cases, matching the independent review's repro:
 *  (a) selection in an OLDER settled message while a LATER message streams,
 *      also across a staged-replay publish and a meta-only (turn-duration)
 *      upsert on that older message;
 *  (b) selection in a COMPLETED paragraph of the message that IS streaming,
 *      while a LATER paragraph in the SAME message grows;
 *  (c) selection inside the paragraph that is itself STILL GROWING — the
 *      hold/release contract this file's second describe block covers.
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
  shownText,
} from './selection-persistence-support';

describe('a transcript selection survives streaming and re-renders elsewhere (product bug repro)', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
  });
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
  });

  describe('(a) selection in an OLDER settled message while a LATER message streams', () => {
    it('survives a later message growing its streamed text', async () => {
      const older = textItem('m-older', 'The quick brown fox jumps.', { origin: 'replay' });
      const laterStart = textItem('m-later', 'Starting up', { streaming: true, origin: 'live' });
      const r = render(<Harness isRunning messages={messagesFromItems([older, laterStart], 'running')} />);
      await flush();

      const olderRoot = document.querySelectorAll('[data-testid="msg"]')[0]!;
      selectSubstring(olderRoot, 'brown fox');

      const laterGrown = textItem('m-later', 'Starting up and continuing further along', {
        streaming: true,
        origin: 'live',
      });
      r.rerender(<Harness isRunning messages={messagesFromItems([older, laterGrown], 'running')} />);
      await flush();
      tick(500);
      await flush();

      assertSelectionSurvived('brown fox');
    });

    it('survives a staged-replay publish (a second full replay) touching only the later message', async () => {
      const older = textItem('m-older', 'The quick brown fox jumps.', { origin: 'replay' });
      const later = textItem('m-later', 'First reply.', { origin: 'replay' });
      const r = render(<Harness isRunning={false} messages={messagesFromItems([older, later], 'idle')} />);
      await flush();

      const olderRoot = document.querySelectorAll('[data-testid="msg"]')[0]!;
      selectSubstring(olderRoot, 'brown fox');

      // A fresh full replay re-creates the whole item set — `older` is a
      // structurally-identical but newly-allocated item object, exactly how a
      // staged-replay publish rebuilds its accumulator from scratch.
      const olderReplayed = textItem('m-older', 'The quick brown fox jumps.', { origin: 'replay' });
      const laterChanged = textItem('m-later', 'First reply, now longer.', { origin: 'replay' });
      r.rerender(<Harness isRunning={false} messages={messagesFromItems([olderReplayed, laterChanged], 'idle')} />);
      await flush();

      assertSelectionSurvived('brown fox');
    });

    it('survives a meta-only upsert (turn duration) on the older message itself', async () => {
      const older = textItem('m-older', 'The quick brown fox jumps.', { origin: 'replay' });
      const later = textItem('m-later', 'First reply.', { origin: 'replay' });
      const r = render(<Harness isRunning={false} messages={messagesFromItems([older, later], 'idle')} />);
      await flush();

      const olderRoot = document.querySelectorAll('[data-testid="msg"]')[0]!;
      selectSubstring(olderRoot, 'brown fox');

      // Same text, same id — only a trailing turn-duration meta field lands
      // on the OLDER message's own item (e.g. a late `message_meta` frame).
      const olderWithTiming = textItem('m-older', 'The quick brown fox jumps.', {
        origin: 'replay',
        extra: { messageMeta: { turnDurationMs: 4200 } },
      });
      r.rerender(<Harness isRunning={false} messages={messagesFromItems([olderWithTiming, later], 'idle')} />);
      await flush();

      assertSelectionSurvived('brown fox');
    });
  });

  describe('(b) selection in a COMPLETED paragraph of the streaming message, while a LATER paragraph grows', () => {
    it('survives the later paragraph growing', async () => {
      const first = 'Paragraph one is done.';
      const items = [textItem('m1', `${first}\n\nParagraph two is sti`, { streaming: true, origin: 'live' })];
      const r = render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);
      tick(1000);
      await flush();

      selectSubstring(document, 'one is done');

      const grown = [
        textItem('m1', `${first}\n\nParagraph two is still growing longer now`, { streaming: true, origin: 'live' }),
      ];
      r.rerender(<Harness isRunning messages={messagesFromItems(grown, 'running')} />);
      await flush();
      tick(500);
      await flush();

      assertSelectionSurvived('one is done');
    });
  });

  describe('(c) selection inside the paragraph that is itself STILL GROWING', () => {
    it('the hold keeps the selection alive through a reveal tick instead of letting it collapse', async () => {
      const items = [textItem('m1', 'Hello wonderful world', { streaming: true, origin: 'live' })];
      const r = render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);
      tick(1000);
      await flush();

      selectSubstring(document, 'wonderful');
      assertSelectionSurvived('wonderful');

      // A new chunk arrives. WITHOUT the hold, react-markdown would replace
      // the SAME text node's whole `data`, which the DOM "replace data"
      // algorithm uses to collapse any live Range boundary inside that node
      // (the mechanism behind the product bug report) — the hold keeps this
      // part's rendered text pinned at its last snapshot instead.
      const more = [
        textItem('m1', 'Hello wonderful world and even more text arrives', { streaming: true, origin: 'live' }),
      ];
      r.rerender(<Harness isRunning messages={messagesFromItems(more, 'running')} />);
      await flush();
      tick(500);
      await flush();

      assertSelectionSurvived('wonderful');
      // The part's OWN rendered text is still the frozen snapshot — proof
      // the hold, not luck, is what kept the Range attached.
      expect(shownText()).toBe('Hello wonderful world');
    });
  });
});

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

  it('no stale text survives the turn completing while held — it ends on the final text even without the selection clearing', async () => {
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

    // The selection was never cleared — only the message completing forced
    // the release — and the part still lands on the FINAL text, not the
    // snapshot frozen at selection time.
    expect(shownText()).toBe('Hello wonderful world, the end.');
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
