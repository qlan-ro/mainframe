import { describe, expect, it } from 'vitest';
import { clampDialogSize } from '../dialog-resize';

describe('clampDialogSize', () => {
  it('raises a value below the minimum up to the minimum', () => {
    expect(clampDialogSize(100, 200, 800)).toBe(200);
  });

  it('caps a value above the viewport maximum', () => {
    expect(clampDialogSize(900, 200, 800)).toBe(800);
  });

  it('passes an in-range value through unchanged', () => {
    expect(clampDialogSize(500, 200, 800)).toBe(500);
  });

  it('returns the minimum when the minimum exceeds the maximum', () => {
    expect(clampDialogSize(500, 900, 800)).toBe(900);
  });
});
