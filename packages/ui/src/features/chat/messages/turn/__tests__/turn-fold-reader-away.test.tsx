// @vitest-environment jsdom
/**
 * #521: on the plain list a turn that ends while the reader reads above the tail stays open until they come back,
 * so its fold does not take away what they read and move them. The rig recorded the move in WKWebView
 * (`R-read-tail-still`: the turn's work folded under the reader and the browser clamped them by 39 px).
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import type { TranscriptScrollController } from '../../../thread/transcript-scroll-context';
import { createFlag } from '../../../thread/scroll-owner-state';
import { TurnFixture, assistant, bash, running, text, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));

const opened = () =>
  screen.queryAllByTestId(/^chat-work-toggle-/).map((header) => header.getAttribute('aria-expanded') === 'true');

const live = [user('Go', 'u1'), assistant([bash('b1', 'ls', running)], 'a1', { running: true })];
const done = [user('Go', 'u1'), assistant([bash('b1', 'ls'), text('Done.')], 'a1')];

function controller(owned: boolean) {
  const pinned = createFlag();
  pinned.set(true);
  const scroll: TranscriptScrollController = {
    owned,
    viewportElement: { current: null },
    isFollowing: () => pinned.get(),
    beginInteraction: () => () => undefined,
    ...(owned ? { pinned } : {}),
  };
  return { scroll, pinned };
}

let roots = 0;
beforeEach(() => {
  useUiPrefs.setState({ finishedWork: 'fold' });
  roots++;
});

describe('a turn that ends while the reader is above the tail', () => {
  it('stays open on the plain list, and folds when the reader comes back', () => {
    const { scroll, pinned } = controller(true);
    const view = render(<TurnFixture rootId={`away-${roots}`} messages={live} scroll={scroll} />);
    expect(opened()).toEqual([true]);
    act(() => pinned.set(false));
    view.rerender(<TurnFixture rootId={`away-${roots}`} messages={done} scroll={scroll} isRunning={false} />);
    expect(opened()).toEqual([true]);
    act(() => pinned.set(true));
    expect(opened()).toEqual([false]);
  });

  it('folds at once when the reader is at the tail', () => {
    const { scroll } = controller(true);
    const view = render(<TurnFixture rootId={`tail-${roots}`} messages={live} scroll={scroll} />);
    view.rerender(<TurnFixture rootId={`tail-${roots}`} messages={done} scroll={scroll} isRunning={false} />);
    expect(opened()).toEqual([false]);
  });

  it('draws a page of finished turns that lands above them folded, never with its steps', () => {
    const { scroll, pinned } = controller(true);
    const view = render(<TurnFixture rootId={`page-${roots}`} messages={live} scroll={scroll} />);
    act(() => pinned.set(false));
    const older = [user('Before', 'u0'), assistant([bash('b0', 'pwd'), bash('b00', 'ls'), text('Here.')], 'a0')];
    // A step drawn and then folded away within the same render leaves only its removal behind.
    const foldedAway: string[] = [];
    const watch = new MutationObserver(() => undefined);
    watch.observe(document.body, { childList: true, subtree: true });
    view.rerender(<TurnFixture rootId={`page-${roots}`} messages={[...older, ...live]} scroll={scroll} />);
    for (const record of watch.takeRecords())
      for (const node of record.removedNodes)
        if (node instanceof HTMLElement && node.dataset.workTurn) foldedAway.push(node.dataset.workTurn);
    watch.disconnect();
    expect(opened()).toEqual([false, true]);
    expect(foldedAway).toEqual([]);
  });

  it('keeps a turn the reader already saw folded folded', () => {
    const { scroll, pinned } = controller(true);
    render(<TurnFixture rootId={`seen-${roots}`} messages={done} scroll={scroll} isRunning={false} />);
    expect(opened()).toEqual([false]);
    act(() => pinned.set(false));
    expect(opened()).toEqual([false]);
  });
});
