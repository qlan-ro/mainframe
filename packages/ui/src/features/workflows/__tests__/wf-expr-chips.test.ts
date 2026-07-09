import { describe, it, expect } from 'vitest';
import { buildChipDecorations } from '@/features/workflows/editor/config/wf-expr-chips';

const scope = [{ kind: 'step', id: 'triage', label: 'Output of triage', expr: '${ steps.triage.output }' }] as const;

describe('buildChipDecorations', () => {
  it('finds a ${...} range and labels it from scope', () => {
    const d = buildChipDecorations('Fix ${ steps.triage.output } now', scope as never);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ label: 'Output of triage' });
  });
  it('emits a generic chip for an unknown expression', () => {
    const d = buildChipDecorations('x ${ mystery.thing }', []);
    expect(d[0]!.label).toBe('ƒx');
  });
  it('handles multiple chips and plain text between', () => {
    expect(buildChipDecorations('${a} and ${b}', [])).toHaveLength(2);
  });
  it('does not throw and emits no decoration for an unclosed ${', () => {
    expect(() => buildChipDecorations('Fix ${ steps.triage.output now', [])).not.toThrow();
    expect(buildChipDecorations('Fix ${ steps.triage.output now', [])).toHaveLength(0);
  });
});
