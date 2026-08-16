/**
 * useHoverCardWedgeGuard — behavior tests for the wedged-hover-card force-close.
 *
 * Behaviors covered:
 *  - open=false → a document pointermove far from the row does NOT close.
 *  - open=true + a move outside both the row and the card → closes exactly once.
 *  - open=true + a move inside the row rect → stays open.
 *  - open=true + a move in the gap band just past the row's right edge → stays
 *    open (crossing the sideOffset gap toward the card is not "leaving").
 *  - open=true + a move inside the mounted hover-card content rect → stays open.
 *  - open flipping back to false tears the listener down.
 *
 * jsdom returns all-zero rects, so the row and the card element each get a fixed
 * getBoundingClientRect. Every expected coordinate below is a literal.
 *
 * canOpenMetaCard — the open-gate that stops a click-focused row from popping
 * its card 500ms after the pointer left. jsdom doesn't implement `:hover` or
 * `:focus-visible`, so each element below gets a stubbed `matches()` that
 * honors a fixed set of selectors instead of relying on jsdom's CSS engine.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHoverCardWedgeGuard, canOpenMetaCard } from '../use-hover-card-wedge-guard';

const ROW_RECT: DOMRect = {
  x: 100,
  y: 50,
  left: 100,
  top: 50,
  right: 300,
  bottom: 90,
  width: 200,
  height: 40,
  toJSON: () => ({}),
};

const CARD_RECT: DOMRect = {
  x: 310,
  y: 100,
  left: 310,
  top: 100,
  right: 500,
  bottom: 200,
  width: 190,
  height: 100,
  toJSON: () => ({}),
};

const appended: HTMLElement[] = [];

function mountWithRect(rect: DOMRect, slot?: string): HTMLElement {
  const el = document.createElement('div');
  if (slot != null) el.setAttribute('data-slot', slot);
  el.getBoundingClientRect = () => rect;
  document.body.appendChild(el);
  appended.push(el);
  return el;
}

function mountRowRef(): React.RefObject<HTMLElement | null> {
  return { current: mountWithRect(ROW_RECT) };
}

function move(clientX: number, clientY: number): void {
  document.body.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true }));
}

function renderGuard(open: boolean, rowRef: React.RefObject<HTMLElement | null>, close: () => void) {
  return renderHook(({ open: isOpen }: { open: boolean }) => useHoverCardWedgeGuard(isOpen, rowRef, close), {
    initialProps: { open },
  });
}

afterEach(() => {
  for (const el of appended) el.remove();
  appended.length = 0;
});

describe('useHoverCardWedgeGuard', () => {
  it('ignores pointer moves while the card is closed', () => {
    const close = vi.fn();
    renderGuard(false, mountRowRef(), close);

    move(900, 900);

    expect(close).not.toHaveBeenCalled();
  });

  it('closes once when the pointer moves outside both the row and the card', () => {
    const close = vi.fn();
    renderGuard(true, mountRowRef(), close);

    move(900, 900);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open while the pointer is over the row', () => {
    const close = vi.fn();
    renderGuard(true, mountRowRef(), close);

    move(200, 70);

    expect(close).not.toHaveBeenCalled();
  });

  it('stays open in the gap band just past the row edge', () => {
    const close = vi.fn();
    renderGuard(true, mountRowRef(), close);

    move(304, 70);

    expect(close).not.toHaveBeenCalled();
  });

  it('stays open while the pointer is over the hover-card content', () => {
    const close = vi.fn();
    const rowRef = mountRowRef();
    mountWithRect(CARD_RECT, 'hover-card-content');
    renderGuard(true, rowRef, close);

    move(400, 150);

    expect(close).not.toHaveBeenCalled();
  });

  it('drops the listener when the card closes', () => {
    const close = vi.fn();
    const { rerender } = renderGuard(true, mountRowRef(), close);

    rerender({ open: false });
    move(900, 900);

    expect(close).not.toHaveBeenCalled();
  });
});

function elementMatching(...selectors: string[]): HTMLElement {
  const el = document.createElement('div');
  el.matches = vi.fn((selector: string) => selectors.includes(selector)) as unknown as HTMLElement['matches'];
  return el;
}

describe('canOpenMetaCard', () => {
  it('allows the open when the row is genuinely hovered', () => {
    const row = elementMatching(':hover');

    expect(canOpenMetaCard(row, null)).toBe(true);
  });

  it('refuses when the row is not hovered and nothing is focused', () => {
    const row = elementMatching();

    expect(canOpenMetaCard(row, null)).toBe(false);
  });

  it('refuses a click-focused row — focus inside the row but not :focus-visible', () => {
    const row = elementMatching();
    const button = elementMatching();
    row.appendChild(button);

    expect(canOpenMetaCard(row, button)).toBe(false);
  });

  it('allows a keyboard-focused row — :focus-visible focus inside the row', () => {
    const row = elementMatching();
    const button = elementMatching(':focus-visible');
    row.appendChild(button);

    expect(canOpenMetaCard(row, button)).toBe(true);
  });

  it('refuses a :focus-visible element that sits outside the row', () => {
    const row = elementMatching();
    const outside = elementMatching(':focus-visible');
    document.body.appendChild(row);
    document.body.appendChild(outside);

    expect(canOpenMetaCard(row, outside)).toBe(false);
  });

  it('refuses when the row is null', () => {
    expect(canOpenMetaCard(null, elementMatching(':focus-visible'))).toBe(false);
  });
});
