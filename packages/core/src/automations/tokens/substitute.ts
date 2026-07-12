// packages/core/src/automations/tokens/substitute.ts
//
// Token resolution + literal substitution (contract Decision 9). Two
// entry points on purpose: `resolveToken` returns the raw typed value
// (comparators and Repeat need a real array/number, not a string);
// `renderChipText` stringifies for prompt/param text. `ctx.steps` is keyed
// by plain stepId, not a full checkpoint stepRef — the interpreter builds
// the right per-iteration view before calling in here (Repeat inner steps
// live at `<stepId>#<n>` in the checkpoint itself).
import { TOKEN_STEP_BUILTIN, TOKEN_STEP_CURRENT, TOKEN_STEP_TRIGGER } from '@qlan-ro/mainframe-types';
import type { ChipText, TokenRef } from '@qlan-ro/mainframe-types';
import type { AutomationCheckpointStep } from '../store/types.js';

export interface TokenContext {
  trigger: Record<string, unknown>;
  steps: Record<string, AutomationCheckpointStep>;
  /** Iteration stack for nested Repeat blocks; the last entry is the innermost `current`. */
  currentItems: unknown[];
}

export function resolveToken(ctx: TokenContext, ref: TokenRef): unknown {
  const value = resolveBase(ctx, ref);
  return ref.field !== undefined ? digField(value, ref.field) : value;
}

export function renderChipText(ctx: TokenContext, text: ChipText): string {
  return text.map((part) => (typeof part === 'string' ? part : coerceToString(resolveToken(ctx, part.token)))).join('');
}

function resolveBase(ctx: TokenContext, ref: TokenRef): unknown {
  if (ref.stepId === TOKEN_STEP_BUILTIN) return resolveBuiltin(ref.output);
  if (ref.stepId === TOKEN_STEP_CURRENT) return ctx.currentItems.at(-1);
  if (ref.stepId === TOKEN_STEP_TRIGGER) return ctx.trigger[ref.output];
  return ctx.steps[ref.stepId]?.outputs?.[ref.output];
}

function resolveBuiltin(output: string): unknown {
  const now = new Date();
  if (output === 'today') return formatLocalDate(now);
  if (output === 'now') return now.toISOString();
  return undefined;
}

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Dot-path descent into an object/array chain; any miss along the way resolves to undefined. */
function digField(value: unknown, field: string): unknown {
  return field.split('.').reduce<unknown>((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    if (Array.isArray(acc)) {
      const index = Number(key);
      return Number.isInteger(index) ? acc[index] : undefined;
    }
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

/** Literal substitution rules (contract Decision 9): unset -> '', number -> String(), list -> join('\n'), object -> JSON.stringify. */
function coerceToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(coerceToString).join('\n');
  return JSON.stringify(value);
}
