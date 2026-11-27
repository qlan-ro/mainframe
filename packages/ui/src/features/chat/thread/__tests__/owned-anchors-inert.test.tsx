// @vitest-environment jsdom
/**
 * Under the plain list's scroll owner, today's prepend anchor and row anchor must write nothing: the browser
 * anchors, and the owner corrects. The same events and calls move `scrollTop` and take an interaction lock
 * when the controller is not the owner's (the control cases).
 */
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EarlierMessages, HISTORY_PREPEND_EVENT } from '../EarlierMessages';
import { TranscriptScrollProvider, type TranscriptScrollController } from '../transcript-scroll-context';
import { useRowAnchor } from '../../messages/turn/use-row-anchor';

const f = vi.hoisted(() => ({ first: 'old', floor: 'old-item' }));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (state: unknown) => unknown) => select({ thread: { messages: [{ id: f.first }] } }),
}));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({
    state: { chatId: 'chat', historyWindow: { hasMore: true, loading: false, floorItemId: f.floor } },
    loadEarlier: vi.fn(),
  }),
}));

let viewport: HTMLDivElement;
let writes: number[];
let rowTop: number;

beforeEach(() => {
  f.first = 'old';
  f.floor = 'old-item';
  writes = [];
  rowTop = 20;
  viewport = document.createElement('div');
  viewport.innerHTML = '<div data-message-id="old">Reading anchor</div>';
  let top = 100;
  Object.defineProperties(viewport, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 2000 },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        writes.push(value);
        top = value;
      },
    },
  });
  viewport.querySelector<HTMLElement>('[data-message-id]')!.getBoundingClientRect = () =>
    ({ top: rowTop, bottom: rowTop + 40 }) as DOMRect;
  document.body.append(viewport);
});
afterEach(() => viewport.remove());

function controller(owned: boolean) {
  const release = vi.fn();
  const beginInteraction = vi.fn(() => release);
  const value: TranscriptScrollController = {
    owned: owned || undefined,
    viewportElement: { current: viewport },
    isFollowing: () => false,
    beginInteraction,
  };
  return { value, beginInteraction };
}

describe('the prepend anchor', () => {
  const prepend = (owned: boolean) => {
    const { value, beginInteraction } = controller(owned);
    const ui = () => (
      <TranscriptScrollProvider value={value}>
        <EarlierMessages />
      </TranscriptScrollProvider>
    );
    const view = render(ui());
    act(() => window.dispatchEvent(new CustomEvent(HISTORY_PREPEND_EVENT, { detail: 'chat' })));
    rowTop = 320;
    f.first = 'earlier';
    f.floor = 'earlier-item';
    view.rerender(ui());
    return { beginInteraction };
  };

  it('holds the reader and takes the interaction lock when the owner is not in charge (control)', () => {
    const { beginInteraction } = prepend(false);
    expect(beginInteraction).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([400]);
  });

  it('writes no scrollTop and takes no lock under the owner', () => {
    const { beginInteraction } = prepend(true);
    expect(beginInteraction).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe('the row anchor', () => {
  const toggle = (owned: boolean) => {
    const { value, beginInteraction } = controller(owned);
    const row = document.createElement('div');
    viewport.append(row);
    row.getBoundingClientRect = () => ({ top: rowTop, bottom: rowTop + 40 }) as DOMRect;
    const hook = renderHook(({ open }) => useRowAnchor(open), {
      initialProps: { open: false },
      wrapper: ({ children }) => <TranscriptScrollProvider value={value}>{children}</TranscriptScrollProvider>,
    });
    hook.result.current.rowRef.current = row as HTMLDivElement;
    act(() => hook.result.current.beforeToggle());
    rowTop = 260;
    hook.rerender({ open: true });
    return { beginInteraction };
  };

  it('keeps the row in place and takes the lock when the owner is not in charge (control)', () => {
    const { beginInteraction } = toggle(false);
    expect(beginInteraction).toHaveBeenCalledTimes(1);
    expect(writes.length).toBeGreaterThan(0);
  });

  it('does nothing under the owner, for a click and for an automatic fold', () => {
    const { beginInteraction } = toggle(true);
    expect(beginInteraction).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});
