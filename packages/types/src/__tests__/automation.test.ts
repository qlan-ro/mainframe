import { describe, it, expect } from 'vitest';
import {
  TOKEN_STEP_TRIGGER,
  TOKEN_STEP_BUILTIN,
  TOKEN_STEP_CURRENT,
  type AutomationDefinition,
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
