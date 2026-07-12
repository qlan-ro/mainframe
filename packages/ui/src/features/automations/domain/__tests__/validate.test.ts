import { describe, expect, it } from 'vitest';
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep } from '../../contract';
import { FEATURE_SPIKE_FIXTURE } from '../../fixtures/fixtures';
import { validate } from '../validate';

function askAgent(id: string): AutomationStep {
  return { id, kind: 'ask_agent', prompt: [] };
}

const NO_CATALOG: ActionCatalogEntry[] = [];

describe('validate — fixture 6 sanity (the reference happy path)', () => {
  it('daily-feature-spike has no issues', () => {
    expect(validate(FEATURE_SPIKE_FIXTURE.name, FEATURE_SPIKE_FIXTURE.definition, NO_CATALOG)).toEqual([]);
  });
});

describe('validate — automation-level issues', () => {
  it('flags a missing name, unpinned to any step', () => {
    const issues = validate('', { triggers: [], steps: [askAgent('a')] }, NO_CATALOG);
    expect(issues).toContainEqual({ stepId: null, level: 'error', msg: 'Give your automation a name.' });
  });

  it('flags an empty recipe', () => {
    const issues = validate('My automation', { triggers: [], steps: [] }, NO_CATALOG);
    expect(issues).toContainEqual({ stepId: null, level: 'error', msg: 'Add at least one step.' });
  });
});

describe('validate — out-of-scope token usage, pinned to the offending step', () => {
  it('flags a token used before its producer, naming the producing step and the offending stepId', () => {
    const usesLater: AutomationStep = {
      id: 'notify-1',
      kind: 'notify',
      message: [{ token: { stepId: 'later-step', output: 'result' } }],
    };
    const definition: AutomationDefinition = { triggers: [], steps: [usesLater, askAgent('later-step')] };
    const issues = validate('Name', definition, NO_CATALOG);
    expect(issues).toContainEqual({
      stepId: 'notify-1',
      level: 'error',
      msg: 'This step uses "Result" from "Ask agent", which isn\'t available here.',
    });
  });

  it('flags a Repeat Current-item token referenced outside its own Repeat block', () => {
    const source: AutomationStep = { id: 'src', kind: 'run_action', actionId: 'list_items', params: {} };
    const repeat: AutomationStep = {
      id: 'r1',
      kind: 'repeat',
      items: { stepId: 'src', output: 'items' },
      steps: [askAgent('inner')],
    };
    const after: AutomationStep = {
      id: 'after',
      kind: 'notify',
      message: [{ token: { stepId: 'current', output: 'item' } }],
    };
    const catalog: ActionCatalogEntry[] = [
      {
        id: 'list_items',
        title: 'List items',
        group: 'builtin',
        auth: 'none',
        paramsSchema: {},
        outputs: [{ name: 'items', type: 'list' }],
      },
    ];
    const issues = validate('Name', { triggers: [], steps: [source, repeat, after] }, catalog);
    expect(issues.some((i) => i.stepId === 'after')).toBe(true);
  });
});

describe('validate — Repeat items must be list-typed', () => {
  it('flags a Repeat whose items token resolves to a non-list value (e.g. a freshly-added block defaulting to the first token in scope)', () => {
    const source: AutomationStep = askAgent('src');
    const repeat: AutomationStep = {
      id: 'r1',
      kind: 'repeat',
      items: { stepId: 'src', output: 'result' },
      steps: [],
    };
    const issues = validate('Name', { triggers: [], steps: [source, repeat] }, NO_CATALOG);
    expect(issues).toContainEqual({
      stepId: 'r1',
      level: 'error',
      msg: '"Result" isn\'t a list — pick a value that produces a list to repeat over.',
    });
  });

  it('does not flag a Repeat whose items token is genuinely list-typed', () => {
    const source: AutomationStep = { id: 'src', kind: 'run_action', actionId: 'list_items', params: {} };
    const repeat: AutomationStep = {
      id: 'r1',
      kind: 'repeat',
      items: { stepId: 'src', output: 'items' },
      steps: [],
    };
    const catalog: ActionCatalogEntry[] = [
      {
        id: 'list_items',
        title: 'List items',
        group: 'builtin',
        auth: 'none',
        paramsSchema: {},
        outputs: [{ name: 'items', type: 'list' }],
      },
    ];
    const issues = validate('Name', { triggers: [], steps: [source, repeat] }, catalog);
    expect(issues.some((i) => i.stepId === 'r1')).toBe(false);
  });
});

describe('validate — ask_me field issues', () => {
  it('flags a choice field with no options', () => {
    const step: AutomationStep = {
      id: 'am1',
      kind: 'ask_me',
      title: 'Ask me',
      fields: [{ key: 'mood', type: 'choice', label: 'Mood' }],
    };
    const issues = validate('Name', { triggers: [], steps: [step] }, NO_CATALOG);
    expect(issues).toContainEqual({ stepId: 'am1', level: 'error', msg: '"Mood" is a choice with no options.' });
  });

  it('does not flag a choice field that has options', () => {
    const step: AutomationStep = {
      id: 'am1',
      kind: 'ask_me',
      title: 'Ask me',
      fields: [{ key: 'mood', type: 'choice', label: 'Mood', options: ['good', 'bad'] }],
    };
    const issues = validate('Name', { triggers: [], steps: [step] }, NO_CATALOG);
    expect(issues).toEqual([]);
  });
});

describe('validate — unpicked action', () => {
  it('flags a run_action step with no actionId chosen yet', () => {
    const step: AutomationStep = { id: 'ra1', kind: 'run_action', actionId: '', params: {} };
    const issues = validate('Name', { triggers: [], steps: [step] }, NO_CATALOG);
    expect(issues).toContainEqual({ stepId: 'ra1', level: 'error', msg: 'Choose an action for this step.' });
  });

  it('does not flag a run_action step once an actionId is chosen', () => {
    const step: AutomationStep = { id: 'ra1', kind: 'run_action', actionId: 'run_command', params: {} };
    const issues = validate('Name', { triggers: [], steps: [step] }, NO_CATALOG);
    expect(issues.some((i) => i.stepId === 'ra1')).toBe(false);
  });
});

describe('validate — missing producer', () => {
  it('flags a token whose stepId no longer exists anywhere in the definition, with distinct wording from out-of-scope', () => {
    const step: AutomationStep = {
      id: 'n1',
      kind: 'notify',
      message: [{ token: { stepId: 'deleted-step', output: 'result' } }],
    };
    const issues = validate('Name', { triggers: [], steps: [step] }, NO_CATALOG);
    expect(issues).toContainEqual({
      stepId: 'n1',
      level: 'error',
      msg: 'This step uses a value that no longer exists — pick a new one.',
    });
  });
});
