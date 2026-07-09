/**
 * wf-validate-map — maps validate/save error messages to the step rows they
 * describe (Task 21, Finding 4c).
 *
 * Two message shapes reach the UI; the index-path form is primary:
 *  - Primary: a zod field-path error from `parseWorkflowYaml`, joined as
 *    `path.join('.'): message` (core/workflows/dsl/parse.ts) — e.g.
 *    `steps.1.choose.0.steps.0: ...`. `parseStepAddressedMessage` converts
 *    the index-path prefix to a `WfStepPath` and resolves it against the
 *    draft via `wf-step-path.ts`'s `getStepsAtPath`.
 *  - Fallback: `verifyWorkflow`'s scope errors embed a literal `step '<id>'`
 *    substring (core/workflows/dsl/verify.ts); `parseFallbackStepId` extracts it.
 * Anything neither resolves is returned in `unmapped` for the caller to
 * surface generically (the save toast).
 */
import type { WfDraft, WfStep } from './wf-draft-types';
import type { WfStepPath } from './config/wf-scope';
import { getStepsAtPath } from './wf-step-path';

export interface WfValidateMapResult {
  stepErrors: Record<string, string>;
  unmapped: string[];
}

interface ParsedStepAddress {
  path: WfStepPath;
  message: string;
}

/** Splits a `path.join('.'): msg` messages joined with `'; '` (WorkflowParseError's join). */
export function splitJoinedErrorMessage(raw: string): string[] {
  return raw
    .split('; ')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses `steps.<i>(.choose.<a>.steps.<j> | .steps.<k> | .parallel.<name>.<j>)*: msg` into a step path + message. */
export function parseStepAddressedMessage(raw: string): ParsedStepAddress | null {
  const sep = raw.indexOf(': ');
  if (sep === -1) return null;
  const segments = raw.slice(0, sep).split('.');
  const message = raw.slice(sep + 2);
  if (segments[0] !== 'steps' || !/^\d+$/.test(segments[1] ?? '')) return null;

  const path: WfStepPath = [Number(segments[1])];
  let i = 2;
  while (i < segments.length) {
    if (
      segments[i] === 'choose' &&
      /^\d+$/.test(segments[i + 1] ?? '') &&
      segments[i + 2] === 'steps' &&
      /^\d+$/.test(segments[i + 3] ?? '')
    ) {
      path.push({ arm: Number(segments[i + 1]) }, Number(segments[i + 3]));
      i += 4;
    } else if (segments[i] === 'steps' && /^\d+$/.test(segments[i + 1] ?? '')) {
      path.push(Number(segments[i + 1]));
      i += 2;
    } else if (segments[i] === 'parallel' && segments[i + 1] !== undefined && /^\d+$/.test(segments[i + 2] ?? '')) {
      path.push({ branch: segments[i + 1]! }, Number(segments[i + 2]));
      i += 3;
    } else {
      break;
    }
  }
  return { path, message };
}

/** Extracts the `step '<id>'` substring fallback, or null. */
export function parseFallbackStepId(raw: string): string | null {
  return raw.match(/step '([^']+)'/)?.[1] ?? null;
}

function resolveStepAtPath(steps: WfStep[], path: WfStepPath): WfStep | undefined {
  const idx = path[path.length - 1];
  if (typeof idx !== 'number') return undefined;
  return getStepsAtPath(steps, path.slice(0, -1))[idx];
}

function collectStepIds(steps: WfStep[], out: Set<string>): void {
  for (const step of steps) {
    out.add(step.id);
    if (step.kind === 'choose') step.arms.forEach((arm) => collectStepIds(arm.steps, out));
    if (step.kind === 'foreach') collectStepIds(step.steps, out);
    if (step.kind === 'parallel') Object.values(step.branches).forEach((b) => collectStepIds(b, out));
  }
}

function appendMessage(existing: string | undefined, next: string): string {
  return existing ? `${existing}; ${next}` : next;
}

/** Maps validate/save error messages to the step rows they describe. */
export function mapValidationErrorsToSteps(messages: string[], draft: WfDraft): WfValidateMapResult {
  const stepErrors: Record<string, string> = {};
  const unmapped: string[] = [];
  const allIds = new Set<string>();
  collectStepIds(draft.steps, allIds);

  for (const raw of messages) {
    const primary = parseStepAddressedMessage(raw);
    const primaryStep = primary && resolveStepAtPath(draft.steps, primary.path);
    if (primary && primaryStep) {
      stepErrors[primaryStep.id] = appendMessage(stepErrors[primaryStep.id], primary.message);
      continue;
    }

    const fallbackId = parseFallbackStepId(raw);
    if (fallbackId && allIds.has(fallbackId)) {
      stepErrors[fallbackId] = appendMessage(stepErrors[fallbackId], raw);
      continue;
    }

    unmapped.push(raw);
  }

  return { stepErrors, unmapped };
}
