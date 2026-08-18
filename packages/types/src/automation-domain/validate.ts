/**
 * Plain-language, scope-aware validation (ts153 wf2-editor.jsx `wf2Validate`,
 * ported off label/source tracking onto real `TokenRef` resolution). Every
 * issue is pinned to the offending `stepId` (`null` only for automation-level
 * issues) so `StepCard` can render a red strip on the card itself.
 */
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep, ChipText, TokenRef } from '../automation.js';
import { TOKEN_STEP_BUILTIN } from '../automation.js';
import { isTokenPart } from './chip-parts.js';
import { variableNamesClashingWith } from './output-name.js';
import { resolveTokenRef } from './resolve.js';
import { scopeAt } from './token-scope.js';
import type { TokenDescriptor } from './tokens.js';
import { extractVariableRefs, variableNamesInScope } from './variables.js';

export interface ValidationIssue {
  stepId: string | null;
  level: 'error' | 'warning';
  msg: string;
}

/** Repeat's fan-out bound, shared: a loop pass writes the same suffixed entries an iteration does, so it inherits the same checkpoint-growth ceiling. */
const MAX_LOOP_PASSES = 500;

/** A set-variable name has to survive being typed as `$name`, so it is an identifier, not free text. */
const VARIABLE_NAME = /^[a-z_][a-z0-9_]*$/;

/** Every free-text field a step carries — where both legacy `{token}` parts and `$name` refs live. */
function collectChipTexts(step: AutomationStep): ChipText[] {
  switch (step.kind) {
    case 'ask_agent':
      return step.worktree ? [step.prompt, step.worktree.branchName] : [step.prompt];
    case 'run_action':
      return Object.values(step.params);
    case 'notify':
      return [step.message];
    case 'set_variable':
      return [step.value];
    case 'if':
    case 'repeat':
    case 'ask_me':
    case 'wait':
    case 'break':
    case 'loop':
    case 'retry':
      return [];
  }
}

/** Every TokenRef a step directly uses — chip-text fields and the direct-TokenRef fields (If's condition tokens, Repeat's `items`). */
function collectTokenRefs(step: AutomationStep): TokenRef[] {
  const refs = collectChipTexts(step)
    .flat()
    .filter(isTokenPart)
    .map((part) => part.token);
  if (step.kind === 'if' || step.kind === 'loop') refs.push(...step.conditions.map((c) => c.token));
  if (step.kind === 'repeat') refs.push(step.items);
  return refs;
}

/** Names a step's text refers to that nothing upstream defines. Deduped, so a name repeated three times reports once. */
function unresolvedVariableNames(step: AutomationStep, inScope: Set<string>): string[] {
  const unresolved = new Set<string>();
  for (const part of collectChipTexts(step).flat()) {
    if (isTokenPart(part)) continue;
    for (const ref of extractVariableRefs(part)) {
      if (!inScope.has(ref.name)) unresolved.add(ref.name);
    }
  }
  return [...unresolved];
}

/**
 * A set-variable step's own name, checked against every name that clashes with
 * it (`variableNamesClashingWith`, which excludes this step's own).
 *
 * Region-wide, not scope-wide: a name defined *later* is still taken. Two `if`
 * branches each naming a value `summary` both validate against the same
 * pre-branch scope, yet both leak into scope after the block, where the `then`
 * arm wins and every `$summary` written for the `otherwise` arm renders empty.
 *
 * Exported so the editor's pane can refuse a bad name at the keystroke that
 * produced it, in the same words the footer would use once saved.
 */
export function setVariableNameIssue(name: string, taken: Set<string>): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give this value a name.';
  if (!VARIABLE_NAME.test(trimmed))
    return 'Use lowercase letters, numbers and underscores for a value name, starting with a letter.';
  if (taken.has(trimmed)) return `Another value in this automation is already called $${trimmed} — rename one of them.`;
  return null;
}

export function validate(
  name: string,
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!name.trim()) issues.push({ stepId: null, level: 'error', msg: 'Give your automation a name.' });
  if (definition.steps.length === 0) issues.push({ stepId: null, level: 'error', msg: 'Add at least one step.' });

  const checkTokenRef = (step: AutomationStep, scope: TokenDescriptor[], ref: TokenRef) => {
    if (ref.stepId === TOKEN_STEP_BUILTIN) return; // always in scope
    const inScope = scope.some((t) => t.ref.stepId === ref.stepId && t.ref.output === ref.output);
    if (inScope) return;
    const resolved = resolveTokenRef(definition, catalog, ref);
    if (!resolved) {
      issues.push({
        stepId: step.id,
        level: 'error',
        msg: 'This step uses a value that no longer exists — pick a new one.',
      });
    } else {
      issues.push({
        stepId: step.id,
        level: 'error',
        msg: `This step uses "${resolved.label}" from "${resolved.source}", which isn't available here.`,
      });
    }
  };

  const walk = (steps: AutomationStep[]) => {
    for (const step of steps) {
      const scope = scopeAt(definition, catalog, step.id);
      const namesInScope = variableNamesInScope(scope);

      for (const ref of collectTokenRefs(step)) checkTokenRef(step, scope, ref);
      // A warning, not an error: the engine leaves an unresolved `$name`
      // literal (tokens/substitute.rs `render_variable_text`), so a prompt
      // saying `cd $HOME && pnpm build` runs exactly as written. Blocking Save
      // on it made a legitimate shell command unsaveable.
      for (const name of unresolvedVariableNames(step, namesInScope)) {
        issues.push({
          stepId: step.id,
          level: 'warning',
          msg: `This step uses $${name}, but no earlier step defines it.`,
        });
      }
      if (step.kind === 'set_variable') {
        const msg = setVariableNameIssue(step.name, variableNamesClashingWith(definition, catalog, step.id));
        if (msg) issues.push({ stepId: step.id, level: 'error', msg });
      }

      if (step.kind === 'ask_me') {
        for (const field of step.fields) {
          if (!field.label && !field.key)
            issues.push({ stepId: step.id, level: 'error', msg: 'A form field needs a label.' });
          if ((field.type === 'choice' || field.type === 'multi') && !(field.options && field.options.length > 0)) {
            issues.push({
              stepId: step.id,
              level: 'error',
              msg: `"${field.label || field.key}" is a choice with no options.`,
            });
          }
        }
      }
      if (step.kind === 'run_action' && !step.actionId) {
        issues.push({ stepId: step.id, level: 'error', msg: 'Choose an action for this step.' });
      }
      if (step.kind === 'if') {
        walk(step.then);
        walk(step.otherwise);
      }
      if (step.kind === 'repeat') {
        // Only check type once `checkTokenRef` above has confirmed `items` is
        // in scope — an out-of-scope ref already gets its own existence
        // error, and piling a second, contradictory message on top of it
        // would be confusing.
        const itemsToken = scope.find((t) => t.ref.stepId === step.items.stepId && t.ref.output === step.items.output);
        if (itemsToken && itemsToken.type !== 'list') {
          issues.push({
            stepId: step.id,
            level: 'error',
            msg: `"${itemsToken.label}" isn't a list — pick a value that produces a list to repeat over.`,
          });
        }
        walk(step.steps);
      }
      if (step.kind === 'loop') {
        if (step.conditions.length === 0) {
          issues.push({ stepId: step.id, level: 'error', msg: 'Add a condition — a loop with none would never stop.' });
        }
        if (!step.maxIterations) {
          issues.push({ stepId: step.id, level: 'error', msg: 'Set how many passes this loop may run.' });
        } else if (step.maxIterations > MAX_LOOP_PASSES) {
          issues.push({ stepId: step.id, level: 'error', msg: `A loop can run at most ${MAX_LOOP_PASSES} passes.` });
        }
        walk(step.steps);
      }
      if (step.kind === 'retry') {
        if (!step.maxAttempts) {
          issues.push({ stepId: step.id, level: 'error', msg: 'Set how many times this should be tried.' });
        } else if (step.maxAttempts > MAX_LOOP_PASSES) {
          issues.push({ stepId: step.id, level: 'error', msg: `A retry can run at most ${MAX_LOOP_PASSES} attempts.` });
        }
        walk(step.steps);
      }
    }
  };
  walk(definition.steps);

  return issues;
}
