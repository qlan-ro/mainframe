// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { overflows, scrollPerDragPixel, thumbBox, thumbClip, thumbLength, thumbOffset } from '../geometry';

const box = { top: 100, left: 50, right: 250, bottom: 300 };

describe('overlay thumb geometry', () => {
  it('needs more than a rounding pixel of overflow', () => {
    expect(overflows({ view: 200, full: 201, position: 0 })).toBe(false);
    expect(overflows({ view: 200, full: 202, position: 0 })).toBe(true);
    expect(overflows({ view: 0, full: 500, position: 0 })).toBe(false);
  });

  it('is as long as the visible share of the content, inside 2px insets', () => {
    expect(thumbLength({ view: 204, full: 408, position: 0 })).toBe(100);
  });

  it('is never shorter than 24px', () => {
    expect(thumbLength({ view: 204, full: 100_000, position: 0 })).toBe(24);
  });

  it('travels from 2px after the start to 2px before the end', () => {
    expect(thumbOffset({ view: 204, full: 408, position: 0 })).toBe(2);
    expect(thumbOffset({ view: 204, full: 408, position: 204 })).toBe(102);
    // A rubber-band overscroll stays inside the track.
    expect(thumbOffset({ view: 204, full: 408, position: -40 })).toBe(2);
    expect(thumbOffset({ view: 204, full: 408, position: 900 })).toBe(102);
  });

  it('maps the whole drag travel onto the whole scroll range', () => {
    // 100px of travel covers 204px of scrolling.
    expect(scrollPerDragPixel({ view: 204, full: 408, position: 0 })).toBeCloseTo(2.04);
  });

  it('hugs the trailing edge on each axis', () => {
    const metrics = { view: 200, full: 400, position: 0 };
    expect(thumbBox('y', metrics, box, box)).toEqual({ top: 102, bottom: 200, left: 240, right: 250 });
    expect(thumbBox('x', metrics, box, box)).toEqual({ left: 52, right: 150, top: 290, bottom: 300 });
  });

  it('is cut to what the surroundings leave visible, and dropped when too little is left', () => {
    const metrics = { view: 200, full: 400, position: 0 };
    expect(thumbBox('y', metrics, box, { ...box, bottom: 150 })).toEqual({
      top: 102,
      bottom: 150,
      left: 240,
      right: 250,
    });
    expect(thumbBox('y', metrics, box, { ...box, bottom: 106 })).toBeNull();
    // The scroller's right edge is behind a panel.
    expect(thumbBox('y', metrics, box, { ...box, right: 245 })).toBeNull();
  });

  it('follows the visible edge when a border clips the last pixel or two of the scroller', () => {
    const metrics = { view: 200, full: 400, position: 0 };
    expect(thumbBox('y', metrics, box, { ...box, right: 249 })).toMatchObject({ left: 239, right: 249 });
    expect(thumbBox('x', metrics, box, { ...box, bottom: 298 })).toMatchObject({ top: 288, bottom: 298 });
  });
});

describe('thumb clip', () => {
  it('is nothing for a whole thumb and null for one with no part worth drawing', () => {
    expect(thumbClip('y', 98, [[0, 98]])).toBe('');
    expect(thumbClip('y', 98, [])).toBeNull();
    expect(thumbClip('y', 98, [[0, 5]])).toBeNull();
  });

  it('runs along the axis of the thumb', () => {
    expect(thumbClip('y', 98, [[18, 98]])).toBe('polygon(0px 18px, 100% 18px, 100% 98px, 0px 98px)');
    expect(thumbClip('x', 98, [[18, 98]])).toBe('polygon(18px 0px, 18px 100%, 98px 100%, 98px 0px)');
  });
});
