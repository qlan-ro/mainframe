/**
 * automation-row-view — pure derivation for the sidebar Automations list:
 * one row per definition with its trigger kind, status and last run, sorted
 * "needs you" first. Kept out of the components so the rules are testable
 * without a DOM.
 */
import type { AutomationInteractionSummary, AutomationRunSummary, AutomationSummary } from '../contract';

export type AutomationRowStatus = 'running' | 'needs-you' | 'disabled' | 'idle';

export type AutomationTriggerKind = 'schedule' | 'event' | 'webhook' | 'manual';

export interface AutomationRowVm {
  id: string;
  name: string;
  trigger: AutomationTriggerKind;
  status: AutomationRowStatus;
  /** When the most recent run started; null when it never ran. */
  lastRunAt: number | null;
}

function triggerKind(definition: AutomationSummary): AutomationTriggerKind {
  return definition.definition.triggers[0]?.kind ?? 'manual';
}

function statusOf(
  definition: AutomationSummary,
  runs: AutomationRunSummary[],
  pendingRunIds: ReadonlySet<string>,
): AutomationRowStatus {
  if (runs.some((run) => pendingRunIds.has(run.id) || run.status === 'waiting')) return 'needs-you';
  if (runs.some((run) => run.status === 'running')) return 'running';
  if (!definition.enabled) return 'disabled';
  return 'idle';
}

const STATUS_RANK: Record<AutomationRowStatus, number> = { 'needs-you': 0, running: 1, idle: 2, disabled: 3 };

export function deriveAutomationRows(
  definitions: AutomationSummary[],
  runs: AutomationRunSummary[],
  interactions: AutomationInteractionSummary[],
): AutomationRowVm[] {
  const pendingRunIds = new Set(interactions.filter((i) => i.status === 'pending').map((i) => i.runId));
  const rows = definitions.map((definition) => {
    const own = runs.filter((run) => run.automationId === definition.id);
    const latest = own.reduce<number | null>(
      (max, run) => (max == null || run.startedAt > max ? run.startedAt : max),
      null,
    );
    return {
      id: definition.id,
      name: definition.name,
      trigger: triggerKind(definition),
      status: statusOf(definition, own, pendingRunIds),
      lastRunAt: latest,
    };
  });
  // Needs-you first, then running; ties keep the library's order.
  return rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** Compact "last ran" — `now`, `5m`, `3h`, `2d`; null when it never ran. */
export function formatLastRun(lastRunAt: number | null, now: number): string | null {
  if (lastRunAt == null) return null;
  const delta = Math.max(0, now - lastRunAt);
  if (delta < MIN_MS) return 'now';
  if (delta < HOUR_MS) return `${Math.floor(delta / MIN_MS)}m`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h`;
  return `${Math.floor(delta / DAY_MS)}d`;
}
