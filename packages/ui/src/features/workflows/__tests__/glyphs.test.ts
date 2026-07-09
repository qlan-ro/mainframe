/**
 * glyphs — TDD test for iterChipTint, the shared status-tone → chip
 * border/bg tint mapping. Replaces WfTree's hand-rolled 4th copy of the
 * status→color mapping (activeIterChipClasses); driven off the same
 * StatusMeta.tone vocabulary getStepStatusMeta already exposes.
 */
import { describe, it, expect } from 'vitest';
import { iterChipTint, getStepStatusMeta, getKindMeta } from '@/features/workflows/glyphs';

describe('kind glyphs after alias removal', () => {
  it('resolves the builder service kind directly', () => {
    expect(getKindMeta('service').label).toBe('Service');
  });
  it('still resolves the daemon run-tree connector kind', () => {
    expect(getKindMeta('connector').label).toBe('Service');
  });
  it('resolves canonical control-flow kinds', () => {
    expect(getKindMeta('choose').label).toBe('Branch');
    expect(getKindMeta('foreach').label).toBe('Loop');
    expect(getKindMeta('call').label).toBe('Sub-workflow');
    expect(getKindMeta('form').label).toBe('Form');
  });
  it('leaves the run-view question kind labeled Question (NOT relabeled to Form)', () => {
    // Regression guard: the daemon's run tree emits kind `question` for the
    // authored form step AND for runtime agent-emitted question cards, which
    // must keep reading "Question". Adding `form` for the builder must not
    // touch the existing `question` entry — that is the whole point of the
    // form/question naming split.
    expect(getKindMeta('question').label).toBe('Question');
  });
  it('no longer exports KIND_ALIAS or getKindMetaByModel', async () => {
    // Runtime check on the module namespace — NOT a type-level `@ts-expect-error`
    // property-access check, which is always type-legal on an index-signature
    // type (`Record<string, KindMeta>`) and would leave the directive unused,
    // failing typecheck with "Unused '@ts-expect-error' directive" instead of
    // proving the export is gone.
    const mod: Record<string, unknown> = await import('@/features/workflows/glyphs');
    expect(mod.KIND_ALIAS).toBeUndefined();
    expect(mod.getKindMetaByModel).toBeUndefined();
  });
});

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
