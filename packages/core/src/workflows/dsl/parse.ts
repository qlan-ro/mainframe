// packages/core/src/workflows/dsl/parse.ts
import { parse as parseYaml } from 'yaml';
import { workflowSchema } from './schema.js';
import type { WorkflowDef } from './types.js';

export class WorkflowParseError extends Error {}

/** Accept if/then/else sugar and desugar it to the canonical choose form. */
function desugarIf(step: Record<string, unknown>): Record<string, unknown> {
  if (!('if' in step)) return step;
  const { if: cond, then: thenSteps, else: elseSteps, ...rest } = step;
  const arms: unknown[] = [{ when: cond, steps: thenSteps }];
  if (elseSteps !== undefined) {
    arms.push({ else: true, steps: elseSteps });
  }
  return { ...rest, choose: arms };
}

/** Recursively desugar if/then/else throughout a steps array. */
function desugarSteps(steps: unknown[]): unknown[] {
  return steps.map((rawStep) => {
    const step = desugarIf(rawStep as Record<string, unknown>);
    return desugarStepChildren(step);
  });
}

/** Walk into nested step arrays (choose arms, foreach, parallel). */
function desugarStepChildren(step: Record<string, unknown>): Record<string, unknown> {
  const result = { ...step };

  if (Array.isArray(result['choose'])) {
    result['choose'] = (result['choose'] as Array<Record<string, unknown>>).map((arm) => ({
      ...arm,
      steps: Array.isArray(arm['steps']) ? desugarSteps(arm['steps'] as unknown[]) : arm['steps'],
    }));
  }

  if (Array.isArray(result['steps'])) {
    result['steps'] = desugarSteps(result['steps'] as unknown[]);
  }

  if (result['parallel'] && typeof result['parallel'] === 'object') {
    const parallel: Record<string, unknown> = {};
    for (const [key, branch] of Object.entries(result['parallel'] as Record<string, unknown>)) {
      parallel[key] = Array.isArray(branch) ? desugarSteps(branch as unknown[]) : branch;
    }
    result['parallel'] = parallel;
  }

  return result;
}

/** Parse a YAML string into a validated WorkflowDef. Throws WorkflowParseError on failure. */
export function parseWorkflowYaml(source: string): WorkflowDef {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    throw new WorkflowParseError(`invalid YAML: ${String(err)}`);
  }

  // Desugar if/then/else before schema validation
  if (raw !== null && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)['steps'])) {
    const doc = raw as Record<string, unknown>;
    raw = {
      ...doc,
      steps: desugarSteps(doc['steps'] as unknown[]),
    };
  }

  const result = workflowSchema.safeParse(raw);
  if (!result.success) {
    const msgs = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new WorkflowParseError(msgs);
  }
  return result.data as WorkflowDef;
}
