import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  TOKEN_STEP_TRIGGER,
  TOKEN_STEP_BUILTIN,
  TOKEN_STEP_CURRENT,
  type AutomationDefinition,
  type AutomationCreateInput,
  type AutomationStep,
  type AutomationTrigger,
} from '../automation.js';

describe('reserved TokenRef stepId constants', () => {
  it('are the three reserved values the fixtures rely on', () => {
    expect(TOKEN_STEP_TRIGGER).toBe('trigger');
    expect(TOKEN_STEP_BUILTIN).toBe('builtin');
    expect(TOKEN_STEP_CURRENT).toBe('current');
  });
});

describe('AutomationDefinition compile-time shape', () => {
  it('accepts a definition instantiating every step kind and trigger kind, incl. ask_agent.expects', () => {
    const definition: AutomationDefinition = {
      triggers: [
        { id: 'trigger-schedule', kind: 'schedule', schedule: { type: 'daily', at: '21:00' }, onMissed: 'skip' },
        { id: 'trigger-event', kind: 'event', event: 'automation.finished', automationId: 'other-automation' },
        { id: 'trigger-webhook', kind: 'webhook', hookId: 'pr-opened' },
      ],
      steps: [
        {
          id: 'ask-agent-1',
          kind: 'ask_agent',
          prompt: ['Pick a scope: ', { token: { stepId: TOKEN_STEP_TRIGGER, output: 'payload', field: 'title' } }],
          adapterId: 'claude',
          model: 'sonnet',
          permissionMode: 'default',
          worktree: {
            baseBranch: 'main',
            branchName: ['spike-', { token: { stepId: TOKEN_STEP_BUILTIN, output: 'today' } }],
          },
          autoApprove: ['edits', 'pnpm'],
          timeoutMinutes: 60,
          expects: [{ key: 'scope', type: 'choice', options: ['xs', 's', 'm'] }],
        },
        {
          id: 'ask-me-1',
          kind: 'ask_me',
          title: 'Health check-in',
          fields: [
            { key: 'mood', type: 'choice', options: ['great', 'okay', 'bad'], required: true },
            { key: 'symptoms', type: 'multi', options: ['fever', 'other'] },
            { key: 'symptomsOther', type: 'text', showWhen: { key: 'symptoms', equals: 'other' } },
          ],
        },
        {
          id: 'run-action-1',
          kind: 'run_action',
          actionId: 'files.append',
          params: { path: ['~/log.md'], content: [{ token: { stepId: 'ask-me-1', output: 'mood' } }] },
          outputAs: 'text',
        },
        {
          id: 'notify-1',
          kind: 'notify',
          message: ['Done: ', { token: { stepId: 'ask-agent-1', output: 'result' } }],
        },
        {
          id: 'if-1',
          kind: 'if',
          match: 'all',
          conditions: [
            { token: { stepId: 'ask-agent-1', output: 'scope' }, comparator: 'is_one_of', value: ['xs', 's'] },
          ],
          then: [{ id: 'if-then-notify', kind: 'notify', message: ['in scope'] }],
          otherwise: [{ id: 'if-otherwise-notify', kind: 'notify', message: ['out of scope'], keepGoing: true }],
        },
        {
          id: 'repeat-1',
          kind: 'repeat',
          items: { stepId: 'run-action-1', output: 'items' },
          steps: [
            {
              id: 'repeat-inner-notify',
              kind: 'notify',
              message: [{ token: { stepId: TOKEN_STEP_CURRENT, output: 'item', field: 'url' } }],
            },
          ],
        },
      ],
    };

    expect(definition.triggers).toHaveLength(3);
    expect(definition.steps).toHaveLength(6);
  });
});

// The zod schema (Task 4) doesn't exist yet, so these fixture checks are a
// type-annotated cast (`AutomationCreateInput`) plus targeted runtime
// spot-asserts — not a structural validator. Task 4 supersedes this with
// real parsing.
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'automations');

function loadFixture(name: string): AutomationCreateInput {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw) as AutomationCreateInput;
}

const KNOWN_STEP_KINDS = new Set(['ask_agent', 'ask_me', 'run_action', 'notify', 'if', 'repeat']);
const KNOWN_TRIGGER_KINDS = new Set(['schedule', 'event', 'webhook']);

function assertKnownStepKinds(steps: AutomationStep[]): void {
  for (const step of steps) {
    expect(KNOWN_STEP_KINDS.has(step.kind)).toBe(true);
    expect(step.id.length).toBeGreaterThan(0);
    if (step.kind === 'if') {
      assertKnownStepKinds(step.then);
      assertKnownStepKinds(step.otherwise);
    }
    if (step.kind === 'repeat') {
      assertKnownStepKinds(step.steps);
    }
  }
}

const FIXTURE_NAMES = [
  'daily-health-log',
  'daily-standup',
  'pr-auto-review',
  'morning-pr-sweep',
  'ship-work',
  'daily-feature-spike',
] as const;

describe('canonical automation fixtures (contract §8)', () => {
  it.each(FIXTURE_NAMES)('%s has a well-formed triggers/steps shape', (name) => {
    const fixture = loadFixture(name);
    expect(fixture.name.length).toBeGreaterThan(0);
    expect(['global', 'project']).toContain(fixture.scope);
    expect(Array.isArray(fixture.definition.triggers)).toBe(true);
    expect(fixture.definition.steps.length).toBeGreaterThan(0);
    for (const trigger of fixture.definition.triggers as AutomationTrigger[]) {
      expect(KNOWN_TRIGGER_KINDS.has(trigger.kind)).toBe(true);
    }
    assertKnownStepKinds(fixture.definition.steps);
  });

  it('ship-work is manual-only: empty triggers array, since "manual" is not a trigger kind', () => {
    const fixture = loadFixture('ship-work');
    expect(fixture.definition.triggers).toEqual([]);
  });

  it('daily-feature-spike alone carries all three amendments (A1 run_command chip, A2 expects, A3 is_one_of)', () => {
    const fixture = loadFixture('daily-feature-spike');
    const steps = fixture.definition.steps;

    const askAgent = steps.find((step) => step.kind === 'ask_agent');
    expect(askAgent?.kind).toBe('ask_agent');
    if (askAgent?.kind === 'ask_agent') {
      expect(askAgent.expects).toEqual([{ key: 'scope', type: 'choice', options: ['xs', 's', 'm'] }]);
    }

    const ifBlock = steps.find((step) => step.kind === 'if');
    expect(ifBlock?.kind).toBe('if');
    if (ifBlock?.kind === 'if') {
      const hasIsOneOf = ifBlock.conditions.some(
        (row) => row.comparator === 'is_one_of' && Array.isArray(row.value) && row.value.length > 0,
      );
      expect(hasIsOneOf).toBe(true);

      const runCommandStep = ifBlock.then.find((step) => step.kind === 'run_action' && step.actionId === 'run_command');
      expect(runCommandStep?.kind).toBe('run_action');
      if (runCommandStep?.kind === 'run_action') {
        const script = runCommandStep.params.script;
        expect(script?.some((part) => typeof part === 'object' && 'token' in part)).toBe(true);
      }
    }
  });
});
