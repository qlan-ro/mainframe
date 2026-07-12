import { describe, expect, it } from 'vitest';
import { AUTOMATION_FIXTURES, FEATURE_SPIKE_FIXTURE } from '../fixtures';

describe('AUTOMATION_FIXTURES', () => {
  it('loads all six canonical Node-owned fixtures (contract §8)', () => {
    expect(AUTOMATION_FIXTURES).toHaveLength(6);
    expect(AUTOMATION_FIXTURES.map((f) => f.name).sort()).toEqual(
      [
        'Daily feature spike',
        'Daily health log',
        'Daily standup',
        'Morning PR sweep',
        'PR auto-review',
        'Ship work',
      ].sort(),
    );
  });

  it('every fixture is scope-tagged and carries a non-empty definition', () => {
    for (const fixture of AUTOMATION_FIXTURES) {
      expect(['global', 'project']).toContain(fixture.scope);
      expect(fixture.definition.steps.length).toBeGreaterThan(0);
    }
  });
});

describe('FEATURE_SPIKE_FIXTURE — the sole A1+A2+A3 carrier (contract §8)', () => {
  it('carries the A2 expects on its ask_agent step', () => {
    const step = FEATURE_SPIKE_FIXTURE.definition.steps[0];
    expect(step?.kind).toBe('ask_agent');
    expect(step?.kind === 'ask_agent' ? step.expects : undefined).toEqual([
      { key: 'scope', type: 'choice', options: ['xs', 's', 'm'] },
    ]);
  });

  it('carries the A3 is_one_of condition', () => {
    const ifStep = FEATURE_SPIKE_FIXTURE.definition.steps[1];
    expect(ifStep?.kind).toBe('if');
    expect(ifStep?.kind === 'if' ? ifStep.conditions[0]?.comparator : undefined).toBe('is_one_of');
  });

  it('carries the A1 run_command step inside the then branch', () => {
    const ifStep = FEATURE_SPIKE_FIXTURE.definition.steps[1];
    const thenSteps = ifStep?.kind === 'if' ? ifStep.then : [];
    expect(thenSteps.some((s) => s.kind === 'run_action' && s.actionId === 'run_command')).toBe(true);
  });
});
