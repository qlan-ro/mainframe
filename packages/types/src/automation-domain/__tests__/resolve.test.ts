import { describe, expect, it } from 'vitest';
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep } from '../../automation.js';
import { findStep, resolveTokenRef } from '../resolve.js';
import { RESULT_TOKEN_DESCRIPTION } from '../tokens.js';

function askAgent(id: string): AutomationStep {
  return { id, kind: 'ask_agent', prompt: [] };
}

describe('findStep', () => {
  it('finds a top-level step by id', () => {
    const steps = [askAgent('a'), askAgent('b')];
    expect(findStep(steps, 'b')).toEqual(askAgent('b'));
  });

  it('finds a step nested inside an If branch', () => {
    const ifStep: AutomationStep = {
      id: 'if1',
      kind: 'if',
      match: 'all',
      conditions: [],
      then: [askAgent('inner-then')],
      otherwise: [askAgent('inner-else')],
    };
    expect(findStep([ifStep], 'inner-else')).toEqual(askAgent('inner-else'));
  });

  it('finds a step nested inside a Repeat', () => {
    const repeatStep: AutomationStep = {
      id: 'r1',
      kind: 'repeat',
      items: { stepId: 'trigger', output: 'result' },
      steps: [askAgent('inner')],
    };
    expect(findStep([repeatStep], 'inner')).toEqual(askAgent('inner'));
  });

  it('returns null when no step has that id', () => {
    expect(findStep([askAgent('a')], 'missing')).toBeNull();
  });
});

describe('resolveTokenRef', () => {
  const definition: AutomationDefinition = {
    triggers: [{ id: 't1', kind: 'event', event: 'session.finished' }],
    steps: [askAgent('pick-feature')],
  };

  it('resolves a builtin token', () => {
    const resolved = resolveTokenRef(definition, [], { stepId: 'builtin', output: 'today' });
    expect(resolved?.label).toBe('Today');
  });

  it('resolves a trigger token', () => {
    const resolved = resolveTokenRef(definition, [], { stepId: 'trigger', output: 'result' });
    expect(resolved?.label).toBe('Result');
  });

  it('resolves a real step output regardless of position (existence, not scope)', () => {
    const resolved = resolveTokenRef(definition, [], { stepId: 'pick-feature', output: 'result' });
    expect(resolved).toEqual({
      ref: { stepId: 'pick-feature', output: 'result' },
      label: 'Result',
      type: 'text',
      sourceKind: 'agent',
      source: 'Ask agent',
      description: RESULT_TOKEN_DESCRIPTION,
    });
  });

  it('returns null for a deleted producer (stepId not found anywhere in the definition)', () => {
    expect(resolveTokenRef(definition, [], { stepId: 'deleted-step', output: 'result' })).toBeNull();
  });

  it('returns null for an output name the step does not actually produce', () => {
    expect(resolveTokenRef(definition, [], { stepId: 'pick-feature', output: 'not-a-real-output' })).toBeNull();
  });

  it('returns null for a current-item ref (unresolvable without positional Repeat context)', () => {
    expect(resolveTokenRef(definition, [], { stepId: 'current', output: 'item' })).toBeNull();
  });

  it('resolves a run_action output through the passed catalog', () => {
    const catalog: ActionCatalogEntry[] = [
      {
        id: 'run_command',
        title: 'Run a command',
        group: 'builtin',
        auth: 'none',
        paramsSchema: {},
        outputs: [{ name: 'exitCode', type: 'number' }],
      },
    ];
    const withAction: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 's1', kind: 'run_action', actionId: 'run_command', params: {} }],
    };
    const resolved = resolveTokenRef(withAction, catalog, { stepId: 's1', output: 'exitCode' });
    expect(resolved?.label).toBe('Exit code');
  });
});
