// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitUserSent } from '../../controller/user-sent';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import { useScrollOwner } from '../use-scroll-owner';

let resize: () => void = () => undefined;
class FakeResizeObserver {
  constructor(callback: () => void) {
    resize = callback;
  }
  observe() {}
  disconnect() {}
}

/** The layout the test drives: a viewport 500 high over content `height` high. */
const layout = { height: 2000, top: 0 };
let owner: ReturnType<typeof useScrollOwner>;
let viewport: HTMLElement;
let scrollBy: ReturnType<typeof vi.fn>;
let row: HTMLElement;
let rowTop = 100;

function Harness() {
  owner = useScrollOwner('thread', 'chat');
  return (
    <div ref={owner.setViewport} data-testid="viewport" tabIndex={-1}>
      <div ref={owner.setContent} data-testid="content">
        <p data-testid="row">Read</p>
        <button aria-expanded="false" data-testid="trigger" />
      </div>
    </div>
  );
}

const originals: PropertyDescriptorMap = {};
const DRIVEN = {
  clientHeight: { get: () => 500, configurable: true },
  scrollHeight: { get: () => layout.height, configurable: true },
  scrollTop: {
    get: () => layout.top,
    set: (value: number) => {
      layout.top = Math.max(0, Math.min(layout.height - 500, value));
    },
    configurable: true,
  },
};

function mount() {
  scrollBy = vi.fn();
  const view = render(<Harness />);
  viewport = view.getByTestId('viewport');
  row = view.getByTestId('row');
  viewport.scrollBy = scrollBy as unknown as typeof viewport.scrollBy;
  viewport.getBoundingClientRect = () => ({ top: 0, left: 0, width: 800, height: 500 }) as DOMRect;
  view.getByTestId('content').getBoundingClientRect = () => ({ top: -layout.top, left: 0, width: 800 }) as DOMRect;
  row.getBoundingClientRect = () => ({ top: rowTop - layout.top, left: 0, width: 800 }) as DOMRect;
  document.elementFromPoint = () => row;
  return view;
}

const grow = (by: number) => {
  layout.height += by;
  act(() => resize());
};
const following = () => owner.controller.isFollowing();

beforeEach(() => {
  for (const name of Object.keys(DRIVEN))
    originals[name] = Object.getOwnPropertyDescriptor(Element.prototype, name) ?? {
      value: undefined,
      configurable: true,
    };
  Object.defineProperties(Element.prototype, DRIVEN);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  layout.height = 2000;
  layout.top = 0;
  rowTop = 100;
});
afterEach(() => {
  Object.defineProperties(Element.prototype, originals);
  vi.unstubAllGlobals();
});

describe('follow', () => {
  it('positions at the tail when it mounts and follows growth in the resize callback', () => {
    mount();
    expect(layout.top).toBe(1500);
    grow(300);
    expect(layout.top).toBe(1800);
  });

  it('stops following when the reader wheels up, and holds the place', () => {
    mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 1400;
    grow(300);
    expect(layout.top).toBe(1400);
    expect(following()).toBe(false);
  });

  it('takes follow back only when downward input reaches the bottom', () => {
    mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 1400;
    fireEvent.scroll(viewport);
    layout.top = 1500;
    fireEvent.scroll(viewport);
    expect(following()).toBe(false);
    fireEvent.wheel(viewport, { deltaY: 40 });
    layout.top = 1500;
    fireEvent.scroll(viewport);
    grow(100);
    expect(layout.top).toBe(1600);
  });

  it('re-engages on downward input when the reader is already at the bottom', () => {
    mount();
    fireEvent.click(viewport.querySelector('[data-testid="trigger"]')!);
    grow(100);
    expect(layout.top).toBe(1500);
    layout.top = 1600;
    fireEvent.wheel(viewport, { deltaY: 40 });
    grow(100);
    expect(layout.top).toBe(1700);
  });

  it('the End key and the jump button follow again', () => {
    mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 900;
    fireEvent.keyDown(viewport, { key: 'End' });
    expect(layout.top).toBe(1500);
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 900;
    act(() => owner.pinToBottom());
    grow(100);
    expect(layout.top).toBe(1600);
  });

  it('the user’s own send follows again (#980)', () => {
    mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 900;
    act(() => emitUserSent(['thread']));
    grow(100);
    expect(layout.top).toBe(1600);
  });

  it('typing in a field is not scroll input', () => {
    const view = mount();
    const field = document.createElement('textarea');
    viewport.append(field);
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(following()).toBe(true);
    view.unmount();
  });

  it('stops following when the reader opens a row, and when a jump to a row starts', () => {
    mount();
    fireEvent.click(viewport.querySelector('[data-testid="trigger"]')!);
    grow(100);
    expect(layout.top).toBe(1500);
    act(() => owner.pinToBottom());
    act(() => void window.dispatchEvent(new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId: 'chat' } })));
    grow(100);
    expect(layout.top).toBe(1600);
    act(() => owner.pinToBottom());
    act(() => void window.dispatchEvent(new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId: 'other' } })));
    grow(100);
    expect(layout.top).toBe(1800);
  });

  it('stops following when something else scrolls the transcript up (Find, a jump)', () => {
    mount();
    layout.top = 300;
    fireEvent.scroll(viewport);
    grow(200);
    expect(layout.top).toBe(300);
  });

  it('keeps following when only the content grew before the scroll event arrives', () => {
    mount();
    layout.height += 200;
    fireEvent.scroll(viewport);
    grow(0);
    expect(layout.top).toBe(1700);
  });
});

describe('a page above a reader near the top', () => {
  const readNearTop = () => {
    mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 22;
    rowTop = 400;
  };
  const landPage = (height: number, held: boolean) => {
    act(() => owner.controller.beforePrepend?.());
    layout.height += height;
    rowTop += height;
    if (held) layout.top += height;
    act(() => resize());
  };

  it('adds the shift the browser did not apply, relatively (an absolute write drops wheel input in flight)', () => {
    readNearTop();
    landPage(840, false);
    expect(scrollBy).toHaveBeenCalledWith({ top: 840, behavior: 'instant' });
  });

  it('does nothing when the browser held the reader', () => {
    readNearTop();
    landPage(840, true);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does nothing while following, and far from the top', () => {
    mount();
    landPage(840, false);
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 1200;
    landPage(840, false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('re-anchors a slice of the opening window the same way', () => {
    readNearTop();
    act(() => owner.controller.beforePrepend?.());
    layout.height += 300;
    rowTop += 300;
    act(() => resize());
    expect(scrollBy).toHaveBeenCalledWith({ top: 300, behavior: 'instant' });
  });

  it('answers the history-prepend event for its own chat only', () => {
    readNearTop();
    act(() => void window.dispatchEvent(new CustomEvent('mainframe:history-prepend', { detail: 'other' })));
    layout.height += 500;
    rowTop += 500;
    act(() => resize());
    expect(scrollBy).not.toHaveBeenCalled();
    act(() => void window.dispatchEvent(new CustomEvent('mainframe:history-prepend', { detail: 'chat' })));
    layout.height += 500;
    rowTop += 500;
    act(() => resize());
    expect(scrollBy).toHaveBeenCalledWith({ top: 500, behavior: 'instant' });
  });
});
