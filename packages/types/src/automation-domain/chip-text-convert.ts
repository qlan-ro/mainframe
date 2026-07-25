/**
 * The bridge between the wire's `ChipText` and the plain text the editor now
 * edits. Fields stay `ChipText` on the wire (a `["plain string"]` array is
 * already valid), so nothing about the contract changes: the editor reads text
 * in, writes a single string part back, and legacy `{token}` parts are upgraded
 * to `$name` on load.
 */
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep, ChipText, TokenRef } from '../automation.js';
import { isTokenPart } from './chip-parts.js';
import { scopeAt } from './token-scope.js';
import { buildVariableNamespace, sanitizeVariableName } from './variables.js';

/**
 * A saved field as editable text. Pass the `nameFor` of a namespace built at
 * this step (`buildVariableNamespace(scopeAt(definition, catalog, stepId))`) —
 * names are position-dependent, so a namespace from anywhere else can rebind a
 * ref to a different step.
 *
 * A ref whose step is gone has no name to take; it degrades to the sanitized
 * output name rather than inventing syntax, and `validate` then reports it as a
 * `$name` nothing defines.
 */
export function chipTextToText(parts: ChipText, nameFor: (ref: TokenRef) => string | null): string {
  return parts
    .map((part) => {
      if (!isTokenPart(part)) return part;
      const name = nameFor(part.token) ?? sanitizeVariableName(part.token.output);
      return part.token.field ? `$${name}.${part.token.field}` : `$${name}`;
    })
    .join('');
}

/** Edited text back onto the wire. Empty text is no parts, the spelling the contract already uses for an unfilled field. */
export function textToChipText(text: string): ChipText {
  return text === '' ? [] : [text];
}

function normalizeChipText(definition: AutomationDefinition, catalog: ActionCatalogEntry[], stepId: string, value: ChipText): ChipText {
  const { nameFor } = buildVariableNamespace(scopeAt(definition, catalog, stepId));
  return textToChipText(chipTextToText(value, nameFor));
}

function normalizeStep(definition: AutomationDefinition, catalog: ActionCatalogEntry[], step: AutomationStep): AutomationStep {
  const normalize = (value: ChipText): ChipText => normalizeChipText(definition, catalog, step.id, value);
  switch (step.kind) {
    case 'ask_agent': {
      const next: AutomationStep = { ...step, prompt: normalize(step.prompt) };
      if (step.worktree) next.worktree = { ...step.worktree, branchName: normalize(step.worktree.branchName) };
      return next;
    }
    case 'notify':
      return { ...step, message: normalize(step.message) };
    case 'set_variable':
      return { ...step, value: normalize(step.value) };
    case 'run_action':
      return {
        ...step,
        params: Object.fromEntries(Object.entries(step.params).map(([key, value]) => [key, normalize(value)])),
      };
    case 'if':
      return {
        ...step,
        then: step.then.map((inner) => normalizeStep(definition, catalog, inner)),
        otherwise: step.otherwise.map((inner) => normalizeStep(definition, catalog, inner)),
      };
    case 'repeat':
      return { ...step, steps: step.steps.map((inner) => normalizeStep(definition, catalog, inner)) };
    case 'ask_me':
      return step;
  }
}

/**
 * One-time load-time upgrade: every ChipText field in `definition` becomes
 * guaranteed single-string text (legacy `{token}` parts resolved to their
 * `$name` via the namespace in scope at that field's own step). Called once
 * in `AutomationEditor.draftFrom`; every step config component downstream
 * only ever reads/writes plain strings, never re-running this resolution.
 */
export function normalizeDefinitionChipText(definition: AutomationDefinition, catalog: ActionCatalogEntry[]): AutomationDefinition {
  return { ...definition, steps: definition.steps.map((step) => normalizeStep(definition, catalog, step)) };
}
