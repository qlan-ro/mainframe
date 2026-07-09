import { describe, it, expect } from 'vitest';
import { getByPath, setByPath } from '@/features/workflows/editor/config/descriptor-types';
import type { WfStep } from '@/features/workflows/editor/wf-draft-types';

describe('setByPath / getByPath', () => {
  it('sets a nested key and returns a new step without mutating the input', () => {
    const step: WfStep = { id: 'a', kind: 'agent', agent: { prompt: '' } };

    const patched = setByPath(step, 'agent.prompt', 'hi');

    expect(patched).not.toBe(step);
    expect(getByPath(patched, 'agent')).not.toBe(getByPath(step, 'agent'));
    expect(getByPath(patched, 'agent.prompt')).toBe('hi');
    expect(getByPath(step, 'agent.prompt')).toBe('');
  });

  it('creates intermediate objects that do not exist yet', () => {
    const step: WfStep = { id: 'a', kind: 'form', form: { title: 'T', fields: [] } };

    const patched = setByPath(step, 'form.timeout.afterMinutes', 5);

    expect(getByPath(patched, 'form.timeout.afterMinutes')).toBe(5);
  });

  it('returns undefined for an unknown path', () => {
    const step: WfStep = { id: 'a', kind: 'agent', agent: { prompt: '' } };

    expect(getByPath(step, 'agent.nope.deeper')).toBeUndefined();
    expect(getByPath(step, 'nonexistent')).toBeUndefined();
  });
});
