import { describe, it, expect } from 'vitest';
import { scopeForPath } from '@/features/workflows/editor/config/wf-scope';
import type { WfDraft } from '@/features/workflows/editor/wf-draft-types';

const draft: WfDraft = {
  name: 'x',
  description: '',
  scope: 'project',
  triggers: [],
  inputs: [{ name: 'repo', type: 'string' }],
  vars: [{ key: 'threshold', value: 3 }],
  outputs: [],
  steps: [
    {
      id: 'triage',
      kind: 'form',
      form: { title: 'T', fields: [{ key: 'severity', type: 'choice', options: ['low', 'high'] }] },
    },
    { id: 'note', kind: 'set', set: { flagged: true } },
    {
      id: 'loop',
      kind: 'foreach',
      over: '${inputs.repo}',
      as: 'file',
      steps: [{ id: 'work', kind: 'agent', agent: { prompt: '' } }],
    },
  ],
};

describe('scopeForPath', () => {
  it('exposes an earlier form step output and its answer keys', () => {
    const s = scopeForPath(draft, [1]); // editing `note`
    expect(s).toContainEqual(expect.objectContaining({ kind: 'step', id: 'triage', expr: '${ steps.triage.output }' }));
    expect(s).toContainEqual(
      expect.objectContaining({ kind: 'answer', key: 'severity', expr: '${ steps.triage.output.severity }' }),
    );
  });
  it('exposes inputs and vars (workflow vars + upstream set keys)', () => {
    const s = scopeForPath(draft, [2, 0]).map((x) => x.expr); // same 'work' step as above — inputs/vars are visible regardless of the loop var assertion in the next test
    expect(s).toContain('${ inputs.repo }');
    expect(s).toContain('${ vars.threshold }');
    expect(s).toContain('${ vars.flagged }'); // from the upstream `set` step
  });
  it('exposes the enclosing foreach loop var to a child step', () => {
    const s = scopeForPath(draft, [2, 0]); // 'loop' is top-level index 2 (a foreach); 'work' is index 0 in its body
    expect(s).toContainEqual(expect.objectContaining({ kind: 'loop', as: 'file', expr: '${ file }' }));
  });
  it('does not leak an inner loop id to a later top-level sibling', () => {
    const s = scopeForPath(draft, [2]).map((x) => ('id' in x ? x.id : undefined));
    expect(s).not.toContain('work');
  });
});
