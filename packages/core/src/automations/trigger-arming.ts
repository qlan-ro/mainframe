// packages/core/src/automations/trigger-arming.ts
//
// Task 23. Owns the runtime side of "When": schedule triggers go into the
// CronScheduler, event trigger bindings live in an in-memory array
// (rebuilt on every arm/disarm — matches workflows/index.ts's armTriggers),
// and a webhook trigger gets its `webhook:<hookId>` secret generated once
// and left alone afterwards. `fireRun` is the one place a trigger actually
// starts a run — used by both the scheduler's fire callback and
// AutomationService.onDaemonEvent's chaining match loop.
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { AutomationDefinition } from '@qlan-ro/mainframe-types';
import type { AutomationInterpreter } from './engine/interpreter.js';
import type { AutomationRunRecord, AutomationRunTriggerContext } from './store/types.js';
import type { FileCredentialStore } from './credentials.js';
import { compileSchedule } from './triggers/schedule.js';
import type { CronScheduler } from './triggers/scheduler.js';
import type { EventTriggerBinding } from './triggers/events.js';
import { isDedupConflict, type AutomationRow } from './service-helpers.js';

export interface TriggerArmerDeps {
  scheduler: CronScheduler;
  credentials: FileCredentialStore;
  interpreter: AutomationInterpreter;
  getRow: (id: string) => AutomationRow | null;
  logger: Logger;
}

export class TriggerArmer {
  eventBindings: EventTriggerBinding[] = [];

  constructor(private readonly deps: TriggerArmerDeps) {}

  armAll(rows: AutomationRow[]): void {
    this.eventBindings = [];
    for (const row of rows) this.arm(row);
  }

  arm(row: AutomationRow): void {
    const definition = JSON.parse(row.definition) as AutomationDefinition;
    const now = Date.now();
    for (const trigger of definition.triggers) {
      if (trigger.kind === 'schedule') {
        this.deps.scheduler.arm(row.id, trigger.id, compileSchedule(trigger.schedule), trigger.onMissed, now);
      } else if (trigger.kind === 'event') {
        this.eventBindings.push({
          automationId: row.id,
          triggerId: trigger.id,
          event: trigger.event,
          automationFilter: trigger.automationId,
        });
      } else if (trigger.kind === 'webhook') {
        this.ensureWebhookSecret(trigger.hookId);
      }
    }
  }

  disarm(automationId: string): void {
    this.deps.scheduler.disarm(automationId);
    this.eventBindings = this.eventBindings.filter((b) => b.automationId !== automationId);
  }

  /** Best-effort: a duplicate dedup key (Decision 13) or a since-disabled/deleted automation is not a request to fail. */
  fireRun(automationId: string, trigger: AutomationRunTriggerContext, dedupKey: string | null): void {
    const row = this.deps.getRow(automationId);
    if (!row || row.enabled !== 1) return;
    const definition = JSON.parse(row.definition) as AutomationDefinition;

    let run: AutomationRunRecord;
    try {
      run = this.deps.interpreter.startRun(automationId, definition, trigger, dedupKey);
    } catch (err) {
      if (isDedupConflict(err)) return;
      this.deps.logger.error({ err, automationId }, 'automation fireRun: startRun failed');
      return;
    }
    void this.deps.interpreter.advance(run.id).catch((err: unknown) => {
      this.deps.logger.error({ err, runId: run.id }, 'automation fireRun: advance failed');
    });
  }

  private ensureWebhookSecret(hookId: string): void {
    const label = `webhook:${hookId}`;
    if (this.deps.credentials.get(label)) return;
    this.deps.credentials.set(label, { kind: 'token', token: randomBytes(32).toString('hex') });
  }
}
