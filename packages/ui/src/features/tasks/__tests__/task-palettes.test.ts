/**
 * task-palettes.test.ts
 *
 * Behaviors covered — semantic theme tokens (--mf-task-type-* / --mf-priority-*,
 * defined once in globals.css from 12-todos.jsx TD_TYPE/TD_PRI), not raw hex:
 *
 * typeTint:
 *  1. bug uses the task-type-bug token tint (10%).
 *  2. feature uses the accent (primary) tint.
 *  3. enhancement uses the task-type-enhancement token tint.
 *  4. documentation uses the muted chip tint (no bespoke hue).
 *  5. question uses the task-type-question token tint (12%).
 *  6. duplicate uses the task-type-duplicate token tint (10%).
 *
 * priorityTint:
 *  7. critical uses the priority-critical token tint.
 *  8. high uses the priority-high token tint.
 *  9. medium uses the priority-medium token tint.
 *  10. low uses the muted chip tint.
 *
 * priorityDotClass:
 *  11-14. dots map to the priority-*-dot indicator tokens.
 */
import { describe, it, expect } from 'vitest';
import { typeTint, priorityTint, priorityDotClass } from '../task-palettes';

describe('typeTint — semantic type tokens (design: 12-todos.jsx:12-20)', () => {
  it('bug: task-type-bug token @ 10%', () => {
    expect(typeTint('bug')).toContain('bg-mf-task-type-bug/10');
    expect(typeTint('bug')).toContain('text-mf-task-type-bug');
  });

  it('feature: accent (primary) tint', () => {
    expect(typeTint('feature')).toContain('bg-primary/10');
    expect(typeTint('feature')).toContain('text-primary');
  });

  it('enhancement: task-type-enhancement token @ 10%', () => {
    expect(typeTint('enhancement')).toContain('bg-mf-task-type-enhancement/10');
    expect(typeTint('enhancement')).toContain('text-mf-task-type-enhancement');
  });

  it('documentation: chip tint (design has no bespoke hue)', () => {
    expect(typeTint('documentation')).toContain('bg-mf-chip');
  });

  it('question: task-type-question token @ 12%', () => {
    expect(typeTint('question')).toContain('bg-mf-task-type-question/[0.12]');
    expect(typeTint('question')).toContain('text-mf-task-type-question');
  });

  it('duplicate: task-type-duplicate token @ 10%', () => {
    expect(typeTint('duplicate')).toContain('bg-mf-task-type-duplicate/10');
    expect(typeTint('duplicate')).toContain('text-mf-task-type-duplicate');
  });
});

describe('priorityTint — semantic priority tokens (design: 12-todos.jsx:21-26)', () => {
  it('critical: priority-critical token @ 10%', () => {
    expect(priorityTint('critical')).toContain('bg-mf-priority-critical/10');
    expect(priorityTint('critical')).toContain('text-mf-priority-critical');
  });

  it('high: priority-high token @ 10%', () => {
    expect(priorityTint('high')).toContain('bg-mf-priority-high/10');
    expect(priorityTint('high')).toContain('text-mf-priority-high');
  });

  it('medium: priority-medium token @ 12%', () => {
    expect(priorityTint('medium')).toContain('bg-mf-priority-medium/[0.12]');
    expect(priorityTint('medium')).toContain('text-mf-priority-medium');
  });

  it('low: chip tint (no bespoke hue)', () => {
    expect(priorityTint('low')).toContain('bg-mf-chip');
  });
});

describe('priorityDotClass — priority indicator dot tokens (12-todos.jsx:21-26)', () => {
  it('critical dot', () => {
    expect(priorityDotClass('critical')).toBe('bg-mf-priority-critical-dot');
  });

  it('high dot', () => {
    expect(priorityDotClass('high')).toBe('bg-mf-priority-high-dot');
  });

  it('medium dot', () => {
    expect(priorityDotClass('medium')).toBe('bg-mf-priority-medium-dot');
  });

  it('low dot', () => {
    expect(priorityDotClass('low')).toBe('bg-mf-priority-low-dot');
  });
});
