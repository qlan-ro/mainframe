/** `stickyInset` measures how deep the sticky header stack parked at one edge of a scroller runs, so a fade mask can start below the headers instead of dissolving them. */
import { describe, it, expect } from 'vitest';
import { stickyInset } from '../use-sticky-insets';

const BOUNDS = { top: 0, bottom: 500 };

describe('stickyInset', () => {
  it('returns 0 for both edges when there are no headers', () => {
    expect(stickyInset(BOUNDS, [], 'top')).toBe(0);
    expect(stickyInset(BOUNDS, [], 'bottom')).toBe(0);
  });

  it('returns the header height when one header is parked flush at the top edge', () => {
    const header = { top: 0, bottom: 40 };
    expect(stickyInset(BOUNDS, [header], 'top')).toBe(40);
  });

  it('returns the combined depth when two headers stack at the top edge', () => {
    const first = { top: 0, bottom: 40 };
    const second = { top: 40, bottom: 70 };
    expect(stickyInset(BOUNDS, [first, second], 'top')).toBe(70);
  });

  it('ignores a header scrolled away from the top edge', () => {
    const header = { top: 10, bottom: 50 };
    expect(stickyInset(BOUNDS, [header], 'top')).toBe(0);
  });

  it('returns the header height when one header is parked flush at the bottom edge', () => {
    const header = { top: 460, bottom: 500 };
    expect(stickyInset(BOUNDS, [header], 'bottom')).toBe(40);
  });

  it('returns the combined depth when two headers stack at the bottom edge', () => {
    const nearEdge = { top: 460, bottom: 500 };
    const further = { top: 430, bottom: 460 };
    expect(stickyInset(BOUNDS, [nearEdge, further], 'bottom')).toBe(70);
  });

  it('ignores a header scrolled away from the bottom edge', () => {
    const header = { top: 400, bottom: 440 };
    expect(stickyInset(BOUNDS, [header], 'bottom')).toBe(0);
  });

  it('counts a header offset 0.5px from the top edge (sub-pixel, within the 1px epsilon)', () => {
    const header = { top: 0.5, bottom: 40.5 };
    expect(stickyInset(BOUNDS, [header], 'top')).toBe(40.5);
  });
});
