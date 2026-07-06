/**
 * glyphs — TDD test for iterChipTint, the shared status-tone → chip
 * border/bg tint mapping. Replaces WfTree's hand-rolled 4th copy of the
 * status→color mapping (activeIterChipClasses); driven off the same
 * StatusMeta.tone vocabulary getStepStatusMeta already exposes.
 */
import { describe, it, expect } from 'vitest';
import { iterChipTint, getStepStatusMeta } from '@/features/workflows/glyphs';

describe('iterChipTint', () => {
  it('maps tone "success" to the success border/bg tint', () => {
    expect(iterChipTint('success')).toBe('border-mf-success/60 bg-mf-success/10');
  });

  it('maps tone "primary" to the primary border/bg tint', () => {
    expect(iterChipTint('primary')).toBe('border-primary/60 bg-primary/10');
  });

  it('maps tone "warning" to the warning border/bg tint', () => {
    expect(iterChipTint('warning')).toBe('border-mf-warning/60 bg-mf-warning/10');
  });

  it('maps tone "destructive" to the destructive border/bg tint', () => {
    expect(iterChipTint('destructive')).toBe('border-destructive/60 bg-destructive/10');
  });

  it('maps tone "muted" (and unknown) to the neutral border/bg tint', () => {
    expect(iterChipTint('muted')).toBe('border-border bg-muted');
  });

  it('composes with getStepStatusMeta so a succeeded step tints success, not amber/warning', () => {
    const tone = getStepStatusMeta('succeeded').tone;
    expect(iterChipTint(tone)).toBe('border-mf-success/60 bg-mf-success/10');
    expect(iterChipTint(tone)).not.toContain('warning');
  });
});
