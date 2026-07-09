import { describe, it, expect } from 'vitest';
import type { WfStep, WfDraft } from '@/features/workflows/editor/wf-draft-types';

describe('WfDraft v2 types', () => {
  it('narrows the discriminated union by kind', () => {
    const step: WfStep = { id: 'a', kind: 'agent', agent: { prompt: 'hi' } };
    // Type-level: reading step.agent is only legal after narrowing on kind.
    if (step.kind === 'agent') expect(step.agent.prompt).toBe('hi');
  });

  it('accepts a full-parity draft literal', () => {
    const d: WfDraft = {
      name: 'x',
      description: '',
      scope: 'project',
      triggers: [{ kind: 'manual' }],
      inputs: [],
      vars: [],
      outputs: [],
      steps: [
        { id: 's1', kind: 'form', form: { title: 'Q', fields: [{ key: 'a', type: 'text' }] } },
        { id: 's2', kind: 'foreach', over: '${inputs.items}', as: 'item', steps: [] },
      ],
    };
    expect(d.steps).toHaveLength(2);
  });
});
