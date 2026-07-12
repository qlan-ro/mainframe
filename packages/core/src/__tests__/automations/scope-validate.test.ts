// packages/core/src/__tests__/automations/scope-validate.test.ts
import { describe, it, expect } from 'vitest';
import type { AutomationDefinition, AutomationStep } from '@qlan-ro/mainframe-types';
import { validateScopes } from '../../automations/definition/validate.js';
import { loadFixture, type FixtureName } from '../../automations/testing/fixtures.js';

function def(steps: AutomationStep[]): AutomationDefinition {
  return { triggers: [], steps };
}

describe('validateScopes', () => {
  it('rejects a forward reference to a step that has not run yet', () => {
    const errors = validateScopes(
      def([
        { id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'ask-1', output: 'answer' } }] },
        { id: 'ask-1', kind: 'ask_me', title: 'Q', fields: [{ key: 'answer', type: 'text' }] },
      ]),
    );
    expect(errors).toContainEqual(expect.objectContaining({ stepId: 'notify-1' }));
  });

  it('rejects a reference to a step id that never exists', () => {
    const errors = validateScopes(
      def([{ id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'ghost', output: 'x' } }] }]),
    );
    expect(errors).toContainEqual(expect.objectContaining({ stepId: 'notify-1' }));
  });

  it('rejects `current` used outside a Repeat block', () => {
    const errors = validateScopes(
      def([{ id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'current', output: 'item' } }] }]),
    );
    expect(errors).toContainEqual(expect.objectContaining({ stepId: 'notify-1' }));
  });

  it('allows `current` inside a Repeat block', () => {
    const errors = validateScopes(
      def([
        { id: 'list-prs', kind: 'run_action', actionId: 'github.list_prs', params: {} },
        {
          id: 'repeat-1',
          kind: 'repeat',
          items: { stepId: 'list-prs', output: 'prs' },
          steps: [
            {
              id: 'notify-1',
              kind: 'notify',
              message: [{ token: { stepId: 'current', output: 'item', field: 'url' } }],
            },
          ],
        },
      ]),
    );
    expect(errors).toEqual([]);
  });

  it('makes If-branch step outputs visible to later siblings after the block', () => {
    const errors = validateScopes(
      def([
        {
          id: 'if-1',
          kind: 'if',
          match: 'all',
          conditions: [{ token: { stepId: 'builtin', output: 'today' }, comparator: 'not_empty' }],
          then: [{ id: 'create-item', kind: 'run_action', actionId: 'ado.create_item', params: {} }],
          otherwise: [],
        },
        { id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'create-item', output: 'workItemId' } }] },
      ]),
    );
    expect(errors).toEqual([]);
  });

  it('does not expose Repeat inner-step outputs after the block', () => {
    const errors = validateScopes(
      def([
        { id: 'list-prs', kind: 'run_action', actionId: 'github.list_prs', params: {} },
        {
          id: 'repeat-1',
          kind: 'repeat',
          items: { stepId: 'list-prs', output: 'prs' },
          steps: [{ id: 'ask-review', kind: 'ask_agent', prompt: ['review'] }],
        },
        { id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'ask-review', output: 'result' } }] },
      ]),
    );
    expect(errors).toContainEqual(expect.objectContaining({ stepId: 'notify-1' }));
  });

  it('rejects duplicate step ids', () => {
    const errors = validateScopes(
      def([
        { id: 'dup', kind: 'notify', message: ['a'] },
        { id: 'dup', kind: 'notify', message: ['b'] },
      ]),
    );
    expect(errors).toContainEqual(expect.objectContaining({ stepId: 'dup' }));
  });

  it('rejects an unknown actionId output name when a catalog is provided', () => {
    const errors = validateScopes(
      def([
        { id: 'read-1', kind: 'run_action', actionId: 'files.read', params: {} },
        { id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'read-1', output: 'path' } }] },
      ]),
      { 'files.read': ['content'] },
    );
    expect(errors).toContainEqual(expect.objectContaining({ stepId: 'notify-1' }));
  });

  it('accepts a known actionId output name when a catalog is provided', () => {
    const errors = validateScopes(
      def([
        { id: 'read-1', kind: 'run_action', actionId: 'files.read', params: {} },
        { id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'read-1', output: 'content' } }] },
      ]),
      { 'files.read': ['content'] },
    );
    expect(errors).toEqual([]);
  });

  it('skips run_action output-name checks when no catalog is provided', () => {
    const errors = validateScopes(
      def([
        { id: 'read-1', kind: 'run_action', actionId: 'files.read', params: {} },
        { id: 'notify-1', kind: 'notify', message: [{ token: { stepId: 'read-1', output: 'anything' } }] },
      ]),
    );
    expect(errors).toEqual([]);
  });

  it('keeps `trigger` and `builtin` always in scope', () => {
    const errors = validateScopes(
      def([
        {
          id: 'notify-1',
          kind: 'notify',
          message: [
            { token: { stepId: 'builtin', output: 'today' } },
            { token: { stepId: 'trigger', output: 'result' } },
          ],
        },
      ]),
    );
    expect(errors).toEqual([]);
  });

  const FIXTURE_NAMES: FixtureName[] = [
    'daily-health-log',
    'daily-standup',
    'pr-auto-review',
    'morning-pr-sweep',
    'ship-work',
    'daily-feature-spike',
  ];

  it.each(FIXTURE_NAMES)('has no scope errors on the %s fixture', (name) => {
    expect(validateScopes(loadFixture(name))).toEqual([]);
  });
});
