/**
 * `ActionCatalogEntry.fields`/`hasOutputAs` are the daemon's field schema
 * (Part 0 of the 2026-08-18 automations-provider-connections plan) — a
 * sibling of the wire `paramsSchema` (JSON Schema, validated server-side),
 * not a translation of it: JSON Schema can't express "this is a code
 * editor" or "this is a token-accepting chip field". `asActionParamsSchema`
 * below narrows the whole catalog entry defensively rather than trusting
 * its shape — a foreign/future entry (an MCP tool, an older daemon with no
 * `fields`) renders as an empty form instead of crashing. §9 still flags one
 * gap this doesn't close: Notion's row columns need a database-schema
 * lookup endpoint that doesn't exist, so `notion.add_row` only gets a
 * `databaseId` field — the `'columns'` control below stays a valid, unused
 * shape for when that endpoint ships.
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
  /** `run_command`/`files.read` only: renders the Text/Lines segment that patches `step.outputAs` directly (not a params entry — contract §1). */
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

/** Defensive narrowing of a catalog entry's `fields`/`hasOutputAs` — a malformed/foreign entry (an MCP tool, an older daemon with no `fields`) renders as an empty form instead of crashing. */
export function asActionParamsSchema(entry: unknown): ActionParamsSchema {
  if (typeof entry !== 'object' || entry === null) return { fields: [] };
  const fields = (entry as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return { fields: [] };
  return {
    fields: fields.filter(isFieldSchema),
    hasOutputAs: (entry as { hasOutputAs?: unknown }).hasOutputAs === true,
  };
}

export function singlePart(value: ChipText): string {
  const first = value[0];
  return typeof first === 'string' ? first : '';
}
