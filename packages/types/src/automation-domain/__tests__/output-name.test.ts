import { describe, expect, it } from 'vitest';
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep } from '../../automation.js';
import { mintOutputNames, variableNamesClashingWith, variableNamesInDefinition } from '../output-name.js';
import { scopeAt } from '../token-scope.js';
import { buildVariableNamespace } from '../variables.js';

function askAgent(id: string, outputName?: string): AutomationStep {
  return outputName === undefined
    ? { id, kind: 'ask_agent', prompt: [] }
    : { id, kind: 'ask_agent', prompt: [], outputName };
}

function setValue(id: string, name: string): AutomationStep {
  return { id, kind: 'set_variable', name, value: ['x'] };
}

function notify(id: string, message: string): AutomationStep {
  return { id, kind: 'notify', message: [message] };
}

function outputNameOf(definition: AutomationDefinition, stepId: string): string | undefined {
  let found: string | undefined;
  const walk = (steps: AutomationStep[]) => {
    for (const step of steps) {
      if (step.id === stepId && step.kind === 'ask_agent') found = step.outputName;
      if (step.kind === 'if') {
        walk(step.then);
        walk(step.otherwise);
      }
      if (step.kind === 'repeat') walk(step.steps);
    }
  };
  walk(definition.steps);
  return found;
}

/** What `$agent_result` in the notify step resolves to — the question the whole ordinal model exists to keep stable. */
function stepBoundTo(definition: AutomationDefinition, atStepId: string, name: string): string | undefined {
  return buildVariableNamespace(scopeAt(definition, [], atStepId)).byName.get(name)?.ref.stepId;
}

describe('mintOutputNames', () => {
  it('gives the first producer the bare name', () => {
    const minted = mintOutputNames({ triggers: [], steps: [askAgent('a1')] }, []);
    expect(outputNameOf(minted, 'a1')).toBe('agent_result');
  });

  it('leaves a definition with nothing to mint untouched, by identity', () => {
    const definition: AutomationDefinition = { triggers: [], steps: [askAgent('a1', 'agent_result')] };
    expect(mintOutputNames(definition, [])).toBe(definition);
  });

  it('never re-mints a stored name, so a second pass is a no-op', () => {
    const once = mintOutputNames({ triggers: [], steps: [askAgent('a1'), askAgent('a2')] }, []);
    expect(mintOutputNames(once, [])).toBe(once);
  });

  it('waits for a step to actually produce something — an action with no chosen id gets no name', () => {
    const minted = mintOutputNames(
      { triggers: [], steps: [{ id: 'r1', kind: 'run_action', actionId: '', params: {} }] },
      [],
    );
    expect(minted.steps[0]).toEqual({ id: 'r1', kind: 'run_action', actionId: '', params: {} });
  });

  it('avoids a name a set-value step already claims', () => {
    const minted = mintOutputNames({ triggers: [], steps: [setValue('v1', 'agent_result'), askAgent('a1')] }, []);
    expect(outputNameOf(minted, 'a1')).toBe('agent_result_2');
  });
});

/**
 * M1: the repro from the review. An agent step and a notification reading its
 * result; a second agent step is then inserted *above* it. Before ordinals, the
 * newcomer took `agent_result` and the notification silently started reporting
 * the wrong step's output.
 */
describe('inserting a producer above an existing one', () => {
  const original = mintOutputNames({ triggers: [], steps: [askAgent('a1'), notify('n1', 'Ship $agent_result')] }, []);

  const withInsert = mintOutputNames({ ...original, steps: [askAgent('a0'), ...original.steps] }, []);

  it('leaves the incumbent holding the bare name', () => {
    expect(outputNameOf(withInsert, 'a1')).toBe('agent_result');
  });

  it('suffixes the newcomer even though it now comes first', () => {
    expect(outputNameOf(withInsert, 'a0')).toBe('agent_result_2');
  });

  it("keeps the notification's $agent_result pointing at the step it always meant", () => {
    expect(stepBoundTo(original, 'n1', 'agent_result')).toBe('a1');
    expect(stepBoundTo(withInsert, 'n1', 'agent_result')).toBe('a1');
  });
});

/**
 * A legacy definition — no stored names anywhere — has to mint exactly the
 * names it already rendered, or every `$agent_result` in a saved automation
 * rebinds on load. The naming walk is `scopeAt`'s for that reason: the agent
 * inside the repeat body never leaves it, so the top-level agent stays bare.
 */
describe('minting a pre-outputName definition', () => {
  const legacy: AutomationDefinition = {
    triggers: [],
    steps: [
      { id: 'r1', kind: 'repeat', items: { stepId: 'nothing', output: 'items' }, steps: [askAgent('inside')] },
      askAgent('after-block'),
    ],
  };
  const minted = mintOutputNames(legacy, []);

  it('names the top-level agent bare, as the runtime already did', () => {
    expect(outputNameOf(minted, 'after-block')).toBe('agent_result');
  });

  it('names the repeat-body agent bare too — the two never share a scope', () => {
    expect(outputNameOf(minted, 'inside')).toBe('agent_result');
  });
});

/**
 * M6: both `if` arms are validated against the same pre-branch scope, but both
 * leak into scope after the block. Sharing one namespace across the arms is
 * what keeps the `otherwise` arm addressable — first-wins used to render it as
 * an empty string.
 */
describe('if branches share one namespace', () => {
  const minted = mintOutputNames(
    {
      triggers: [],
      steps: [
        {
          id: 'if1',
          kind: 'if',
          match: 'all',
          conditions: [],
          then: [askAgent('then-agent')],
          otherwise: [askAgent('else-agent')],
        },
        notify('n1', 'done'),
      ],
    },
    [],
  );

  it('gives the two arms distinct names', () => {
    expect(outputNameOf(minted, 'then-agent')).toBe('agent_result');
    expect(outputNameOf(minted, 'else-agent')).toBe('agent_result_2');
  });

  it('leaves both reachable from a step after the block', () => {
    expect(stepBoundTo(minted, 'n1', 'agent_result')).toBe('then-agent');
    expect(stepBoundTo(minted, 'n1', 'agent_result_2')).toBe('else-agent');
  });
});

describe('variableNamesClashingWith', () => {
  it('puts the two if arms in one region — neither can define a name the other has', () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'if1',
          kind: 'if',
          match: 'all',
          conditions: [],
          then: [setValue('v-then', 'summary')],
          otherwise: [setValue('v-else', 'summary')],
        },
      ],
    };
    expect(variableNamesClashingWith(definition, [], 'v-then').has('summary')).toBe(true);
    expect(variableNamesClashingWith(definition, [], 'v-else').has('summary')).toBe(true);
  });

  it('keeps two sibling repeat bodies apart — the runtime isolates them, so the name is free', () => {
    const body = (id: string): AutomationStep => ({
      id,
      kind: 'repeat',
      items: { stepId: 'nothing', output: 'items' },
      steps: [setValue(`${id}-v`, 'notes')],
    });
    const definition: AutomationDefinition = { triggers: [], steps: [body('r1'), body('r2')] };
    expect(variableNamesClashingWith(definition, [], 'r1-v').has('notes')).toBe(false);
  });

  it('still counts the enclosing regions from inside a repeat body', () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        setValue('v1', 'notes'),
        { id: 'r1', kind: 'repeat', items: { stepId: 'nothing', output: 'items' }, steps: [setValue('v2', 'row')] },
      ],
    };
    expect(variableNamesClashingWith(definition, [], 'v2').has('notes')).toBe(true);
  });

  it("does not count the step's own name", () => {
    const definition: AutomationDefinition = { triggers: [], steps: [setValue('v1', 'notes')] };
    expect(variableNamesClashingWith(definition, [], 'v1').has('notes')).toBe(false);
  });
});

describe('variableNamesInDefinition', () => {
  const definition: AutomationDefinition = {
    triggers: [],
    steps: [
      setValue('v1', 'summary'),
      {
        id: 'if1',
        kind: 'if',
        match: 'all',
        conditions: [],
        then: [setValue('v2', 'notes')],
        otherwise: [askAgent('a1', 'agent_result')],
      },
      { id: 'r1', kind: 'repeat', items: { stepId: 'nothing', output: 'items' }, steps: [setValue('v3', 'row')] },
    ],
  };

  it('collects every name at every depth, in scope or not', () => {
    expect([...variableNamesInDefinition(definition, [])].sort()).toEqual([
      'agent_chat_id',
      'agent_result',
      'notes',
      'row',
      'summary',
    ]);
  });

  it('skips the named step, so a step can be checked against everything else', () => {
    expect(variableNamesInDefinition(definition, [], 'v1').has('summary')).toBe(false);
    expect(variableNamesInDefinition(definition, [], 'v1').has('notes')).toBe(true);
  });

  it('still reports a name two steps share when one of them is skipped', () => {
    const duplicated: AutomationDefinition = {
      triggers: [],
      steps: [setValue('v1', 'summary'), setValue('v2', 'summary')],
    };
    expect(variableNamesInDefinition(duplicated, [], 'v1').has('summary')).toBe(true);
    expect(variableNamesInDefinition(duplicated, [], 'v2').has('summary')).toBe(true);
  });

  it("reads an action's outputs through the catalog", () => {
    const catalog: ActionCatalogEntry[] = [
      {
        id: 'shell.run',
        title: 'Run a command',
        group: 'builtin',
        auth: 'none',
        paramsSchema: {},
        outputs: [{ name: 'output', type: 'text' }],
      },
    ];
    const withAction: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'r1', kind: 'run_action', actionId: 'shell.run', params: {} }],
    };
    expect([...variableNamesInDefinition(withAction, catalog)]).toEqual(['output']);
  });
});
