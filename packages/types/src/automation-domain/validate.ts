/**
 * Plain-language, scope-aware validation (ts153 wf2-editor.jsx `wf2Validate`,
 * ported off label/source tracking onto real `TokenRef` resolution). Every
 * issue is pinned to the offending `stepId` (`null` only for automation-level
 * issues) so `StepCard` can render a red strip on the card itself.
 */
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep, TokenRef } from '../automation.js';
import { TOKEN_STEP_BUILTIN } from '../automation.js';
import { resolveTokenRef } from './resolve.js';
import { scopeAt } from './token-scope.js';

export interface ValidationIssue {
  stepId: string | null;
  level: 'error' | 'warning';
  msg: string;
}

/** Every TokenRef a step directly uses — chip-text fields and the direct-TokenRef fields (If's condition tokens, Repeat's `items`). */
function collectTokenRefs(step: AutomationStep): TokenRef[] {
  const refs: TokenRef[] = [];
  const eat = (parts?: Array<string | { token: TokenRef }>) => {
    (parts ?? []).forEach((p) => {
      if (typeof p === 'object' && p !== null && 'token' in p) refs.push(p.token);
    });
  };
  switch (step.kind) {
    case 'ask_agent':
      eat(step.prompt);
      if (step.worktree) eat(step.worktree.branchName);
      break;
    case 'run_action':
      Object.values(step.params).forEach(eat);
      break;
    case 'notify':
      eat(step.message);
      break;
    case 'if':
      step.conditions.forEach((c) => refs.push(c.token));
      break;
    case 'repeat':
      refs.push(step.items);
      break;
    case 'ask_me':
      break;
  }
  return refs;
}

export function validate(
  name: string,
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!name.trim()) issues.push({ stepId: null, level: 'error', msg: 'Give your automation a name.' });
  if (definition.steps.length === 0) issues.push({ stepId: null, level: 'error', msg: 'Add at least one step.' });

  const checkTokenRef = (step: AutomationStep, ref: TokenRef) => {
    if (ref.stepId === TOKEN_STEP_BUILTIN) return; // always in scope
    const inScope = scopeAt(definition, catalog, step.id).some(
      (t) => t.ref.stepId === ref.stepId && t.ref.output === ref.output,
    );
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
      for (const ref of collectTokenRefs(step)) checkTokenRef(step, ref);

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
        const itemsToken = scopeAt(definition, catalog, step.id).find(
          (t) => t.ref.stepId === step.items.stepId && t.ref.output === step.items.output,
        );
        if (itemsToken && itemsToken.type !== 'list') {
          issues.push({
            stepId: step.id,
            level: 'error',
            msg: `"${itemsToken.label}" isn't a list — pick a value that produces a list to repeat over.`,
          });
        }
        walk(step.steps);
      }
    }
  };
  walk(definition.steps);

  return issues;
}
