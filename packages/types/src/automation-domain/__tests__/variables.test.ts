import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AutomationDefinition, AutomationStep, TokenRef } from '../../automation.js';
import { scopeAt } from '../token-scope.js';
import type { TokenDescriptor, TokenSourceKind } from '../tokens.js';
import {
  buildVariableNamespace,
  extractVariableRefs,
  renameVariableInDefinition,
  renameVariableRefs,
  renderVariableText,
  variableNameFor,
} from '../variables.js';

function descriptor(ref: TokenRef, sourceKind: TokenSourceKind, label = 'Label'): TokenDescriptor {
  return { ref, label, type: 'text', sourceKind, source: 'Source' };
}

function askAgent(id: string): AutomationStep {
  return { id, kind: 'ask_agent', prompt: [] };
}

describe('extractVariableRefs', () => {
  it('finds a bare name and leaves a trailing period as text', () => {
    expect(extractVariableRefs('Ship $release_notes. Now')).toEqual([
      { name: 'release_notes', path: [], start: 5, end: 19 },
    ]);
  });

  it('consumes a dotted path', () => {
    expect(extractVariableRefs('Dig $trigger_payload.pr.title x')).toEqual([
      { name: 'trigger_payload', path: ['pr', 'title'], start: 4, end: 29 },
    ]);
  });

  it('rejects a name starting with a digit', () => {
    expect(extractVariableRefs('cost $1abc')).toEqual([]);
  });

  it('rejects a mid-word dollar sign', () => {
    expect(extractVariableRefs('a$b')).toEqual([]);
  });

  it('rejects a dollar sign glued to punctuation — only a whitespace or string start opens a ref', () => {
    expect(extractVariableRefs('https://example.test/$repo')).toEqual([]);
    expect(extractVariableRefs('($name)')).toEqual([]);
  });

  it('finds every ref in a multi-ref string', () => {
    const refs = extractVariableRefs('$a then $b');
    expect(refs.map((r) => r.name)).toEqual(['a', 'b']);
  });
});

describe('variableNameFor', () => {
  it('names built-ins by their output', () => {
    expect(variableNameFor(descriptor({ stepId: 'builtin', output: 'now' }, 'builtin'))).toBe('now');
  });

  it('prefixes the trigger outputs and snake-cases them', () => {
    expect(variableNameFor(descriptor({ stepId: 'trigger', output: 'result' }, 'trigger'))).toBe('trigger_result');
    expect(variableNameFor(descriptor({ stepId: 'trigger', output: 'chatId' }, 'trigger'))).toBe('trigger_chat_id');
    expect(variableNameFor(descriptor({ stepId: 'trigger', output: 'payload' }, 'trigger'))).toBe('trigger_payload');
  });

  it("prefixes an agent's implicit outputs but leaves its declared expects keys alone", () => {
    expect(variableNameFor(descriptor({ stepId: 's1', output: 'result' }, 'agent'))).toBe('agent_result');
    expect(variableNameFor(descriptor({ stepId: 's1', output: 'chatId' }, 'agent'))).toBe('agent_chat_id');
    expect(variableNameFor(descriptor({ stepId: 's1', output: 'pr_list' }, 'agent'))).toBe('pr_list');
  });

  it('uses ask-me field keys and action output keys as authored', () => {
    expect(variableNameFor(descriptor({ stepId: 's1', output: 'audience' }, 'askme'))).toBe('audience');
    expect(variableNameFor(descriptor({ stepId: 's1', output: 'prUrl' }, 'action'))).toBe('pr_url');
  });

  it("names the repeat block's current item `item`", () => {
    expect(variableNameFor(descriptor({ stepId: 'current', output: 'item' }, 'item'))).toBe('item');
  });

  it("names a set-variable step by the user's chosen name", () => {
    expect(variableNameFor(descriptor({ stepId: 's1', output: 'value' }, 'variable', 'release_notes'))).toBe(
      'release_notes',
    );
  });

  it('sanitizes lossily: lowercased, non-identifier characters folded to underscore, digit-leading prefixed', () => {
    expect(variableNameFor(descriptor({ stepId: 's1', output: 'PR list' }, 'askme'))).toBe('pr_list');
    expect(variableNameFor(descriptor({ stepId: 's1', output: 'pr-list' }, 'askme'))).toBe('pr_list');
    expect(variableNameFor(descriptor({ stepId: 's1', output: '2nd choice' }, 'askme'))).toBe('_2nd_choice');
  });
});

describe('buildVariableNamespace', () => {
  it('suffixes later holders of a colliding derived name, leaving the first one bare', () => {
    const first = descriptor({ stepId: 'a1', output: 'result' }, 'agent');
    const second = descriptor({ stepId: 'a2', output: 'result' }, 'agent');
    const namespace = buildVariableNamespace([first, second]);
    expect(namespace.byName.get('agent_result')?.ref.stepId).toBe('a1');
    expect(namespace.byName.get('agent_result_2')?.ref.stepId).toBe('a2');
  });

  it('suffixes lossy-sanitization collisions the same way', () => {
    const namespace = buildVariableNamespace([
      descriptor({ stepId: 'q1', output: 'PR list' }, 'askme'),
      descriptor({ stepId: 'q1', output: 'pr-list' }, 'askme'),
    ]);
    expect(namespace.byName.get('pr_list')?.ref.output).toBe('PR list');
    expect(namespace.byName.get('pr_list_2')?.ref.output).toBe('pr-list');
  });

  it('never suffixes a duplicate set-variable name — the first occurrence wins and the second is unaddressable', () => {
    const namespace = buildVariableNamespace([
      descriptor({ stepId: 'v1', output: 'value' }, 'variable', 'notes'),
      descriptor({ stepId: 'v2', output: 'value' }, 'variable', 'notes'),
    ]);
    expect(namespace.byName.get('notes')?.ref.stepId).toBe('v1');
    expect(namespace.byName.has('notes_2')).toBe(false);
    expect(namespace.nameFor({ stepId: 'v2', output: 'value' })).toBeNull();
  });

  it('answers the inverse lookup, ignoring a ref field suffix', () => {
    const namespace = buildVariableNamespace([descriptor({ stepId: 'trigger', output: 'payload' }, 'trigger')]);
    expect(namespace.nameFor({ stepId: 'trigger', output: 'payload', field: 'pr.title' })).toBe('trigger_payload');
    expect(namespace.nameFor({ stepId: 'nope', output: 'payload' })).toBeNull();
  });
});

/**
 * The naming walk is `scopeAt`'s, not a flat sweep over every step in the
 * document. A flat sweep would reach the repeat body's agent first and name the
 * later top-level agent `agent_result_2` — so `$agent_result` in a step after
 * the block would substitute the wrong step's value at run time. The Rust
 * `NameIndex` (tokens/variables.rs) pins the identical two cases.
 */
describe('buildVariableNamespace over scopeAt — repeat isolation', () => {
  const definition: AutomationDefinition = {
    triggers: [],
    steps: [
      { id: 'r1', kind: 'repeat', items: { stepId: 'nothing', output: 'items' }, steps: [askAgent('inside')] },
      askAgent('after-block'),
      askAgent('target'),
    ],
  };

  it('names the top-level agent `agent_result` after the block, because the body agent is out of scope', () => {
    const namespace = buildVariableNamespace(scopeAt(definition, [], 'target'));
    expect(namespace.byName.get('agent_result')?.ref.stepId).toBe('after-block');
    expect(namespace.byName.has('agent_result_2')).toBe(false);
  });

  it('names the body agent `agent_result` for a step inside the same body', () => {
    const withSecondBodyStep: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'r1',
          kind: 'repeat',
          items: { stepId: 'nothing', output: 'items' },
          steps: [askAgent('inside'), askAgent('inside-target')],
        },
        askAgent('after-block'),
      ],
    };
    const namespace = buildVariableNamespace(scopeAt(withSecondBodyStep, [], 'inside-target'));
    expect(namespace.byName.get('agent_result')?.ref.stepId).toBe('inside');
  });
});

describe('renameVariableRefs', () => {
  it('rewrites the bare ref and the dotted ref but not a longer identifier', () => {
    expect(renameVariableRefs('$old and $old.path and $older', 'old', 'new')).toBe('$new and $new.path and $older');
  });

  it('leaves text without the name untouched', () => {
    expect(renameVariableRefs('nothing here', 'old', 'new')).toBe('nothing here');
  });
});

describe('renameVariableInDefinition', () => {
  it('rewrites every ChipText string part, including inside if and repeat blocks', () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        { id: 'v1', kind: 'set_variable', name: 'other', value: ['seed $old'] },
        {
          id: 'a1',
          kind: 'ask_agent',
          prompt: ['Use $old'],
          worktree: { branchName: ['ship $old'] },
        },
        { id: 'act1', kind: 'run_action', actionId: 'http.request', params: { body: ['ship $old'] } },
        {
          id: 'if1',
          kind: 'if',
          match: 'all',
          conditions: [],
          then: [{ id: 'n1', kind: 'notify', message: ['then $old'] }],
          otherwise: [
            {
              id: 'r1',
              kind: 'repeat',
              items: { stepId: 'a1', output: 'result' },
              steps: [{ id: 'n2', kind: 'notify', message: ['deep $old'] }],
            },
          ],
        },
      ],
    };

    const renamed = renameVariableInDefinition(definition, 'old', 'fresh');

    expect(renamed.steps).toEqual([
      { id: 'v1', kind: 'set_variable', name: 'other', value: ['seed $fresh'] },
      { id: 'a1', kind: 'ask_agent', prompt: ['Use $fresh'], worktree: { branchName: ['ship $fresh'] } },
      { id: 'act1', kind: 'run_action', actionId: 'http.request', params: { body: ['ship $fresh'] } },
      {
        id: 'if1',
        kind: 'if',
        match: 'all',
        conditions: [],
        then: [{ id: 'n1', kind: 'notify', message: ['then $fresh'] }],
        otherwise: [
          {
            id: 'r1',
            kind: 'repeat',
            items: { stepId: 'a1', output: 'result' },
            steps: [{ id: 'n2', kind: 'notify', message: ['deep $fresh'] }],
          },
        ],
      },
    ]);
    expect(definition.steps[1]).toEqual({
      id: 'a1',
      kind: 'ask_agent',
      prompt: ['Use $old'],
      worktree: { branchName: ['ship $old'] },
    });
  });

  it('leaves legacy token parts alone', () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [{ id: 'n1', kind: 'notify', message: [{ token: { stepId: 'trigger', output: 'result' } }, ' $old'] }],
    };
    expect(renameVariableInDefinition(definition, 'old', 'fresh').steps[0]).toEqual({
      id: 'n1',
      kind: 'notify',
      message: [{ token: { stepId: 'trigger', output: 'result' } }, ' $fresh'],
    });
  });
});

/**
 * The same file drives `tokens/substitute.rs`'s parity test. A case that only
 * passes here has caught nothing — the point is that the editor's preview and
 * the daemon's run agree character for character.
 */
describe('renderVariableText — shared substitution fixture', () => {
  interface SubstitutionCase {
    name: string;
    text: string;
    scope: Record<string, unknown>;
    expected: string;
  }
  const cases: SubstitutionCase[] = JSON.parse(
    readFileSync(new URL('../../../fixtures/automations/variable-substitution.json', import.meta.url), 'utf-8'),
  ).cases;

  it('covers the cases the two implementations are most likely to disagree on', () => {
    expect(cases.length).toBeGreaterThanOrEqual(14);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    expect(renderVariableText(testCase.text, testCase.scope)).toBe(testCase.expected);
  });
});
