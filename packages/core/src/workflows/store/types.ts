import type { WorkflowDef } from '../dsl/types.js';

export type RunStatus = 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type StepStatus = 'running' | 'waiting' | 'succeeded' | 'failed' | 'skipped' | 'ambiguous';
export type TriggerKind = 'manual' | 'cron' | 'event' | 'call';

export interface RunRecord {
  id: string;
  workflowId: string;
  definition: WorkflowDef;
  status: RunStatus;
  triggerKind: TriggerKind;
  triggerPayload: unknown;
  inputs: Record<string, unknown>;
  outputs: unknown;
  parentRunId: string | null;
  parentStepPath: string | null;
  wakeAt: number | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface StepRunRecord {
  id: string;
  runId: string;
  stepPath: string;
  stepId: string | null;
  kind: string;
  attempt: number;
  status: StepStatus;
  input: unknown;
  output: unknown;
  scratch: Record<string, unknown> | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface CommitStepInput {
  stepPath: string;
  stepId: string | null;
  kind: string;
  attempt: number;
  status: StepStatus;
  input: unknown;
  output: unknown;
  scratch: Record<string, unknown> | null;
  error: string | null;
}
