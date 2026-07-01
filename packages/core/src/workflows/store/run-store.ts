import { nanoid } from 'nanoid';
import type { WorkflowDb } from '../db.js';
import type { WorkflowDef } from '../dsl/types.js';
import type { CommitStepInput, RunRecord, RunStatus, StepRunRecord, TriggerKind } from './types.js';

const MAX_VALUE_BYTES = 4 * 1024 * 1024;

interface RunRow {
  id: string;
  workflow_id: string;
  definition: string;
  status: string;
  trigger_kind: string;
  trigger_payload: string | null;
  inputs: string | null;
  outputs: string | null;
  parent_run_id: string | null;
  parent_step_path: string | null;
  wake_at: number | null;
  started_at: number;
  finished_at: number | null;
  error: string | null;
}
interface StepRow {
  id: string;
  run_id: string;
  step_path: string;
  step_id: string | null;
  kind: string;
  attempt: number;
  status: string;
  input_ref: string | null;
  output_ref: string | null;
  scratch: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

export class RunStore {
  constructor(private readonly db: WorkflowDb) {}

  private storeValue(runId: string, value: unknown, label: string): string | null {
    if (value === undefined || value === null) return null;
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > MAX_VALUE_BYTES) {
      throw new Error(
        `${label} too large (${Buffer.byteLength(json)} bytes > ${MAX_VALUE_BYTES}); write large data to a file and pass the path`,
      );
    }
    const id = nanoid();
    this.db.prepare(`INSERT INTO run_values (id, run_id, json) VALUES (?, ?, ?)`).run(id, runId, json);
    return id;
  }

  private readValue(ref: string | null): unknown {
    if (!ref) return null;
    const row = this.db.prepare(`SELECT json FROM run_values WHERE id = ?`).get(ref) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }

  createRun(args: {
    workflowId: string;
    definition: WorkflowDef | object;
    triggerKind: TriggerKind;
    triggerPayload: unknown;
    inputs: Record<string, unknown>;
    parentRunId?: string;
    parentStepPath?: string;
  }): RunRecord {
    const id = nanoid();
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO workflow_runs (id, workflow_id, definition, status, trigger_kind, trigger_payload, inputs, parent_run_id, parent_step_path, started_at)
      VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        args.workflowId,
        JSON.stringify(args.definition),
        args.triggerKind,
        args.triggerPayload === null ? null : JSON.stringify(args.triggerPayload),
        JSON.stringify(args.inputs),
        args.parentRunId ?? null,
        args.parentStepPath ?? null,
        now,
      );
    const run = this.getRun(id);
    if (!run) throw new Error('run insert failed');
    return run;
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(id) as RunRow | undefined;
    return row ? this.rowToRun(row) : null;
  }

  listRuns(workflowId: string, limit = 50): RunRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(workflowId, limit) as RunRow[];
    return rows.map((r) => this.rowToRun(r));
  }

  loadResumable(): RunRecord[] {
    const rows = this.db.prepare(`SELECT * FROM workflow_runs WHERE status IN ('running','waiting')`).all() as RunRow[];
    return rows.map((r) => this.rowToRun(r));
  }

  listDueRuns(now: number): RunRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs WHERE status = 'waiting' AND wake_at IS NOT NULL AND wake_at <= ?`)
      .all(now) as RunRow[];
    return rows.map((r) => this.rowToRun(r));
  }

  commitStep(runId: string, step: CommitStepInput): StepRunRecord {
    const tx = this.db.transaction(() => {
      const inputRef = this.storeValue(runId, step.input, 'input');
      const outputRef = this.storeValue(runId, step.output, 'output');
      const id = nanoid();
      const now = Date.now();
      this.db
        .prepare(
          `
        INSERT INTO step_runs (id, run_id, step_path, step_id, kind, attempt, status, input_ref, output_ref, scratch, error, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (run_id, step_path, attempt) DO UPDATE SET
          status = excluded.status, output_ref = excluded.output_ref,
          scratch = excluded.scratch, error = excluded.error, finished_at = excluded.finished_at
      `,
        )
        .run(
          id,
          runId,
          step.stepPath,
          step.stepId,
          step.kind,
          step.attempt,
          step.status,
          inputRef,
          outputRef,
          step.scratch ? JSON.stringify(step.scratch) : null,
          step.error,
          now,
          step.status === 'running' || step.status === 'waiting' ? null : now,
        );
      return id;
    });
    tx();
    const rec = this.getStepRun(runId, step.stepPath, step.attempt);
    if (!rec) throw new Error('step commit failed');
    return rec;
  }

  getStepRun(runId: string, stepPath: string, attempt: number): StepRunRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM step_runs WHERE run_id = ? AND step_path = ? AND attempt = ?`)
      .get(runId, stepPath, attempt) as StepRow | undefined;
    return row ? this.rowToStep(row) : null;
  }

  listStepRuns(runId: string): StepRunRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM step_runs WHERE run_id = ? ORDER BY started_at, attempt`)
      .all(runId) as StepRow[];
    return rows.map((r) => this.rowToStep(r));
  }

  /** Newest attempt per step_path — what replay consults. */
  latestStepResults(runId: string): Map<string, StepRunRecord> {
    const out = new Map<string, StepRunRecord>();
    for (const rec of this.listStepRuns(runId)) {
      const prev = out.get(rec.stepPath);
      if (!prev || rec.attempt > prev.attempt) out.set(rec.stepPath, rec);
    }
    return out;
  }

  parkRun(runId: string, wakeAt: number | null): void {
    this.db.prepare(`UPDATE workflow_runs SET status = 'waiting', wake_at = ? WHERE id = ?`).run(wakeAt, runId);
  }

  markRunning(runId: string): void {
    this.db.prepare(`UPDATE workflow_runs SET status = 'running', wake_at = NULL WHERE id = ?`).run(runId);
  }

  finalizeRun(
    runId: string,
    status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled'>,
    outputs: unknown,
    error: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE workflow_runs SET status = ?, outputs = ?, error = ?, finished_at = ?, wake_at = NULL WHERE id = ?`,
      )
      .run(
        status,
        outputs === null || outputs === undefined ? null : JSON.stringify(outputs),
        error,
        Date.now(),
        runId,
      );
  }

  private rowToRun(row: RunRow): RunRecord {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      definition: JSON.parse(row.definition) as WorkflowDef,
      status: row.status as RunRecord['status'],
      triggerKind: row.trigger_kind as TriggerKind,
      triggerPayload: row.trigger_payload ? JSON.parse(row.trigger_payload) : null,
      inputs: row.inputs ? (JSON.parse(row.inputs) as Record<string, unknown>) : {},
      outputs: row.outputs ? JSON.parse(row.outputs) : null,
      parentRunId: row.parent_run_id,
      parentStepPath: row.parent_step_path,
      wakeAt: row.wake_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
    };
  }

  private rowToStep(row: StepRow): StepRunRecord {
    return {
      id: row.id,
      runId: row.run_id,
      stepPath: row.step_path,
      stepId: row.step_id,
      kind: row.kind,
      attempt: row.attempt,
      status: row.status as StepRunRecord['status'],
      input: this.readValue(row.input_ref),
      output: this.readValue(row.output_ref),
      scratch: row.scratch ? (JSON.parse(row.scratch) as Record<string, unknown>) : null,
      error: row.error,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }
}
