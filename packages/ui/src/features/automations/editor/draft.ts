/**
 * The editor's draft, and the two conversions a definition makes on its way in
 * and out of it. They live together because they are inverses: whatever the
 * load side turns into text, the save side has to turn back.
 *
 * In: every producer without an `outputName` gets one — the ordinal that keeps
 * `$agent_result` pointing at the same step when another producer is later
 * inserted above it — and the saved `{token}` parts become `$name` text.
 * Out: the text becomes `{token}` parts again, so a saved automation addresses
 * its steps structurally rather than by a name that later edits can move.
 */
import type { ActionCatalogEntry, AutomationDefinition } from '../contract';
import { definitionTextToRefs, normalizeDefinitionChipText } from '../domain/chip-text-convert';
import { mintOutputNames } from '../domain/output-name';
import { stampAgentProjectId } from './stamp-agent-project-id';

export interface DraftState {
  name: string;
  description: string;
  definition: AutomationDefinition;
}

export const EMPTY_DRAFT: DraftState = {
  name: '',
  description: '',
  definition: { triggers: [], steps: [] },
};

export function draftFrom(
  input: { name: string; description?: string; definition: AutomationDefinition },
  catalog: ActionCatalogEntry[],
): DraftState {
  return {
    name: input.name,
    description: input.description ?? '',
    definition: normalizeDefinitionChipText(mintOutputNames(input.definition, catalog), catalog),
  };
}

/** The draft's definition as it goes on the wire. */
export function definitionToSave(
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
  projectId: string,
): AutomationDefinition {
  const saved = definitionTextToRefs(definition, catalog);
  return { ...saved, steps: stampAgentProjectId(saved.steps, projectId) };
}
