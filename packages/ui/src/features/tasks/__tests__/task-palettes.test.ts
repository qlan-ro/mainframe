/**
 * task-palettes.test.ts
 *
 * Behaviors covered (finding 9.3 — warm-chrome bespoke tints, not generic
 * Tailwind named-color classes):
 *
 * typeTint:
 *  1. bug uses the #c4302b tint (10%).
 *  2. feature uses the accent (primary) tint.
 *  3. enhancement uses the #7b3ff2 tint.
 *  4. documentation uses the muted chip tint (no bespoke hex — T.chipBg/T.text2).
 *  5. question uses the #b9770e tint (12%).
 *  6. duplicate uses the #c2540a tint (10%).
 *
 * priorityTint:
 *  7. critical uses the #c4302b tint.
 *  8. high uses the #c2540a tint.
 *  9. medium uses the #a76d0c / #b9770e-family tint.
 *  10. low uses the muted chip tint.
 *
 * priorityDotClass:
 *  11. critical dot is #c4302b.
 *  12. high dot is #e8730f.
 *  13. medium dot is #e0a019.
 *  14. low dot is muted (#c4c2bd family — no bespoke hex specified for low).
 */
import { describe, it, expect } from 'vitest';
import { typeTint, priorityTint, priorityDotClass } from '../task-palettes';

describe('typeTint — bespoke warm-chrome hex tints (design: 12-todos.jsx:12-20)', () => {
  it('bug: #c4302b @ 10%', () => {
    expect(typeTint('bug')).toContain('bg-[#c4302b]/10');
    expect(typeTint('bug')).toContain('text-[#c4302b]');
  });

  it('feature: accent (primary) tint', () => {
    expect(typeTint('feature')).toContain('bg-primary/10');
    expect(typeTint('feature')).toContain('text-primary');
  });

  it('enhancement: #7b3ff2 @ 10%', () => {
    expect(typeTint('enhancement')).toContain('bg-[#7b3ff2]/10');
    expect(typeTint('enhancement')).toContain('text-[#7b3ff2]');
  });

  it('documentation: chip tint (design has no bespoke hex — T.chipBg/T.text2)', () => {
    expect(typeTint('documentation')).toContain('bg-mf-chip');
  });

  it('question: #b9770e @ 12%', () => {
    expect(typeTint('question')).toContain('bg-[#b9770e]/[0.12]');
    expect(typeTint('question')).toContain('text-[#b9770e]');
  });

  it('duplicate: #c2540a @ 10%', () => {
    expect(typeTint('duplicate')).toContain('bg-[#c2540a]/10');
    expect(typeTint('duplicate')).toContain('text-[#c2540a]');
  });
});

describe('priorityTint — bespoke warm-chrome hex tints (design: 12-todos.jsx:21-26)', () => {
  it('critical: #c4302b @ 10%', () => {
    expect(priorityTint('critical')).toContain('bg-[#c4302b]/10');
    expect(priorityTint('critical')).toContain('text-[#c4302b]');
  });

  it('high: #c2540a @ 10%', () => {
    expect(priorityTint('high')).toContain('bg-[#c2540a]/10');
    expect(priorityTint('high')).toContain('text-[#c2540a]');
  });

  it('medium: #a76d0c fg on a #b9770e @ 12% bg', () => {
    expect(priorityTint('medium')).toContain('bg-[#b9770e]/[0.12]');
    expect(priorityTint('medium')).toContain('text-[#a76d0c]');
  });

  it('low: chip tint (no bespoke hex)', () => {
    expect(priorityTint('low')).toContain('bg-mf-chip');
  });
});

describe('priorityDotClass — dot hex per design (12-todos.jsx:21-26)', () => {
  it('critical dot is #c4302b', () => {
    expect(priorityDotClass('critical')).toBe('bg-[#c4302b]');
  });

  it('high dot is #e8730f', () => {
    expect(priorityDotClass('high')).toBe('bg-[#e8730f]');
  });

  it('medium dot is #e0a019', () => {
    expect(priorityDotClass('medium')).toBe('bg-[#e0a019]');
  });

  it('low dot is #c4c2bd', () => {
    expect(priorityDotClass('low')).toBe('bg-[#c4c2bd]');
  });
});
