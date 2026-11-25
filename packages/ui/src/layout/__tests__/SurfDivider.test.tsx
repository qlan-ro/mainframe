/**
 * Behavior tests for SurfDivider — pointer-drag and listener-leak guard.
 *
 * What we verify:
 *  1. Happy path: pointermove after pointerdown calls onFrac with the expected
 *     fraction (clientX=500 over a 1000px container → 0.5).
 *  2. Clamp low: the left panel keeps its minimum (360 of 1000 → 0.36).
 *  3. Clamp high: the right panel keeps its minimum (320 of 1000 → 0.68).
 *  4. pointerup stops further moves: after pointerup on window, a subsequent
 *     pointermove does NOT call onFrac.
 *  5. No leak: unmounting mid-drag tears down the window listeners, so a
 *     subsequent pointermove does NOT call onFrac.
 *
 * jsdom note: PointerEvent constructor exists in jsdom ≥ 16 but clientX is
 * dropped during dispatch.  We use Object.assign(new Event('pointermove'), …)
 * to attach clientX reliably.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { SurfDivider } from '../SurfDivider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a containerRef whose getBoundingClientRect returns a fixed rect
 * covering (left:0, top:0, width:1000, height:1000).
 */
function makeContainerRef() {
  const ref = createRef<HTMLDivElement | null>() as React.RefObject<HTMLDivElement | null>;
  // Provide a minimal HTMLDivElement stand-in with the rect we need.
  const fakeEl = {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
      right: 1000,
      bottom: 1000,
    }),
  } as unknown as HTMLDivElement;
  // Assign via the internal `current` writable slot.
  (ref as unknown as { current: HTMLDivElement }).current = fakeEl;
  return ref;
}

/**
 * Dispatch a window-level pointermove event with a given clientX/clientY.
 * Uses Object.assign on a plain Event so jsdom doesn't silently drop clientX.
 */
function dispatchWindowMove(clientX: number, clientY = 500) {
  const ev = Object.assign(new Event('pointermove', { bubbles: false }), {
    clientX,
    clientY,
  });
  window.dispatchEvent(ev);
}

/**
 * Dispatch a window-level pointerup event.
 */
function dispatchWindowUp() {
  window.dispatchEvent(new Event('pointerup', { bubbles: false }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ROW = { frac: 0.5, minLeft: 360, minRight: 320 };

describe('SurfDivider — drag', () => {
  let onFrac: ReturnType<typeof vi.fn<(frac: number) => void>>;

  beforeEach(() => {
    onFrac = vi.fn<(frac: number) => void>();
  });

  // --- Behavior 1: happy path ---

  it('calls onFrac(0.5) when pointermove clientX=500 fires after pointerdown', () => {
    const containerRef = makeContainerRef();
    const { getByTestId } = render(<SurfDivider {...ROW} containerRef={containerRef} onFrac={onFrac} />);

    fireEvent.pointerDown(getByTestId('surf-divider-x'));
    dispatchWindowMove(500);

    expect(onFrac).toHaveBeenCalledTimes(1);
    expect(onFrac).toHaveBeenCalledWith(0.5);
  });

  // --- Behavior 2: lower clamp ---

  it('keeps the left panel at its minimum', () => {
    const containerRef = makeContainerRef();
    const { getByTestId } = render(<SurfDivider {...ROW} containerRef={containerRef} onFrac={onFrac} />);

    fireEvent.pointerDown(getByTestId('surf-divider-x'));
    dispatchWindowMove(0);

    expect(onFrac).toHaveBeenCalledTimes(1);
    expect(onFrac).toHaveBeenCalledWith(0.36);
  });

  // --- Behavior 3: upper clamp ---

  it('keeps the right panel at its minimum', () => {
    const containerRef = makeContainerRef();
    const { getByTestId } = render(<SurfDivider {...ROW} containerRef={containerRef} onFrac={onFrac} />);

    fireEvent.pointerDown(getByTestId('surf-divider-x'));
    dispatchWindowMove(1000);

    expect(onFrac).toHaveBeenCalledTimes(1);
    expect(onFrac).toHaveBeenCalledWith(expect.closeTo(0.68));
  });

  // --- Behavior 4: pointerup stops further moves ---

  it('does NOT call onFrac after pointerup fires on window', () => {
    const containerRef = makeContainerRef();
    const { getByTestId } = render(<SurfDivider {...ROW} containerRef={containerRef} onFrac={onFrac} />);

    fireEvent.pointerDown(getByTestId('surf-divider-x'));
    // Confirm it fires before up.
    dispatchWindowMove(500);
    expect(onFrac).toHaveBeenCalledTimes(1);

    dispatchWindowUp();
    onFrac.mockClear();

    dispatchWindowMove(500);
    expect(onFrac).not.toHaveBeenCalled();
  });

  // --- Behavior 5: no listener leak on unmount mid-drag ---
  // Unmounting while a drag is in flight (no pointerup yet) must tear down the
  // window listeners via the useEffect cleanup, so a later pointermove is inert.

  it('does NOT call onFrac after unmount mid-drag', () => {
    const containerRef = makeContainerRef();
    const { getByTestId, unmount } = render(<SurfDivider {...ROW} containerRef={containerRef} onFrac={onFrac} />);

    // Start a drag but do NOT fire pointerup.
    fireEvent.pointerDown(getByTestId('surf-divider-x'));

    // Unmount the component while the drag is still in progress.
    unmount();

    // The window listeners are removed on unmount, so this move is a no-op.
    dispatchWindowMove(500);
    expect(onFrac).not.toHaveBeenCalled();
  });
});

describe('SurfDivider — thickness', () => {
  it('keeps its drag target off the right panel, which may be a native webview', () => {
    const containerRef = makeContainerRef();
    const { getByTestId } = render(<SurfDivider {...ROW} containerRef={containerRef} onFrac={vi.fn()} />);
    const target = getByTestId('surf-divider-x').querySelector<HTMLElement>('[data-edge-handle]')!;
    expect(target.style.right).toBe('0px');
    expect(target.style.width).toBe('9px');
  });
});

describe('SurfDivider — keyboard', () => {
  it('moves by a step with the arrow keys, inside the same limits', () => {
    const onFrac = vi.fn<(frac: number) => void>();
    const containerRef = makeContainerRef();
    const { getByRole, rerender } = render(<SurfDivider {...ROW} containerRef={containerRef} onFrac={onFrac} />);
    const divider = getByRole('separator', { name: 'Resize the workspace' });

    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(onFrac).toHaveBeenLastCalledWith(0.48);

    rerender(<SurfDivider {...ROW} frac={0.68} containerRef={containerRef} onFrac={onFrac} />);
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(onFrac).toHaveBeenLastCalledWith(expect.closeTo(0.68));
  });
});
