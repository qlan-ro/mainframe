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

function Harness({ thread = 'thread', away = false }: { thread?: string; away?: boolean }) {
  owner = useScrollOwner(thread, 'chat', { away });
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

let frames: (FrameRequestCallback | null)[] = [];
const runFrame = () => act(() => frames.splice(0).forEach((frame) => frame?.(0)));

const grow = (by: number) => {
  layout.height += by;
  act(() => resize());
};
const following = () => owner.controller.isFollowing();

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    if (id > 0 && id <= frames.length) frames[id - 1] = null;
  });
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

describe('what counts as the reader taking over', () => {
  const closed = () => viewport.querySelector<HTMLElement>('[data-testid="trigger"]')!;

  it('collapsing an open row does not stop follow', () => {
    mount();
    closed().setAttribute('aria-expanded', 'true');
    fireEvent.click(closed());
    grow(100);
    expect(layout.top).toBe(1600);
  });

  it('a menu trigger does not stop follow', () => {
    mount();
    closed().setAttribute('aria-haspopup', 'menu');
    fireEvent.click(closed());
    grow(100);
    expect(layout.top).toBe(1600);
  });

  it('opening a closed row stops follow', () => {
    mount();
    fireEvent.click(closed());
    grow(100);
    expect(layout.top).toBe(1500);
  });

  it('a touchmove with no vertical movement does not stop follow; one that moves up does', () => {
    mount();
    fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 300 }] });
    fireEvent.touchMove(viewport, { touches: [{ clientX: 80, clientY: 300 }] });
    grow(100);
    expect(layout.top).toBe(1600);
    fireEvent.touchMove(viewport, { touches: [{ clientX: 80, clientY: 380 }] });
    grow(100);
    expect(layout.top).toBe(1600);
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

describe('a landing record that no resize used', () => {
  const readNearTop = () => {
    const view = mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 22;
    rowTop = 400;
    return view;
  };

  const rowsChange = () =>
    act(() => void viewport.querySelector('[data-testid="content"]')!.appendChild(document.createElement('i')));
  // MutationObserver callbacks are microtasks: wait for them.
  const settled = () => act(async () => void (await Promise.resolve()));

  it('is dropped two frames after the rows changed, so a later resize does not use it', async () => {
    readNearTop();
    act(() => owner.controller.beforePrepend?.());
    rowsChange();
    await settled();
    runFrame();
    runFrame();
    layout.height += 500;
    rowTop += 500;
    act(() => resize());
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('is still there for the resize of the frame the page commits in, and for a slow commit', async () => {
    readNearTop();
    act(() => owner.controller.beforePrepend?.());
    runFrame();
    runFrame();
    runFrame();
    rowsChange();
    await settled();
    runFrame();
    layout.height += 500;
    rowTop += 500;
    act(() => resize());
    expect(scrollBy).toHaveBeenCalledWith({ top: 500, behavior: 'instant' });
  });
});

describe('a chat switch', () => {
  it('brings follow back, clears a pending landing record and re-pins', () => {
    const view = mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 22;
    rowTop = 400;
    act(() => owner.controller.beforePrepend?.());
    expect(owner.controller.isFollowing()).toBe(false);
    layout.height = 3000;

    view.rerender(<Harness thread="other" />);

    expect(owner.controller.isFollowing()).toBe(true);
    expect(layout.top).toBe(2500);
    layout.height += 500;
    rowTop += 500;
    act(() => resize());
    expect(scrollBy).not.toHaveBeenCalled();
    expect(layout.top).toBe(3000);
  });
});

describe('a newer landing record is not dropped by an older one’s frame', () => {
  it('keeps the record of the newer page when a slice’s drop was already scheduled', async () => {
    mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 22;
    rowTop = 400;
    const content = viewport.querySelector('[data-testid="content"]')!;
    act(() => owner.controller.beforePrepend?.());
    act(() => void content.appendChild(document.createElement('i')));
    await act(async () => void (await Promise.resolve()));
    // The slice's two-frame drop is now scheduled. A page lands before it runs.
    runFrame();
    act(() => owner.controller.beforePrepend?.());
    runFrame();
    act(() => void content.appendChild(document.createElement('i')));
    await act(async () => void (await Promise.resolve()));
    layout.height += 500;
    rowTop += 500;
    act(() => resize());
    expect(scrollBy).toHaveBeenCalledWith({ top: 500, behavior: 'instant' });
  });
});

describe('on an engine without overflow-anchor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('restores the reader’s block after a page lands, by what it measured before the commit', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 800;
    rowTop = 1000;
    act(() => owner.controller.beforePrepend?.());
    // The page lands 840 px above; nothing anchors, so scrollTop stays where it was.
    layout.height += 840;
    rowTop += 840;
    act(() => resize());
    expect(layout.top).toBe(1640);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('writes nothing for the same page where the browser does anchor', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 800;
    rowTop = 1000;
    act(() => owner.controller.beforePrepend?.());
    layout.height += 840;
    rowTop += 840;
    act(() => resize());
    expect(layout.top).toBe(800);
  });
});

describe('followNow', () => {
  it('moves to the tail at once while following, for rows that land before the resize observer exists', () => {
    mount();
    layout.top = 0;
    layout.height = 2600;
    act(() => owner.controller.followNow?.());
    expect(layout.top).toBe(2100);
  });

  it('does nothing once the reader has left', () => {
    mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 300;
    layout.height = 2600;
    act(() => owner.controller.followNow?.());
    expect(layout.top).toBe(300);
  });
});

describe('a window around a jump target (away)', () => {
  const goAway = (view: ReturnType<typeof mount>) => view.rerender(<Harness away />);

  it('opens at its top, leaves follow off, and does not follow what lands below', () => {
    const view = mount();
    expect(following()).toBe(true);
    layout.top = 1500;
    goAway(view);
    expect(layout.top).toBe(0);
    expect(following()).toBe(false);
    grow(300);
    expect(layout.top).toBe(0);
  });

  it('keeps follow off at the bottom of the window: its bottom is not the tail', () => {
    const view = mount();
    goAway(view);
    fireEvent.wheel(viewport, { deltaY: 40 });
    layout.top = layout.height - 500;
    fireEvent.scroll(viewport);
    grow(200);
    expect(following()).toBe(false);
    expect(layout.top).toBe(1500);
  });

  it('does not re-anchor a page that landed before the window changed', () => {
    const view = mount();
    fireEvent.wheel(viewport, { deltaY: -40 });
    layout.top = 200;
    act(() => owner.controller.beforePrepend?.());
    goAway(view);
    layout.height += 300;
    rowTop += 300;
    act(() => resize());
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('pins to the bottom and follows again when the tail comes back', () => {
    const view = mount();
    goAway(view);
    view.rerender(<Harness />);
    expect(following()).toBe(true);
    expect(layout.top).toBe(1500);
    grow(300);
    expect(layout.top).toBe(1800);
  });
});
