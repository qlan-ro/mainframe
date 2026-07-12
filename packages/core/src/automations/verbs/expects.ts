// packages/core/src/automations/verbs/expects.ts
//
// Task 19b (A2, contract §5). `buildOutputContract` appends a "return a
// final JSON object" instruction to the ask_agent prompt; `parseAndValidate`
// extracts the LAST top-level JSON object from the agent's response and
// checks it against the declared `expects` keys/types, coercing
// number/list/choice values.
import type { AutomationExpectedOutput } from '@qlan-ro/mainframe-types';

export function buildOutputContract(expects: AutomationExpectedOutput[]): string {
  return `\n\nEnd your final message with a JSON object matching this shape (and nothing after it): ${describeShape(expects)}`;
}

export function buildCorrectionMessage(reason: string, expects: AutomationExpectedOutput[]): string {
  return `That response didn't include the expected JSON (${reason}).${buildOutputContract(expects)}`;
}

function describeShape(expects: AutomationExpectedOutput[]): string {
  const fields = expects.map((field) => `"${field.key}": ${describeType(field)}`).join(', ');
  return `{${fields}}`;
}

function describeType(field: AutomationExpectedOutput): string {
  return field.type === 'choice' ? `one of ${JSON.stringify(field.options ?? [])}` : `<${field.type}>`;
}

export type ParsedOutputs = { ok: true; outputs: Record<string, unknown> } | { ok: false; reason: string };

export function parseAndValidate(text: string, expects: AutomationExpectedOutput[]): ParsedOutputs {
  const json = extractLastJsonObject(text);
  if (!json) return { ok: false, reason: 'no JSON object found in the response' };

  const outputs: Record<string, unknown> = {};
  for (const field of expects) {
    const raw = json[field.key];
    if (raw === undefined) return { ok: false, reason: `missing key '${field.key}'` };
    const coerced = coerceField(raw, field);
    if (!coerced.ok) return coerced;
    outputs[field.key] = coerced.value;
  }
  return { ok: true, outputs };
}

type CoerceResult = { ok: true; value: unknown } | { ok: false; reason: string };

function coerceField(raw: unknown, field: AutomationExpectedOutput): CoerceResult {
  if (field.type === 'text') {
    return typeof raw === 'string'
      ? { ok: true, value: raw }
      : { ok: false, reason: `'${field.key}' must be a string` };
  }
  if (field.type === 'number') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? { ok: true, value: num } : { ok: false, reason: `'${field.key}' must be a number` };
  }
  if (field.type === 'list') {
    return Array.isArray(raw) ? { ok: true, value: raw } : { ok: false, reason: `'${field.key}' must be a list` };
  }
  const choice = String(raw);
  if (field.options && !field.options.includes(choice)) {
    return { ok: false, reason: `'${field.key}' must be one of ${JSON.stringify(field.options)}` };
  }
  return { ok: true, value: choice };
}

/** Scans left to right tracking brace depth (string-aware, so a `}` inside a quoted value never miscounts) and returns every complete top-level `{...}` span; the caller tries them from the end. */
function collectTopLevelObjects(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function extractLastJsonObject(text: string): Record<string, unknown> | null {
  const candidates = collectTopLevelObjects(text);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(candidates[i] as string);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Not valid JSON on its own (e.g. a brace pair inside prose) — fall back to an earlier candidate.
    }
  }
  return null;
}
