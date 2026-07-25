/**
 * Todo #234's three additive contract changes. The literals below are the
 * assertion: `tsc` (the package build) rejects the file if a shape drifts, so
 * this suite fails red through `pnpm --filter @qlan-ro/mainframe-types build`
 * as well as through vitest.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AutomationStep,
  SchedulePattern,
  ScheduleTrigger,
  SetVariableStep,
  WebhookTrigger,
} from '../../automation.js';

describe('once schedule pattern', () => {
  it('is a SchedulePattern member carrying a naive-local datetime-local string', () => {
    const once: SchedulePattern = { type: 'once', at: '2026-08-01T14:00' };
    expect(once).toEqual({ type: 'once', at: '2026-08-01T14:00' });
    expectTypeOf(once).toExtend<{ type: 'once'; at: string }>();
  });

  it('slots into a schedule trigger alongside onMissed', () => {
    const trigger: ScheduleTrigger = {
      id: 'trigger-once',
      kind: 'schedule',
      schedule: { type: 'once', at: '2026-08-01T14:00' },
      onMissed: 'skip',
    };
    expect(trigger.schedule.type).toBe('once');
  });
});

describe('webhook registration', () => {
  it('is optional — an unregistered trigger is the same shape as before', () => {
    const unregistered: WebhookTrigger = { id: 'trigger-hook', kind: 'webhook', hookId: 'hook-1' };
    expect(unregistered.registration).toBeUndefined();
  });

  it('carries hookId, url and a nullable lastDeliveryAt when the daemon has provisioned it', () => {
    const registered: WebhookTrigger = {
      id: 'trigger-hook',
      kind: 'webhook',
      hookId: 'hook-1',
      registration: {
        hookId: 'hook-1',
        url: 'http://127.0.0.1:31415/api/automation-webhooks/hook-1',
        lastDeliveryAt: null,
      },
    };
    expect(registered.registration).toEqual({
      hookId: 'hook-1',
      url: 'http://127.0.0.1:31415/api/automation-webhooks/hook-1',
      lastDeliveryAt: null,
    });
    expectTypeOf<NonNullable<WebhookTrigger['registration']>['lastDeliveryAt']>().toEqualTypeOf<string | null>();
  });
});

describe('set_variable step', () => {
  it('carries a name and a ChipText value', () => {
    const step: SetVariableStep = { kind: 'set_variable', id: 'set-1', name: 'release_notes', value: ['v2 ships'] };
    expect(step).toEqual({ kind: 'set_variable', id: 'set-1', name: 'release_notes', value: ['v2 ships'] });
  });

  it('is a member of the AutomationStep union', () => {
    const step: AutomationStep = { kind: 'set_variable', id: 'set-1', name: 'release_notes', value: [''] };
    expect(step.kind).toBe('set_variable');
    expectTypeOf<Extract<AutomationStep, { kind: 'set_variable' }>>().toEqualTypeOf<SetVariableStep>();
  });
});
