import { nanoid } from 'nanoid';
import type { WorkflowDb } from '../db.js';
import type { QuestionField } from '../dsl/types.js';

export interface InteractionRecord {
  id: string;
  runId: string;
  stepPath: string;
  title: string;
  /** The QuestionStep's `fields` array snapshot — used by response validation. */
  formSchema: QuestionField[];
  status: 'pending' | 'answered' | 'expired';
  createdAt: number;
  expiresAt: number | null;
}

interface Row {
  id: string;
  run_id: string;
  step_path: string;
  title: string;
  form_schema: string;
  status: string;
  created_at: number;
  expires_at: number | null;
}

export class InteractionStore {
  constructor(private readonly db: WorkflowDb) {}

  create(args: {
    runId: string;
    stepPath: string;
    title: string;
    formSchema: QuestionField[];
    expiresAt: number | null;
  }): InteractionRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO pending_interactions (id, run_id, step_path, title, form_schema, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(id, args.runId, args.stepPath, args.title, JSON.stringify(args.formSchema), Date.now(), args.expiresAt);
    return this.get(id) as InteractionRecord;
  }

  get(id: string): InteractionRecord | null {
    const row = this.db.prepare(`SELECT * FROM pending_interactions WHERE id = ?`).get(id) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  findPendingForStep(runId: string, stepPath: string): InteractionRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM pending_interactions WHERE run_id = ? AND step_path = ? AND status = 'pending'`)
      .get(runId, stepPath) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  listPending(): InteractionRecord[] {
    return (
      this.db.prepare(`SELECT * FROM pending_interactions WHERE status = 'pending' ORDER BY created_at`).all() as Row[]
    ).map(toRecord);
  }

  listDue(now: number): InteractionRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM pending_interactions WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`,
        )
        .all(now) as Row[]
    ).map(toRecord);
  }

  /** Atomically claim: pending → answered|expired. Returns false if already claimed. */
  claim(id: string, to: 'answered' | 'expired'): boolean {
    const res = this.db
      .prepare(`UPDATE pending_interactions SET status = ? WHERE id = ? AND status = 'pending'`)
      .run(to, id);
    return res.changes === 1;
  }
}

function toRecord(row: Row): InteractionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepPath: row.step_path,
    title: row.title,
    formSchema: JSON.parse(row.form_schema) as QuestionField[],
    status: row.status as InteractionRecord['status'],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
