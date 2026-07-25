import { describe, expect, it } from 'vitest';
import type { AutomationDefinition, AutomationStep } from '../../automation.js';
import { chipTextToText, textToChipText } from '../chip-text-convert.js';
import { scopeAt } from '../token-scope.js';
import { buildVariableNamespace } from '../variables.js';

function askAgent(id: string): AutomationStep {
  return { id, kind: 'ask_agent', prompt: [] };
}

function namespaceAt(definition: AutomationDefinition, stepId: string) {
  return buildVariableNamespace(scopeAt(definition, [], stepId));
}

describe('chipTextToText', () => {
  const definition: AutomationDefinition = {
    triggers: [{ id: 't1', kind: 'webhook', hookId: 'h1' }],
    steps: [askAgent('a1'), askAgent('a2'), { id: 'n1', kind: 'notify', message: [] }],
  };
  const { nameFor } = namespaceAt(definition, 'n1');

  it('passes text parts through untouched', () => {
    expect(chipTextToText(['Ship it ', 'today'], nameFor)).toBe('Ship it today');
  });

  it('renders a token part as its assigned name', () => {
    expect(chipTextToText(['Ship ', { token: { stepId: 'a1', output: 'result' } }], nameFor)).toBe('Ship $agent_result');
  });

  it("carries a ref's dug field over as the dotted path", () => {
    expect(chipTextToText([{ token: { stepId: 'trigger', output: 'payload', field: 'pr.title' } }], nameFor)).toBe(
      '$trigger_payload.pr.title',
    );
  });

  it('keeps two agent steps distinct — the earlier one keeps the bare name', () => {
    expect(chipTextToText([{ token: { stepId: 'a1', output: 'result' } }], nameFor)).toBe('$agent_result');
    expect(chipTextToText([{ token: { stepId: 'a2', output: 'result' } }], nameFor)).toBe('$agent_result_2');
  });

  it('converts a ref to a deleted step into a plain sanitized name, which validation then reports as unknown', () => {
    expect(chipTextToText([{ token: { stepId: 'deleted', output: 'prUrl' } }], nameFor)).toBe('$pr_url');
  });
});

describe('textToChipText', () => {
  it('wraps text in a single part', () => {
    expect(textToChipText('Ship $release_notes')).toEqual(['Ship $release_notes']);
  });

  it('renders empty text as no parts, matching how the contract already spells an empty field', () => {
    expect(textToChipText('')).toEqual([]);
  });
});
