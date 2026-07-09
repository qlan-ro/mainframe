/**
 * yaml-parse — canonical YAML → WfDraft, the inverse of yaml-serialize.
 *
 * Owns the top-level shape mapping (triggers/inputs/vars/outputs canonicalization,
 * scope defaulting) and delegates per-step/arm/field/trigger mapping to
 * yaml-parse-steps.ts, keeping both files ≤ 300 lines / functions ≤ 50 lines.
 */
import { parse as parseYaml } from 'yaml';
import type { WfDraft, WfInput, WfOutput, WfVar } from './wf-draft-types';
import { mapSteps, mapTrigger } from './yaml-parse-steps';

export type WfParseResult = { ok: true; draft: WfDraft; hasComments: boolean } | { ok: false; reason: string };

function mapInputs(raw: unknown): WfInput[] {
  const obj = (raw ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(obj).map(([name, v]) => ({
    name,
    type: v['type'] as string,
    title: v['title'] as string | undefined,
    default: v['default'],
    required: v['required'] as boolean | undefined,
    enum: v['enum'] as unknown[] | undefined,
  }));
}

function mapVars(raw: unknown): WfVar[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

function mapOutputs(raw: unknown): WfOutput[] {
  const obj = (raw ?? {}) as Record<string, string>;
  return Object.entries(obj).map(([name, expr]) => ({ name, expr }));
}

/**
 * Detects comments outside quoted scalars — a `#` at line-start or preceded
 * by whitespace, the same rule YAML itself uses to start a comment. This is
 * intentionally conservative toward over-detection: a stray `#` inside an
 * unquoted plain scalar merely triggers an unnecessary hydration banner,
 * whereas under-detection would silently destroy a user's comments on save.
 */
function hasComments(source: string): boolean {
  const withoutQuoted = source.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^']|'')*'/g, "''");
  return /(^|\s)#/m.test(withoutQuoted);
}

function mapTriggers(raw: unknown): { ok: true; triggers: WfDraft['triggers'] } | { ok: false; reason: string } {
  const triggers: WfDraft['triggers'] = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const res = mapTrigger(t);
    if (!res.ok) return res;
    triggers.push(res.trigger);
  }
  return { ok: true, triggers };
}

/** Parses canonical workflow YAML into a WfDraft, or ok:false for malformed/unsupported input. */
export function parseWorkflowToDraft(source: string): WfParseResult {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    return { ok: false, reason: `invalid YAML: ${String(err)}` };
  }
  if (raw === null || typeof raw !== 'object') return { ok: false, reason: 'workflow must be a YAML mapping' };
  const doc = raw as Record<string, unknown>;

  const triggersResult = mapTriggers(doc['triggers']);
  if (!triggersResult.ok) return triggersResult;

  const stepsResult = mapSteps(doc['steps']);
  if (!stepsResult.ok) return stepsResult;

  const draft: WfDraft = {
    name: typeof doc['name'] === 'string' ? doc['name'] : '',
    description: typeof doc['description'] === 'string' ? doc['description'] : '',
    scope: 'project',
    triggers: triggersResult.triggers,
    inputs: mapInputs(doc['inputs']),
    vars: mapVars(doc['vars']),
    steps: stepsResult.steps,
    outputs: mapOutputs(doc['outputs']),
  };

  return { ok: true, draft, hasComments: hasComments(source) };
}
