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
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep } from '../contract';
import { mintOutputNames, variableNamesInDefinition } from '../domain/output-name';

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
export function applyVariableRenames(
  previous: AutomationDefinition,
  next: AutomationDefinition,
  catalog: ActionCatalogEntry[],
): AutomationDefinition {
  const before = setValueNames(previous.steps, new Map());
  const after = setValueNames(next.steps, new Map());

  let result = next;
  for (const [id, oldName] of before) {
    const newName = after.get(id);
    if (!oldName || !newName || newName === oldName) continue;
    // Landing on a name something else already claims would rewrite *that*
    // holder's own refs onto this step. Definition-wide, not scope-wide: the
    // rewrite is textual, so it reaches into repeat bodies that share no scope.
    // Leaving the refs put keeps them meaning what they meant, and `validate`
    // reports the duplicate name the edit created.
    if (variableNamesInDefinition(next, catalog, id).has(newName)) continue;
    result = renameVariableInDefinition(result, oldName, newName);
  }
  return result;
}

/**
 * A recipe edit applied to the whole definition: the renames it carries, then
 * an `outputName` for every producer that still lacks one. Minting here rather
 * than in `Recipe` covers every insertion path at once — a nested `Recipe`'s
 * `onChange` bubbles up through its `BlockCard` to this one call.
 */
export function applyStepsEdit(
  previous: AutomationDefinition,
  steps: AutomationStep[],
  catalog: ActionCatalogEntry[],
): AutomationDefinition {
  return mintOutputNames(applyVariableRenames(previous, { ...previous, steps }, catalog), catalog);
}
