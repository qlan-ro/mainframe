import { describe, expect, it } from 'vitest';
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep } from '../../contract';
import { builtinTokens, scopeAt, stepProduces, triggerTokens } from '../tokens';

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

function def(steps: AutomationStep[]): AutomationDefinition {
  return { triggers: [], steps };
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

describe('scopeAt — the invisible rule made concrete', () => {
  it('a step only sees tokens produced by steps ABOVE it (later-step tokens stay invisible)', () => {
    const definition = def([askAgent('first'), askAgent('second')]);
    const scopeBeforeFirst = scopeAt(definition, [], 'first');
    expect(scopeBeforeFirst.some((t) => t.ref.stepId === 'second')).toBe(false);
    expect(scopeBeforeFirst.some((t) => t.ref.stepId === 'first')).toBe(false);

    const scopeBeforeSecond = scopeAt(definition, [], 'second');
    expect(scopeBeforeSecond.some((t) => t.ref.stepId === 'first' && t.ref.output === 'result')).toBe(true);
  });

  it('always includes built-ins and trigger tokens, regardless of position', () => {
    const definition: AutomationDefinition = {
      triggers: [{ id: 't1', kind: 'event', event: 'session.finished' }],
      steps: [askAgent('only')],
    };
    const scope = scopeAt(definition, [], 'only');
    expect(scope.some((t) => t.ref.stepId === 'builtin' && t.ref.output === 'today')).toBe(true);
    expect(scope.some((t) => t.ref.stepId === 'trigger' && t.ref.output === 'result')).toBe(true);
  });

  it('If-branch outputs leak to later siblings after the block closes', () => {
    const ifStep: AutomationStep = {
      id: 'if1',
      kind: 'if',
      match: 'all',
      conditions: [],
      then: [askAgent('inside-then')],
      otherwise: [askAgent('inside-otherwise')],
    };
    const after = askAgent('after');
    const definition = def([ifStep, after]);

    const scope = scopeAt(definition, [], 'after');
    expect(scope.some((t) => t.ref.stepId === 'inside-then')).toBe(true);
    expect(scope.some((t) => t.ref.stepId === 'inside-otherwise')).toBe(true);
  });

  it('a step inside the then branch does NOT see tokens from the otherwise branch', () => {
    const ifStep: AutomationStep = {
      id: 'if1',
      kind: 'if',
      match: 'all',
      conditions: [],
      then: [askAgent('in-then')],
      otherwise: [askAgent('in-otherwise')],
    };
    const definition = def([ifStep]);
    const scope = scopeAt(definition, [], 'in-then');
    expect(scope.some((t) => t.ref.stepId === 'in-otherwise')).toBe(false);
  });

  it('Repeat is isolated: Current item is visible only inside its own steps, and never leaks after', () => {
    const repeatStep: AutomationStep = {
      id: 'r1',
      kind: 'repeat',
      items: { stepId: 'source', output: 'items' },
      steps: [askAgent('inner')],
    };
    const sourceCatalog: ActionCatalogEntry[] = [
      {
        id: 'list_action',
        title: 'List things',
        group: 'builtin',
        auth: 'none',
        paramsSchema: {},
        outputs: [{ name: 'items', type: 'list' }],
      },
    ];
    const sourceStep: AutomationStep = { id: 'source', kind: 'run_action', actionId: 'list_action', params: {} };
    const after = askAgent('after');
    const definition = def([sourceStep, repeatStep, after]);

    const insideScope = scopeAt(definition, sourceCatalog, 'inner');
    expect(insideScope.some((t) => t.ref.stepId === 'current' && t.ref.output === 'item')).toBe(true);

    const afterScope = scopeAt(definition, sourceCatalog, 'after');
    expect(afterScope.some((t) => t.ref.stepId === 'current')).toBe(false);
    expect(afterScope.some((t) => t.ref.stepId === 'inner')).toBe(false);
  });

  it('Current item carries the field shape of the chosen list token, when known (contract §5: github.list_prs items)', () => {
    const sourceCatalog: ActionCatalogEntry[] = [
      {
        id: 'github.list_prs',
        title: 'List my open PRs',
        group: 'connector',
        auth: 'token',
        paramsSchema: {},
        outputs: [{ name: 'prs', type: 'list' }],
      },
    ];
    const sourceStep: AutomationStep = { id: 'list-prs', kind: 'run_action', actionId: 'github.list_prs', params: {} };
    const repeatStep: AutomationStep = {
      id: 'r1',
      kind: 'repeat',
      items: { stepId: 'list-prs', output: 'prs' },
      steps: [askAgent('inner')],
    };
    const definition = def([sourceStep, repeatStep]);
    const scope = scopeAt(definition, sourceCatalog, 'inner');
    const current = scope.find((t) => t.ref.stepId === 'current');
    expect(current?.fields).toEqual(['url', 'title', 'number', 'author']);
  });
});
