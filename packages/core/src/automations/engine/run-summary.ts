// packages/core/src/automations/engine/run-summary.ts
//
// One projection shared by the interpreter (run.updated events) and
// AgentWaitService (fail-loudly-without-keepGoing finalize path) so both
// emit the identical wire shape the routes layer's GET /api/automation-runs
// also projects (interpreter.ts re-exports this for that import site).
import type { AutomationRunSummary } from '@qlan-ro/mainframe-types';
import type { AutomationRunRecord } from '../store/types.js';

export function toRunSummary(run: AutomationRunRecord): AutomationRunSummary {
  return {
    id: run.id,
    automationId: run.automationId,
    status: run.status,
    trigger: { kind: run.checkpoint.trigger.kind },
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.checkpoint.error,
  };
}
