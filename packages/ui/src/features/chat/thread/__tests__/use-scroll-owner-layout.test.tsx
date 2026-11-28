// @vitest-environment jsdom
/**
 * The scroll owner against position changes the reader did not make: a layout between React's commit and the
 * frame (#519), and content shrinking below a reader who once scrolled down (#521). The sequences are the ones
 * the transcript list rig recorded in WKWebView (`R-send` with a forced layout, `R-read-tail`).
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWN_INTENT_MS, useScrollOwner } from '../use-scroll-owner';

let resize: () => void = () => undefined;
class FakeResizeObserver {
  constructor(callback: () => void) {
    resize = callback;
  }
  observe() {}
  disconnect() {}
}

/** A viewport `client` high over content `height` high; the browser clamps the position to the content. */
const layout = { height: 2000, client: 500, top: 0 };
const clamp = () => {
  layout.top = Math.max(0, Math.min(layout.height - layout.client, layout.top));
};
let owner: ReturnType<typeof useScrollOwner>;
let viewport: HTMLElement;

function Harness() {
  owner = useScrollOwner('thread', 'chat');
  return (
    <div ref={owner.setViewport} data-testid="viewport" tabIndex={-1}>
      <div ref={owner.setContent}>
        <p>Read</p>
      </div>
    </div>
  );
}

const originals: PropertyDescriptorMap = {};
const DRIVEN = {
  clientHeight: { get: () => layout.client, configurable: true },
  scrollHeight: { get: () => layout.height, configurable: true },
  scrollTop: {
    get: () => layout.top,
    set: (value: number) => {
      layout.top = value;
      clamp();
    },
    configurable: true,
  },
};

const following = () => owner.controller.isFollowing();
const bottomGap = () => layout.height - layout.client - layout.top;
const resized = () => act(() => resize());
let now = 1000;

beforeEach(() => {
  for (const name of Object.keys(DRIVEN))
    originals[name] = Object.getOwnPropertyDescriptor(Element.prototype, name) ?? {
      value: undefined,
      configurable: true,
    };
  Object.defineProperties(Element.prototype, DRIVEN);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  Object.assign(layout, { height: 2000, client: 500, top: 0 });
  now = 1000;
  viewport = render(<Harness />).getByTestId('viewport');
});
afterEach(() => {
  Object.defineProperties(Element.prototype, originals);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a layout the resize callback has not seen yet (#519)', () => {
  it('keeps following when the browser clamped the position as the composer cleared and the prompt landed', () => {
    expect(layout.top).toBe(1500);
    // The composer shrinks by 100 and the prompt row adds 129; something reads layout before the frame, and
    // WebKit clamps against the content as it was: the position drops by the composer's 100.
    layout.client = 600;
    layout.height = 2129;
    layout.top = 1400;
    fireEvent.scroll(viewport);
    expect(following()).toBe(true);
    expect(bottomGap()).toBe(0);
    layout.height += 50;
    resized();
    expect(bottomGap()).toBe(0);
  });

  it('keeps following when anchoring moved the position up with content above and below changing', () => {
    layout.height = 2060;
    layout.top = 1440;
    fireEvent.scroll(viewport);
    expect(following()).toBe(true);
    expect(bottomGap()).toBe(0);
  });

  it('lets go when the reader scrolls up further than a streamed chunk grew the content', () => {
    // A chunk adds 40 px before the frame; the reader's threaded scroll moved 100 px up and its wheel event comes after.
    layout.height += 40;
    layout.top = 1400;
    fireEvent.scroll(viewport);
    expect(following()).toBe(false);
    resized();
    fireEvent.wheel(viewport, { deltaY: -40 });
    expect(layout.top).toBe(1400);
  });

  it('lets go for a selection drag up while a reply streams (no scroll input at all)', () => {
    for (let frame = 0; frame < 5; frame++) {
      layout.height += 30;
      layout.top -= 60;
      fireEvent.scroll(viewport);
      resized();
    }
    expect(following()).toBe(false);
    expect(layout.top).toBe(1200);
  });

  it('still lets go when something scrolls up with no layout behind it (Find, a jump)', () => {
    layout.top = 900;
    fireEvent.scroll(viewport);
    expect(following()).toBe(false);
    layout.height += 200;
    resized();
    expect(layout.top).toBe(900);
  });
});

describe('content shrinking below a reader who has scrolled up (#521)', () => {
  it('does not follow again when a fold clamps them to the bottom after they nudged down', () => {
    fireEvent.wheel(viewport, { deltaY: -100 });
    layout.top = 1200;
    fireEvent.scroll(viewport);
    fireEvent.wheel(viewport, { deltaY: 60 });
    layout.top = 1260;
    fireEvent.scroll(viewport);
    now += 200;
    // The turn ends and folds: the content below them goes, and the browser clamps them to the bottom.
    layout.height = 1600;
    clamp();
    fireEvent.scroll(viewport);
    expect(following()).toBe(false);
    layout.height += 300;
    resized();
    expect(layout.top).toBe(1100);
  });

  it('does not follow again when downward input is old', () => {
    fireEvent.wheel(viewport, { deltaY: -100 });
    layout.top = 1200;
    fireEvent.scroll(viewport);
    fireEvent.wheel(viewport, { deltaY: 40 });
    now += DOWN_INTENT_MS + 1;
    layout.top = 1500;
    fireEvent.scroll(viewport);
    expect(following()).toBe(false);
  });

  it('follows again when the reader’s own downward scroll reaches the bottom', () => {
    fireEvent.wheel(viewport, { deltaY: -100 });
    layout.top = 1200;
    fireEvent.scroll(viewport);
    fireEvent.wheel(viewport, { deltaY: 300 });
    now += 100;
    layout.top = 1500;
    fireEvent.scroll(viewport);
    expect(following()).toBe(true);
    layout.height += 100;
    resized();
    expect(bottomGap()).toBe(0);
  });
});
