// packages/core/src/automations/store/automation-store.ts
//
// Task 23. CRUD for the `automations` table — the third contract table
// alongside RunStore/InteractionStore. Definition validation (schema +
// scopes) is AutomationService's job; this store only persists and reads
// the already-validated definition it's handed.
import { nanoid } from 'nanoid';
import type { AutomationCreateInput, AutomationDefinition, AutomationSummary } from '@qlan-ro/mainframe-types';
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
}
