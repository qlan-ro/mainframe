/**
 * Definition-level patch helpers — edits whose effect reaches beyond the step
 * being edited, applied where the editor owns the whole definition.
 *
 * Renaming a set-value step is the only such edit: every later `$oldname` has
 * to follow it or the automation breaks. It is derived from the patch (old
 * definition vs new) rather than dispatched from the pane, because the pane
 * sits behind Recipe → BlockCard → Recipe → StepCard, and a callback threaded
 * through those would fail silently on any nesting path that forgot to pass it.
 */
import { renameVariableInDefinition } from '@qlan-ro/mainframe-types';
import type { AutomationDefinition, AutomationStep } from '../contract';

/** Set-value names by step id, at any depth — a rename inside a block is still a rename. */
function setValueNames(steps: AutomationStep[], into: Map<string, string>): Map<string, string> {
  for (const step of steps) {
    if (step.kind === 'set_variable') into.set(step.id, step.name.trim());
    if (step.kind === 'if') {
      setValueNames(step.then, into);
      setValueNames(step.otherwise, into);
    }
    if (step.kind === 'repeat') setValueNames(step.steps, into);
  }
  return into;
}

/**
 * `next` with every reference to a renamed value rewritten. A name appearing
 * or disappearing is not a rename — nothing referred to an unnamed value, and
 * refs to a cleared one stay put until a real name replaces it, where
 * `validate` reports them meanwhile.
 *
 * Renames are applied one at a time; a commit changes one name, so two renames
 * never chain within a single patch.
 */
export function applyVariableRenames(previous: AutomationDefinition, next: AutomationDefinition): AutomationDefinition {
  const before = setValueNames(previous.steps, new Map());
  const after = setValueNames(next.steps, new Map());

  let result = next;
  for (const [id, oldName] of before) {
    const newName = after.get(id);
    if (!oldName || !newName || newName === oldName) continue;
    result = renameVariableInDefinition(result, oldName, newName);
  }
  return result;
}
