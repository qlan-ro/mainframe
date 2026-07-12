// packages/core/src/automations/service-helpers.ts
//
// Task 23. Pure helpers factored out of service.ts to keep it under the
// 300-line/file, 50-line/function limits — nothing here touches the DB or
// any service state directly.
import type { z } from 'zod';
import type { AutomationDefinition, AutomationScope, AutomationSummary, DaemonEvent } from '@qlan-ro/mainframe-types';
import type { ScopeError } from './definition/validate.js';
import type { AutomationRunRecord } from './store/types.js';
import { coerceToString } from './tokens/substitute.js';

export interface AutomationRow {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  project_id: string | null;
  enabled: number;
  definition: string;
  created_at: number;
  updated_at: number;
}

export function rowToSummary(row: AutomationRow): AutomationSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    scope: row.scope as AutomationScope,
    projectId: row.project_id,
    enabled: row.enabled === 1,
    definition: JSON.parse(row.definition) as AutomationDefinition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function zodIssuesToScopeErrors(error: z.ZodError): ScopeError[] {
  return error.issues.map((issue) => ({
    stepId: null,
    message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  }));
}

/** better-sqlite3 sets `.code` to e.g. 'SQLITE_CONSTRAINT_UNIQUE' on a UNIQUE index violation (contract Decision 13: a duplicate trigger fire loses the insert race — expected, not an error). */
export function isDedupConflict(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

/** Which chat, if any, sourced this daemon event — used as the second half of an event trigger's dedup key so a re-emitted event does not double-fire (contract Decision 13's `<triggerId>|<scheduledFor>` shape, adapted: events have no scheduledFor, so the source chat/run id substitutes for it). */
export function eventDedupSource(event: DaemonEvent): string | null {
  if (event.type === 'chat.updated' && event.reason) return event.chat.id;
  if (event.type === 'automation.completed') return event.runId;
  return null;
}

/** Extract concatenated text from a ChatMessage content array. Returns null when no text blocks (ported from workflows/index.ts). */
export function extractAssistantText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join('') : null;
}

/**
 * The `⟨its result⟩` token a chained automation.finished/automation.failed trigger reads (spec §4). On failure this
 * is the run error; on success there's no single canonical "the" output across every step kind, so this takes the
 * last step that actually ran, in checkpoint insertion order, and coerces its outputs with the same Decision-9
 * stringification rule chip substitution uses.
 */
export function summarizeRunResult(run: AutomationRunRecord): string {
  if (run.status === 'failed') return run.checkpoint.error ?? 'automation failed';
  const last = Object.values(run.checkpoint.steps).at(-1);
  if (!last || last.outputs === null) return '';
  const values = Object.values(last.outputs);
  if (values.length === 0) return '';
  if (values.length === 1) return coerceToString(values[0]);
  return JSON.stringify(last.outputs);
}
