/**
 * `ActionCatalogEntry.paramsSchema` is `unknown` on the wire (contract §1) —
 * no plan has ratified its shape yet, and §9 flags the one place that
 * matters most (Notion's columns) as an explicit gap: "needs a schema-lookup
 * endpoint the contract lacks". This module is the UI-local shape Phase 4
 * renders against, cast out of `paramsSchema` at the one seam
 * (`fixtures/action-catalog.ts` authors it; `AutoForm` reads it) — the same
 * pattern `domain/tokens.ts`'s `ACTION_LIST_ITEM_FIELDS` already uses for
 * catalog metadata the wire doesn't carry. When a real schema-lookup route
 * lands, only these two files need to change.
 *
 * Every param field commits into `RunActionStep.params[key]` (always
 * `ChipText` — contract §1, no raw-JSON variant). `'text'`/`'select'` fields
 * are the plain, non-tokenizable subset ts153 chose `type: 'text'` for
 * (branch base, org/project names, HTTP method): they read/write a single
 * literal `ChipText` part (`[value]`), never open the token picker. `auth`/
 * `credentialLabelHint` already live on `ActionCatalogEntry` itself, so
 * there is no `'credential'` control here — `ActionConfig` renders
 * `CredentialConnect` directly from those two real fields, patching the
 * step's top-level `credential`, never a params entry.
 */
import type { ChipText } from '../contract';

export type ActionFieldControl = 'text' | 'select' | 'chip' | 'chiparea' | 'code' | 'columns';

export interface ActionFieldSchema {
  key: string;
  label: string;
  control: ActionFieldControl;
  /** `select`, and the sibling select a `columns` field reads. */
  options?: string[];
  placeholder?: string;
  /** Field only renders when a sibling `select`/`text` field equals this value. */
  showWhen?: { key: string; equals: string };
  /** `columns` control only: which sibling field's value picks the column set. */
  columnsSourceKey?: string;
  /** `columns` control only: sibling field value -> the column names it renders as rows. */
  columnsByOption?: Record<string, string[]>;
}

export interface ActionParamsSchema {
  fields: ActionFieldSchema[];
  /** `run_command` only: renders the Text/Lines segment that patches `step.outputAs` directly (not a params entry — contract §1). */
  hasOutputAs?: boolean;
}

function isFieldSchema(value: unknown): value is ActionFieldSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { key?: unknown }).key === 'string' &&
    typeof (value as { label?: unknown }).label === 'string' &&
    typeof (value as { control?: unknown }).control === 'string'
  );
}

/** Defensive narrowing for `paramsSchema: unknown` — a malformed/foreign catalog entry (a future live daemon response, an MCP tool) renders as an empty form instead of crashing. */
export function asActionParamsSchema(paramsSchema: unknown): ActionParamsSchema {
  if (typeof paramsSchema !== 'object' || paramsSchema === null) return { fields: [] };
  const fields = (paramsSchema as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return { fields: [] };
  return {
    fields: fields.filter(isFieldSchema),
    hasOutputAs: (paramsSchema as { hasOutputAs?: unknown }).hasOutputAs === true,
  };
}

export function singlePart(value: ChipText): string {
  const first = value[0];
  return typeof first === 'string' ? first : '';
}
