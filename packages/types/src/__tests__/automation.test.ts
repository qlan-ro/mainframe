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
} from '../automation.js';
import type { DaemonEvent } from '../events.js';
import type { AutomationRunSummary, AutomationInteractionSummary } from '../automation.js';

// Type-level (compile-time only): a shape drift in these literals fails `tsc`,
// not this test run. No runtime assertions — that would just restate the
// literal three lines up.

// Exercises every step kind and trigger kind, incl. ask_agent.expects.
const _definitionShape: AutomationDefinition = {
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
      conditions: [{ token: { stepId: 'ask-agent-1', output: 'scope' }, comparator: 'is_one_of', value: ['xs', 's'] }],
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
void _definitionShape;

// Every field the daemon emits for each of the five automation.* DaemonEvent variants.
const _run: AutomationRunSummary = {
  id: 'run-1',
  automationId: 'automation-1',
  status: 'succeeded',
  trigger: { kind: 'manual' },
  startedAt: 0,
  finishedAt: 1,
  error: null,
};
const _interaction: AutomationInteractionSummary = {
  id: 'interaction-1',
  runId: 'run-1',
  stepRef: 'ask-health',
  title: 'Health check-in',
  fields: [],
  status: 'pending',
  createdAt: 0,
  resolvedAt: null,
};
const _events: DaemonEvent[] = [
  { type: 'automation.run.updated', run: _run },
  { type: 'automation.interaction.created', interaction: _interaction },
  { type: 'automation.interaction.resolved', interactionId: 'interaction-1', runId: 'run-1' },
  {
    type: 'automation.completed',
    automationId: 'automation-1',
    automationName: 'Daily health log',
    runId: 'run-1',
    status: 'succeeded',
    result: 'done',
  },
  {
    type: 'automation.notification',
    runId: 'run-1',
    automationId: 'automation-1',
    title: 'Run finished',
    body: 'Daily health log finished',
    links: { runId: 'run-1', chatIds: ['chat-1'] },
  },
];
void _events;

// The zod schema (Task 4) doesn't exist yet, so these fixture checks are a
// type-annotated cast (`AutomationCreateInput`) plus targeted runtime
// spot-asserts — not a structural validator. Task 4 supersedes this with
// real parsing.
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'automations');

function loadFixture(name: string): AutomationCreateInput {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw) as AutomationCreateInput;
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
  // packages/core/src/__tests__/automations/definition-schema.test.ts parses
  // these same fixtures through the real AutomationDefinitionSchema (step/trigger
  // kind validation). This only checks the AutomationCreateInput wrapper fields
  // (name/scope) that schema does not cover.
  it.each(FIXTURE_NAMES)('%s has a well-formed name/scope/definition shape', (name) => {
    const fixture = loadFixture(name);
    expect(fixture.name.length).toBeGreaterThan(0);
    expect(['global', 'project']).toContain(fixture.scope);
    expect(Array.isArray(fixture.definition.triggers)).toBe(true);
    expect(fixture.definition.steps.length).toBeGreaterThan(0);
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
