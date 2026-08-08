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
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHoverCardWedgeGuard } from '../use-hover-card-wedge-guard';

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
