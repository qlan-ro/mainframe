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
 *      hold/release contract `selection-hold-release.test.tsx` covers fully.
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

    it('selecting WHILE the reveal still lags behind a just-grown live text does not collapse (independent review round 2, finding 1)', async () => {
      // `preprocess` must freeze the DISPLAYED (already-revealed) text, not
      // the live INPUT: freezing the input meant engaging the hold right
      // after a growth tick — before the reveal caught up to it — jumped the
      // DOM straight from the revealed prefix to the full (longer) live
      // text in one commit, replacing the WHOLE text node's data even
      // though the selected substring itself never moved.
      const items = [textItem('m1', 'Hello wonderful world', { streaming: true, origin: 'live' })];
      const r = render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);
      tick(1000); // fully reveal the base text first
      await flush();
      expect(shownText()).toBe('Hello wonderful world');

      const grownText = 'Hello wonderful world and even more text arrives';
      const grown = [textItem('m1', grownText, { streaming: true, origin: 'live' })];
      r.rerender(<Harness isRunning messages={messagesFromItems(grown, 'running')} />);
      await flush();
      tick(20); // short — the reveal has NOT caught up to the new text yet
      await flush();
      expect(shownText().length).toBeLessThan(grownText.length); // still lagging, confirms the repro window is real

      selectSubstring(document, 'wonderful');
      await flush(); // let the hold's own state update actually commit
      assertSelectionSurvived('wonderful');
    });
  });
});
