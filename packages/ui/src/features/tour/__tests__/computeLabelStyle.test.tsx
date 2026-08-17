/**
 * computeLabelStyle.test.ts
 *
 * Regression coverage for the tutorial popover clipping off the right edge
 * of the viewport (step 4 / "workspace", side: 'below', anchors a 32px
 * toggle near the right edge of the toolbar).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { clampLabelLeft, computeLabelStyle } from '../TutorialOverlay';

const LW = 268;

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

const originalInnerWidth = window.innerWidth;

afterEach(() => {
  setViewportWidth(originalInnerWidth);
});

describe('clampLabelLeft', () => {
  it('clamps to the left edge (8px minimum)', () => {
    expect(clampLabelLeft(-50, 1440)).toBe(8);
  });

  it('clamps to the right edge so the card stays fully on-screen', () => {
    setViewportWidth(1440);
    const left = clampLabelLeft(1400, 1440);
    expect(left).toBe(1440 - LW - 8);
    expect(left + LW).toBeLessThanOrEqual(1440);
  });

  it('leaves an unclamped value untouched', () => {
    expect(clampLabelLeft(500, 1440)).toBe(500);
  });

  it('falls back to the left clamp when the viewport is narrower than the card', () => {
    // viewportWidth - LW - 8 goes negative; the left floor (8) must win.
    expect(clampLabelLeft(50, 200)).toBe(8);
  });
});

describe('computeLabelStyle', () => {
  // Mirrors the workspace toggle: a 32px-wide icon sitting near the right
  // edge of the toolbar, at a few representative viewport widths.
  const widths = [1280, 1440, 1728];

  it.each(widths)('keeps the "below" card fully on-screen at %dpx wide', (width) => {
    setViewportWidth(width);
    const rect = { top: 40, left: width - 40, width: 32, height: 28 };
    const style = computeLabelStyle(rect, 'below');
    const left = style.left as number;
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + LW).toBeLessThanOrEqual(width);
  });

  it.each(widths)('keeps the "above" card fully on-screen at %dpx wide', (width) => {
    setViewportWidth(width);
    const rect = { top: 200, left: width - 40, width: 32, height: 28 };
    const style = computeLabelStyle(rect, 'above');
    const left = style.left as number;
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + LW).toBeLessThanOrEqual(width);
  });

  it.each(widths)('keeps the "right" card fully on-screen at %dpx wide', (width) => {
    setViewportWidth(width);
    const rect = { top: 200, left: width - 20, width: 12, height: 12 };
    const style = computeLabelStyle(rect, 'right');
    const left = style.left as number;
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + LW).toBeLessThanOrEqual(width);
  });

  it('does not clamp a "below" card anchored away from the right edge', () => {
    setViewportWidth(1440);
    const rect = { top: 40, left: 100, width: 32, height: 28 };
    const style = computeLabelStyle(rect, 'below');
    // center: 100-6=94 (h.left) + (32+12)/2 -134 = 94+22-134 = -18 -> clamps to 8 (left edge, not right)
    expect(style.left).toBe(8);
  });
});
