// packages/core/src/automations/store/types.ts
//
// The engine-internal shapes stored in automation_runs.checkpoint (contract
// §2) and automation_interactions. These are NOT re-exported from
// @qlan-ro/mainframe-types: the wire types the UI/REST layer sees
// (AutomationRunSummary, AutomationTimelineEntry, …) are projected from
// these by the routes layer (Phase 6), same split as v1's store/types.ts.
import type {
  AutomationDefinition,
  AutomationFormField,
  AutomationInteractionStatus,
  AutomationRunStatus,
  AutomationRunTriggerKind,
  AutomationStep,
  AutomationStepStatus,
} from '@qlan-ro/mainframe-types';

/** The firing context frozen into the checkpoint at run start (contract §2). */
export interface AutomationRunTriggerContext {
  kind: AutomationRunTriggerKind;
  triggerId?: string;
  scheduledFor?: string;
  payload?: unknown;
}

export interface AutomationCheckpointStep {
  stepId: string;
  kind: AutomationStep['kind'];
  status: AutomationStepStatus;
  outputs: Record<string, unknown> | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  chatId?: string;
  interactionId?: string;
}

/**
 * Canonical checkpoint shape (contract §2). `definition` is the FROZEN
 * snapshot at run start — advance() re-walks this, never the live
 * `automations` row, so mid-run definition edits never shift stepRefs.
 */
export interface AutomationCheckpoint {
  definition: AutomationDefinition;
  trigger: AutomationRunTriggerContext;
  steps: Record<string, AutomationCheckpointStep>;
  wakeAt: number | null;
  error: string | null;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  checkpoint: AutomationCheckpoint;
  startedAt: number;
  finishedAt: number | null;
}

export interface AutomationInteractionRecord {
  id: string;
  runId: string;
  stepRef: string;
  title: string;
  fields: AutomationFormField[];
  status: AutomationInteractionStatus;
  createdAt: number;
  resolvedAt: number | null;
}

/** Terminal statuses a run never leaves — shared by run-store's write guard and the engine's own re-checks. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<AutomationRunStatus> = new Set(['succeeded', 'failed', 'cancelled']);

/** Thrown by RunStore.patchCheckpoint/finalizeRun when the target run is already terminal — cancellation is authoritative, so a late-arriving write must never resurrect or overwrite a finished run. */
export class AutomationRunTerminalError extends Error {
  constructor(
    public readonly runId: string,
    public readonly status: AutomationRunStatus,
  ) {
    super(`automation run '${runId}' is already terminal (${status})`);
    this.name = 'AutomationRunTerminalError';
  }
}
