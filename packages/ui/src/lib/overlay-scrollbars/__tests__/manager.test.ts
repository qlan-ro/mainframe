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
    scrollHeight: { value: 400 },
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

  it('hides the thumb when a dialog covers the area', () => {
    const scroller = makeScroller();
    const dialog = document.createElement('div');
    document.body.append(dialog);
    let top: Element = scroller;
    document.elementsFromPoint = () => [top];
    pointerOver(scroller);
    expect(thumbs()[0]?.hidden).toBe(false);
    top = dialog;
    vi.advanceTimersByTime(300);
    expect(thumbs()[0]?.hidden).toBe(true);
    Reflect.deleteProperty(document, 'elementsFromPoint');
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
