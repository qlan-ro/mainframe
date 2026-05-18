import { describe, it, expect } from 'vitest';
import { normaliseRect } from './RegionCaptureOverlay.js';

describe('normaliseRect', () => {
  it('returns unchanged when dragged top-left to bottom-right', () => {
    expect(normaliseRect(10, 20, 110, 80)).toEqual({ x: 10, y: 20, width: 100, height: 60 });
  });

  it('normalises a drag from bottom-right to top-left', () => {
    expect(normaliseRect(110, 80, 10, 20)).toEqual({ x: 10, y: 20, width: 100, height: 60 });
  });

  it('normalises a drag from bottom-left to top-right', () => {
    expect(normaliseRect(10, 80, 110, 20)).toEqual({ x: 10, y: 20, width: 100, height: 60 });
  });

  it('returns zero dimensions for same-point drag', () => {
    expect(normaliseRect(50, 50, 50, 50)).toEqual({ x: 50, y: 50, width: 0, height: 0 });
  });

  it('handles negative start coords', () => {
    const result = normaliseRect(-5, -10, 95, 40);
    expect(result).toEqual({ x: -5, y: -10, width: 100, height: 50 });
  });
});
