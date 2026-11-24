// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installOverlayScrollbars } from '../manager';
import { SCROLLBAR_DRAG_EVENT } from '../thumb';

const thumbs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.mf-scrollbar')];
const isShown = (thumb: HTMLElement | undefined): boolean => thumb?.hasAttribute('data-visible') === true;

/** A 100×200 scroller with 400px of content, at the window's origin. */
function makeScroller(overflow = 'auto', parent: Element = document.body): HTMLDivElement {
  const el = document.createElement('div');
  el.style.overflowY = overflow;
  Object.defineProperties(el, {
    clientHeight: { value: 200 },
    scrollHeight: { value: 400, configurable: true },
    clientWidth: { value: 100 },
    scrollWidth: { value: 100 },
  });
  el.getBoundingClientRect = () => new DOMRect(0, 0, 100, 200);
  el.scrollTo = ((options: ScrollToOptions) => {
    el.scrollTop = options.top ?? el.scrollTop;
  }) as typeof el.scrollTo;
  el.scrollBy = ((options: ScrollToOptions) => {
    el.scrollTop += options.top ?? 0;
  }) as typeof el.scrollBy;
  parent.append(el);
  return el;
}

/** A browser's scroll offset: whole px, inside the range. jsdom keeps whatever it is given. */
function clampScroll(el: HTMLElement): void {
  let offset = 0;
  Object.defineProperty(el, 'scrollTop', {
    get: () => offset,
    set: (value: number) => {
      offset = Math.round(Math.min(Math.max(value, 0), el.scrollHeight - el.clientHeight));
    },
  });
}

const pointerOver = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
};

function drag(thumb: HTMLElement, type: string, clientY: number): void {
  thumb.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY }));
}

describe('overlay scrollbar manager', () => {
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    uninstall = installOverlayScrollbars();
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('shows a thumb while the area is hovered and fades it after the pointer leaves', () => {
    const scroller = makeScroller();
    const child = document.createElement('p');
    scroller.append(child);
    pointerOver(child);
    expect(thumbs()).toHaveLength(1);
    expect(isShown(thumbs()[0])).toBe(true);

    vi.advanceTimersByTime(5_000);
    expect(isShown(thumbs()[0])).toBe(true);

    pointerOver(document.body);
    vi.advanceTimersByTime(800);
    expect(isShown(thumbs()[0])).toBe(true);
    vi.advanceTimersByTime(200);
    expect(isShown(thumbs()[0])).toBe(false);
  });

  it('shows a thumb while an unhovered area scrolls, then fades it', () => {
    const scroller = makeScroller();
    scroller.dispatchEvent(new Event('scroll'));
    expect(isShown(thumbs()[0])).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(isShown(thumbs()[0])).toBe(false);
  });

  it('draws nothing for areas that clip, opt out or do not overflow', () => {
    pointerOver(makeScroller('hidden'));
    const optedOut = makeScroller();
    optedOut.setAttribute('data-scrollbar', 'none');
    pointerOver(optedOut);
    pointerOver(document.createElement('div'));
    expect(thumbs()).toHaveLength(0);
  });

  it('uses the nearest scroll area under the pointer', () => {
    const outer = makeScroller();
    const inner = makeScroller('auto', outer);
    pointerOver(inner);
    inner.scrollTop = 100;
    inner.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(thumbs()).toHaveLength(1);
    // Track 196, thumb 98: halfway down the range puts it 49px past the 2px inset.
    expect(thumbs()[0]?.style.top).toBe('51px');
  });

  it('scrolls the area while the thumb is dragged, and stays visible until release', () => {
    const scroller = makeScroller();
    pointerOver(scroller);
    const thumb = thumbs()[0]!;
    const onDragStart = vi.fn();
    scroller.addEventListener(SCROLLBAR_DRAG_EVENT, onDragStart);
    const outside = vi.fn();
    document.addEventListener('pointerdown', outside);

    drag(thumb, 'pointerdown', 10);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    // An outside pointerdown would close the menu or dialog being scrolled.
    expect(outside).not.toHaveBeenCalled();
    drag(thumb, 'pointermove', 59);
    expect(scroller.scrollTop).toBe(100);

    pointerOver(document.body);
    vi.advanceTimersByTime(5_000);
    expect(isShown(thumb)).toBe(true);

    drag(thumb, 'pointerup', 59);
    drag(thumb, 'pointermove', 200);
    expect(scroller.scrollTop).toBe(100);
    vi.advanceTimersByTime(1_000);
    expect(isShown(thumb)).toBe(false);
    document.removeEventListener('pointerdown', outside);
  });

  it('passes a wheel over the thumb on to the area', () => {
    const scroller = makeScroller();
    pointerOver(scroller);
    const onWheel = vi.fn();
    scroller.addEventListener('wheel', onWheel);
    thumbs()[0]!.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, cancelable: true }));
    expect(onWheel).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(30);
  });

  it('keeps the point under the pointer when content is prepended mid-drag', () => {
    const scroller = makeScroller();
    pointerOver(scroller);
    const thumb = thumbs()[0]!;
    drag(thumb, 'pointerdown', 10);
    drag(thumb, 'pointermove', 59);
    expect(scroller.scrollTop).toBe(100);

    // History loads above: the area doubles and its anchor moves the view down by as much.
    Object.defineProperty(scroller, 'scrollHeight', { value: 800 });
    scroller.scrollTop = 500;
    // Track 196, thumb 49: 600px of range over 147px of travel.
    drag(thumb, 'pointermove', 108);
    expect(scroller.scrollTop).toBe(700);
  });

  it('lets the pointer overshoot an end and come back before the area scrolls again', () => {
    const scroller = makeScroller();
    clampScroll(scroller);
    pointerOver(scroller);
    const thumb = thumbs()[0]!;
    drag(thumb, 'pointerdown', 10);
    drag(thumb, 'pointermove', 208);
    expect(scroller.scrollTop).toBe(200);
    drag(thumb, 'pointermove', 108);
    expect(scroller.scrollTop).toBe(200);
    drag(thumb, 'pointermove', 59);
    expect(scroller.scrollTop).toBe(100);
  });

  it('does not lose slow drags to whole-pixel scroll offsets', () => {
    const scroller = makeScroller();
    Object.defineProperty(scroller, 'scrollHeight', { value: 230 });
    clampScroll(scroller);
    pointerOver(scroller);
    const thumb = thumbs()[0]!;
    drag(thumb, 'pointerdown', 10);
    // Track 196, thumb 170.4: each px of the drag is 1.17px of the 30px range.
    for (let y = 11; y <= 23; y++) drag(thumb, 'pointermove', y);
    expect(scroller.scrollTop).toBe(15);
  });

  describe('what is painted over the thumb', () => {
    /** Answers `elementsFromPoint` by y, topmost first. */
    const paint = (layers: (y: number) => Element[]): void => {
      document.elementsFromPoint = (_x, y) => [...layers(y)];
    };
    afterEach(() => {
      Reflect.deleteProperty(document, 'elementsFromPoint');
    });

    it('hides the thumb when a dialog covers all of it', () => {
      const scroller = makeScroller();
      const dialog = document.createElement('div');
      document.body.append(dialog);
      let top: Element = scroller;
      paint(() => [top]);
      pointerOver(scroller);
      expect(thumbs()[0]?.hidden).toBe(false);
      top = dialog;
      vi.advanceTimersByTime(300);
      expect(thumbs()[0]?.hidden).toBe(true);
    });

    it('leaves the part of the thumb under a popover to the popover', () => {
      const scroller = makeScroller();
      const popover = document.createElement('div');
      document.body.append(popover);
      paint((y) => (y < 20 ? [popover, scroller] : [scroller]));
      pointerOver(scroller);
      const thumb = thumbs()[0]!;
      expect(thumb.hidden).toBe(false);
      // The thumb runs from 2 to 100 in the window, so the popover covers its first 18px.
      expect(thumb.style.clipPath).toBe('polygon(0px 18px, 100% 18px, 100% 98px, 0px 98px)');

      paint(() => [scroller]);
      vi.advanceTimersByTime(300);
      expect(thumb.style.clipPath).toBe('');
    });

    it('keeps both ends of a thumb whose middle is covered', () => {
      const scroller = makeScroller();
      const popover = document.createElement('div');
      document.body.append(popover);
      // From 38 to 50 of the thumb; a clipped edge may give up one more pixel, never one less.
      paint((y) => (y >= 40 && y < 52 ? [popover, scroller] : [scroller]));
      pointerOver(scroller);
      expect(thumbs()[0]!.style.clipPath).toBe(
        'polygon(0px 0px, 100% 0px, 100% 37px, 0px 37px, 0px 50px, 100% 50px, 100% 98px, 0px 98px)',
      );
    });

    it('hides the thumb when only a sliver of it is uncovered', () => {
      const scroller = makeScroller();
      const popover = document.createElement('div');
      document.body.append(popover);
      paint((y) => (y < 95 ? [popover, scroller] : [scroller]));
      pointerOver(scroller);
      expect(thumbs()[0]?.hidden).toBe(true);
    });

    it('ignores the thumbs of other areas', () => {
      const scroller = makeScroller();
      const other = document.createElement('div');
      other.className = 'mf-scrollbar';
      other.append(document.createElement('span'));
      document.body.append(other);
      paint(() => [other.firstElementChild!, other, scroller]);
      pointerOver(scroller);
      expect(thumbs().find((el) => el !== other)?.hidden).toBe(false);
    });

    it('shows over a resize edge, and leaves the outermost pixels to it', () => {
      const scroller = makeScroller();
      pointerOver(scroller);
      expect(thumbs()[0]?.style.width).toBe('10px');
      const edge = document.createElement('button');
      edge.setAttribute('data-edge-handle', '');
      document.body.append(edge);
      paint(() => [edge, scroller]);
      vi.advanceTimersByTime(300);
      expect(thumbs()[0]?.hidden).toBe(false);
      expect(thumbs()[0]?.style.left).toBe('90px');
      expect(thumbs()[0]?.style.width).toBe('8px');
    });

    it('hit-tests a spot once between rechecks, however many frames scroll past it', () => {
      const scroller = makeScroller();
      const popover = document.createElement('div');
      document.body.append(popover);
      let calls = 0;
      let edge = 60;
      paint((y) => {
        calls += 1;
        return y < edge ? [popover, scroller] : [scroller];
      });
      const scrollTo = (top: number): void => {
        scroller.scrollTop = top;
        scroller.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(17);
      };
      vi.advanceTimersByTime(1);
      pointerOver(scroller);
      const thumb = thumbs()[0]!;
      expect(thumb.style.clipPath).toBe('polygon(0px 58px, 100% 58px, 100% 98px, 0px 98px)');

      calls = 0;
      for (let i = 0; i < 5; i++) scrollTo(0);
      expect(calls).toBe(0);
      // 24.5px down the track: its two ends and the three grid points that are new, of the twenty or so in a scan.
      scrollTo(50);
      expect(thumb.style.clipPath).toBe('polygon(0px 33.5px, 100% 33.5px, 100% 98px, 0px 98px)');
      expect(calls).toBeLessThanOrEqual(5);

      edge = 0;
      vi.advanceTimersByTime(250);
      expect(thumb.style.clipPath).toBe('');
    });

    it('never hides the thumb that is being dragged', () => {
      const scroller = makeScroller();
      const dialog = document.createElement('div');
      document.body.append(dialog);
      let top: Element = scroller;
      paint(() => [top]);
      pointerOver(scroller);
      const thumb = thumbs()[0]!;
      drag(thumb, 'pointerdown', 10);
      top = dialog;
      vi.advanceTimersByTime(300);
      expect(thumb.hidden).toBe(false);
      expect(thumb.style.clipPath).toBe('');
      drag(thumb, 'pointerup', 10);
      vi.advanceTimersByTime(300);
      expect(thumb.hidden).toBe(true);
    });
  });

  it('keeps its mousedown from light-dismiss handlers', () => {
    pointerOver(makeScroller());
    const outside = vi.fn();
    document.addEventListener('mousedown', outside);
    drag(thumbs()[0]!, 'mousedown', 10);
    expect(outside).not.toHaveBeenCalled();
    document.removeEventListener('mousedown', outside);
  });

  it('drops the thumb of an area that unmounts', () => {
    const scroller = makeScroller();
    pointerOver(scroller);
    scroller.remove();
    vi.advanceTimersByTime(300);
    expect(thumbs()).toHaveLength(0);
  });

  it('removes everything on teardown', () => {
    pointerOver(makeScroller());
    uninstall();
    expect(thumbs()).toHaveLength(0);
  });
});
