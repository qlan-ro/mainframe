// packages/core/src/__tests__/automations/definition-schema.test.ts
import { describe, it, expect } from 'vitest';
import { AutomationDefinitionSchema, StepSchema, TriggerSchema } from '../../automations/definition/schema.js';
import { loadFixture } from '../../automations/testing/fixtures.js';

const FIXTURE_NAMES = [
  'daily-health-log',
  'daily-standup',
  'pr-auto-review',
  'morning-pr-sweep',
  'ship-work',
  'daily-feature-spike',
] as const;

describe('AutomationDefinitionSchema', () => {
  it.each(FIXTURE_NAMES)('parses the %s fixture', (name) => {
    const definition = loadFixture(name);
    expect(() => AutomationDefinitionSchema.parse(definition)).not.toThrow();
  });

  it('rejects an unknown step kind', () => {
    const def = { triggers: [], steps: [{ id: 'x', kind: 'not_a_kind' }] };
    expect(() => AutomationDefinitionSchema.parse(def)).toThrow();
  });

  it('rejects an empty step id', () => {
    const def = { triggers: [], steps: [{ id: '', kind: 'notify', message: ['hi'] }] };
    expect(() => AutomationDefinitionSchema.parse(def)).toThrow();
  });

  it('rejects a bad comparator', () => {
    const def = {
      triggers: [],
      steps: [
        {
          id: 'if-1',
          kind: 'if',
          match: 'all',
          conditions: [{ token: { stepId: 'builtin', output: 'today' }, comparator: 'nope', value: '1' }],
          then: [],
          otherwise: [],
        },
      ],
    };
    expect(() => AutomationDefinitionSchema.parse(def)).toThrow();
  });

  it('rejects is_one_of without an array value', () => {
    const def = {
      triggers: [],
      steps: [
        {
          id: 'if-1',
          kind: 'if',
          match: 'all',
          conditions: [{ token: { stepId: 'builtin', output: 'today' }, comparator: 'is_one_of', value: 'xs' }],
          then: [],
          otherwise: [],
        },
      ],
    };
    expect(() => AutomationDefinitionSchema.parse(def)).toThrow();
  });

  it('accepts is_one_of with an array value', () => {
    const def = {
      triggers: [],
      steps: [
        {
          id: 'if-1',
          kind: 'if',
          match: 'all',
          conditions: [{ token: { stepId: 'builtin', output: 'today' }, comparator: 'is_one_of', value: ['xs', 's'] }],
          then: [],
          otherwise: [],
        },
      ],
    };
    expect(() => AutomationDefinitionSchema.parse(def)).not.toThrow();
  });

  it('rejects an every_n_hours schedule whose n does not divide 24', () => {
    const def = {
      triggers: [{ id: 't1', kind: 'schedule', schedule: { type: 'every_n_hours', n: 5 }, onMissed: 'skip' }],
      steps: [{ id: 'notify-1', kind: 'notify', message: ['hi'] }],
    };
    expect(() => AutomationDefinitionSchema.parse(def)).toThrow();
  });

  it('accepts an every_n_hours schedule whose n divides 24', () => {
    const def = {
      triggers: [{ id: 't1', kind: 'schedule', schedule: { type: 'every_n_hours', n: 6 }, onMissed: 'skip' }],
      steps: [{ id: 'notify-1', kind: 'notify', message: ['hi'] }],
    };
    expect(() => AutomationDefinitionSchema.parse(def)).not.toThrow();
  });

  it('rejects malformed ChipText (non-array, and an array element that is neither a string nor a token)', () => {
    expect(() =>
      AutomationDefinitionSchema.parse({
        triggers: [],
        steps: [{ id: 'notify-1', kind: 'notify', message: 'not-an-array' }],
      }),
    ).toThrow();

    expect(() =>
      AutomationDefinitionSchema.parse({
        triggers: [],
        steps: [{ id: 'notify-1', kind: 'notify', message: [{ nope: true }] }],
      }),
    ).toThrow();
  });

  it('StepSchema and TriggerSchema validate a single step/trigger in isolation', () => {
    expect(() => StepSchema.parse({ id: 'notify-1', kind: 'notify', message: ['hi'] })).not.toThrow();
    expect(() =>
      TriggerSchema.parse({ id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '09:00' }, onMissed: 'skip' }),
    ).not.toThrow();
  });
});
