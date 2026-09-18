/**
 * `ItemMetaSchema` parsing with a per-field fallback (todo #350 plan review
 * fixes, T31, R3.10). Split out of `convert-acp-item.ts` to keep that file
 * under the 300-line cap. A whole-object `safeParse` failure today drops
 * EVERY field, including valid ones — one wrong-typed key (e.g. a `groupId`
 * that arrived as a number) would orphan a subagent's children by silently
 * losing their `parentToolCallId`. Falling back to a per-key parse keeps
 * every field that validates.
 */
import { ItemMetaSchema, type ItemMeta } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from './acp-item-accumulator';

const FIELD_SCHEMAS = ItemMetaSchema.shape;

function parsePerField(raw: Record<string, unknown>): ItemMeta {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(FIELD_SCHEMAS) as Array<keyof typeof FIELD_SCHEMAS>) {
    if (!(key in raw)) continue;
    const parsed = FIELD_SCHEMAS[key].safeParse(raw[key]);
    if (parsed.success) result[key] = parsed.data;
    else console.warn(`[convert-acp-item] dropped invalid item-meta field "${key}"`, raw[key]);
  }
  return result as ItemMeta;
}

/** Parses an item's `_meta["_mainframe.dev"]` — whole-object first, falling back per-field so one bad key never drops the rest. */
export function parseItemMeta(item: AccumulatedItem, namespace: string): ItemMeta {
  const raw = item.meta?.[namespace];
  const whole = ItemMetaSchema.safeParse(raw);
  if (whole.success) return whole.data;
  if (typeof raw !== 'object' || raw === null) return {};
  return parsePerField(raw as Record<string, unknown>);
}
