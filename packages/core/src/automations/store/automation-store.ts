// packages/core/src/automations/store/automation-store.ts
//
// Task 23. CRUD for the `automations` table — the third contract table
// alongside RunStore/InteractionStore. Definition validation (schema +
// scopes) is AutomationService's job; this store only persists and reads
// the already-validated definition it's handed.
import { nanoid } from 'nanoid';
import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationSummary,
  WebhookTrigger,
} from '@qlan-ro/mainframe-types';
import type { AutomationDb } from '../db.js';
import { rowToSummary, type AutomationRow } from '../service-helpers.js';

export class AutomationStore {
  constructor(private readonly db: AutomationDb) {}

  get(id: string): AutomationRow | null {
    const row = this.db.prepare(`SELECT * FROM automations WHERE id = ?`).get(id) as AutomationRow | undefined;
    return row ?? null;
  }

  getSummary(id: string): AutomationSummary | null {
    const row = this.get(id);
    return row ? rowToSummary(row) : null;
  }

  list(): AutomationSummary[] {
    const rows = this.db.prepare(`SELECT * FROM automations ORDER BY created_at`).all() as AutomationRow[];
    return rows.map(rowToSummary);
  }

  listEnabled(): AutomationRow[] {
    return this.db.prepare(`SELECT * FROM automations WHERE enabled = 1`).all() as AutomationRow[];
  }

  /** Scans every stored definition for a webhook trigger with this hookId — the webhook route's (Task 25) hookId lookup. Deliberately includes disabled automations: the route still verifies the signature and defers the enabled check to TriggerArmer.fireRun, so a disabled automation's webhook doesn't leak its existence via a differing HTTP status. */
  findWebhookTrigger(hookId: string): { row: AutomationRow; trigger: WebhookTrigger } | null {
    const rows = this.db.prepare(`SELECT * FROM automations`).all() as AutomationRow[];
    for (const row of rows) {
      const definition = JSON.parse(row.definition) as AutomationDefinition;
      const trigger = definition.triggers.find((t): t is WebhookTrigger => t.kind === 'webhook' && t.hookId === hookId);
      if (trigger) return { row, trigger };
    }
    return null;
  }

  create(input: AutomationCreateInput, definition: AutomationDefinition): AutomationRow {
    const id = nanoid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO automations (id, name, description, scope, project_id, enabled, definition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description ?? null,
        input.scope,
        input.projectId ?? null,
        JSON.stringify(definition),
        now,
        now,
      );
    return this.get(id)!;
  }

  update(id: string, input: AutomationCreateInput, definition: AutomationDefinition): AutomationRow {
    this.db
      .prepare(
        `UPDATE automations SET name = ?, description = ?, scope = ?, project_id = ?, definition = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.name,
        input.description ?? null,
        input.scope,
        input.projectId ?? null,
        JSON.stringify(definition),
        Date.now(),
        id,
      );
    return this.get(id)!;
  }

  setEnabled(id: string, enabled: boolean): AutomationRow {
    this.db
      .prepare(`UPDATE automations SET enabled = ?, updated_at = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, Date.now(), id);
    return this.get(id)!;
  }

  /** automation_runs/automation_interactions cascade via the DB's ON DELETE CASCADE FKs (db.ts). */
  delete(id: string): void {
    this.db.prepare(`DELETE FROM automations WHERE id = ?`).run(id);
  }
}
