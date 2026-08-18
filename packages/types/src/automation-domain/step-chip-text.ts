/**
 * One traversal of every `ChipText` a step tree carries. Three passes need it —
 * the load-time `{token}` → `$name` upgrade, the save-time inverse, and
 * set-value renames — and each one silently skipping a field would be a
 * different half-converted definition, so the field list lives here once.
 */
import type { AutomationStep, ChipText } from '../automation.js';

/** `(value, owner)` — the owner is the step the field belongs to, which callers need to resolve names in that step's own scope. */
export type ChipTextMapper = (value: ChipText, owner: AutomationStep) => ChipText;

export function mapStepChipText(step: AutomationStep, map: ChipTextMapper): AutomationStep {
  const value = (chipText: ChipText): ChipText => map(chipText, step);
  switch (step.kind) {
    case 'ask_agent': {
      const next: AutomationStep = { ...step, prompt: value(step.prompt) };
      if (step.worktree) next.worktree = { ...step.worktree, branchName: value(step.worktree.branchName) };
      return next;
    }
    case 'notify':
      return { ...step, message: value(step.message) };
    case 'set_variable':
      return { ...step, value: value(step.value) };
    case 'run_action':
      return {
        ...step,
        params: Object.fromEntries(Object.entries(step.params).map(([key, param]) => [key, value(param)])),
      };
    case 'if':
      return {
        ...step,
        then: step.then.map((inner) => mapStepChipText(inner, map)),
        otherwise: step.otherwise.map((inner) => mapStepChipText(inner, map)),
      };
    case 'repeat':
      return { ...step, steps: step.steps.map((inner) => mapStepChipText(inner, map)) };
    case 'loop':
      return { ...step, steps: step.steps.map((inner) => mapStepChipText(inner, map)) };
    case 'ask_me':
    case 'wait':
    case 'break':
      return step;
  }
}
