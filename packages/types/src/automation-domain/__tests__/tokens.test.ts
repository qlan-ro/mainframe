import { describe, expect, it } from 'vitest';
import type { ActionCatalogEntry, AutomationStep } from '../../automation.js';
import { builtinTokens, findStepById, stepProduces, triggerTokens } from '../tokens.js';

const RUN_COMMAND_CATALOG: ActionCatalogEntry[] = [
  {
    id: 'run_command',
    title: 'Run a command',
    group: 'builtin',
    auth: 'none',
    paramsSchema: {},
    outputs: [
      { name: 'output', type: 'text' },
      { name: 'exitCode', type: 'number' },
    ],
  },
];

function askAgent(id: string, extra: Partial<AutomationStep> = {}): AutomationStep {
  return { id, kind: 'ask_agent', prompt: [], ...extra } as AutomationStep;
}

describe('builtinTokens', () => {
  it('always exposes Today and Now as date tokens sourced from Built-in', () => {
    const tokens = builtinTokens();
    expect(tokens).toEqual([
      {
        ref: { stepId: 'builtin', output: 'today' },
        label: 'Today',
        type: 'date',
        sourceKind: 'builtin',
        source: 'Built-in',
      },
      {
        ref: { stepId: 'builtin', output: 'now' },
        label: 'Now',
        type: 'date',
        sourceKind: 'builtin',
        source: 'Built-in',
      },
    ]);
  });
});

describe('triggerTokens', () => {
  it('exposes result/chatId text tokens for a curated event trigger', () => {
    const tokens = triggerTokens([{ id: 't1', kind: 'event', event: 'session.finished' }]);
    expect(tokens).toEqual([
      {
        ref: { stepId: 'trigger', output: 'result' },
        label: 'Result',
        type: 'text',
        sourceKind: 'trigger',
        source: 'Trigger',
      },
      {
        ref: { stepId: 'trigger', output: 'chatId' },
        label: 'Chat',
        type: 'text',
        sourceKind: 'trigger',
        source: 'Trigger',
      },
    ]);
  });

  it('produces no tokens for a schedule trigger', () => {
    expect(
      triggerTokens([{ id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '09:00' }, onMissed: 'skip' }]),
    ).toEqual([]);
  });
});

describe('stepProduces — named camelCase outputs', () => {
  it('ask_agent produces result/chatId plus each declared A2 expects key, typed and carrying options', () => {
    const step = askAgent('pick-feature', {
      expects: [{ key: 'scope', type: 'choice', options: ['xs', 's', 'm'] }],
    });
    const tokens = stepProduces(step, []);
    expect(tokens).toEqual([
      {
        ref: { stepId: 'pick-feature', output: 'result' },
        label: 'Result',
        type: 'text',
        sourceKind: 'agent',
        source: 'Ask agent',
      },
      {
        ref: { stepId: 'pick-feature', output: 'chatId' },
        label: 'Chat',
        type: 'text',
        sourceKind: 'agent',
        source: 'Ask agent',
      },
      {
        ref: { stepId: 'pick-feature', output: 'scope' },
        label: 'Scope',
        type: 'choice',
        sourceKind: 'agent',
        source: 'Ask agent',
        options: ['xs', 's', 'm'],
      },
    ]);
  });

  it('ask_me maps each field to a token typed by field type, multi becomes list', () => {
    const step: AutomationStep = {
      id: 'ask-me-1',
      kind: 'ask_me',
      title: 'Daily check-in',
      fields: [
        { key: 'mood', type: 'choice', label: 'Mood', options: ['good', 'ok', 'bad'] },
        { key: 'tags', type: 'multi', label: 'Tags', options: ['a', 'b'] },
        { key: 'notes', type: 'textarea', label: 'Notes' },
      ],
    };
    const tokens = stepProduces(step, []);
    expect(tokens).toEqual([
      {
        ref: { stepId: 'ask-me-1', output: 'mood' },
        label: 'Mood',
        type: 'choice',
        sourceKind: 'askme',
        source: 'Daily check-in',
        options: ['good', 'ok', 'bad'],
      },
      {
        ref: { stepId: 'ask-me-1', output: 'tags' },
        label: 'Tags',
        type: 'list',
        sourceKind: 'askme',
        source: 'Daily check-in',
        options: ['a', 'b'],
      },
      {
        ref: { stepId: 'ask-me-1', output: 'notes' },
        label: 'Notes',
        type: 'text',
        sourceKind: 'askme',
        source: 'Daily check-in',
      },
    ]);
  });

  it('run_action looks up outputs from the passed catalog entry, using the wire output names', () => {
    const step: AutomationStep = { id: 'verify-build', kind: 'run_action', actionId: 'run_command', params: {} };
    const tokens = stepProduces(step, RUN_COMMAND_CATALOG);
    expect(tokens).toEqual([
      {
        ref: { stepId: 'verify-build', output: 'output' },
        label: 'Output',
        type: 'text',
        sourceKind: 'action',
        source: 'Run a command',
      },
      {
        ref: { stepId: 'verify-build', output: 'exitCode' },
        label: 'Exit code',
        type: 'number',
        sourceKind: 'action',
        source: 'Run a command',
      },
    ]);
  });

  it('run_action with an unknown actionId produces nothing (unpicked action)', () => {
    const step: AutomationStep = { id: 's1', kind: 'run_action', actionId: '', params: {} };
    expect(stepProduces(step, RUN_COMMAND_CATALOG)).toEqual([]);
  });

  it('notify produces nothing', () => {
    const step: AutomationStep = { id: 'n1', kind: 'notify', message: [] };
    expect(stepProduces(step, [])).toEqual([]);
  });

  it('repeat produces nothing at the point it is reached (isolated — Current item never leaks)', () => {
    const step: AutomationStep = {
      id: 'r1',
      kind: 'repeat',
      items: { stepId: 'trigger', output: 'result' },
      steps: [askAgent('inner')],
    };
    expect(stepProduces(step, [])).toEqual([]);
  });

  it('if aggregates every token produced inside both then and otherwise', () => {
    const step: AutomationStep = {
      id: 'if1',
      kind: 'if',
      match: 'all',
      conditions: [],
      then: [askAgent('a')],
      otherwise: [askAgent('b')],
    };
    const tokens = stepProduces(step, []);
    expect(tokens.map((t) => t.ref.stepId)).toEqual(['a', 'a', 'b', 'b']);
  });
});

describe('findStepById', () => {
  it('finds a top-level step by id', () => {
    const step = askAgent('a');
    expect(findStepById([step, askAgent('b')], 'a')).toBe(step);
  });

  it('returns null when no step matches', () => {
    expect(findStepById([askAgent('a')], 'missing')).toBeNull();
  });

  it('recurses into an if block’s then and otherwise branches', () => {
    const thenStep = askAgent('then-step');
    const otherwiseStep = askAgent('otherwise-step');
    const ifStep: AutomationStep = {
      id: 'if1',
      kind: 'if',
      match: 'all',
      conditions: [],
      then: [thenStep],
      otherwise: [otherwiseStep],
    };
    expect(findStepById([ifStep], 'then-step')).toBe(thenStep);
    expect(findStepById([ifStep], 'otherwise-step')).toBe(otherwiseStep);
  });

  it('recurses into a repeat block’s inner steps', () => {
    const inner = askAgent('inner');
    const repeatStep: AutomationStep = {
      id: 'r1',
      kind: 'repeat',
      items: { stepId: 'trigger', output: 'x' },
      steps: [inner],
    };
    expect(findStepById([repeatStep], 'inner')).toBe(inner);
  });
});
