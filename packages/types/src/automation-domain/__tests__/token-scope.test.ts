import { describe, expect, it } from 'vitest';
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep } from '../../automation.js';
import { scopeAt } from '../token-scope.js';

function askAgent(id: string, extra: Partial<AutomationStep> = {}): AutomationStep {
  return { id, kind: 'ask_agent', prompt: [], ...extra } as AutomationStep;
}

function def(steps: AutomationStep[]): AutomationDefinition {
  return { triggers: [], steps };
}

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
