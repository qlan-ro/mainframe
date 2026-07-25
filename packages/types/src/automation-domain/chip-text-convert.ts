/**
 * The bridge between the wire's `ChipText` and the plain text the editor now
 * edits. Fields stay `ChipText` on the wire (a `["plain string"]` array is
 * already valid), so nothing about the contract changes.
 *
 * The two directions are inverses and both run at a boundary: `{token}` parts
 * become `$name` on load, and `$name` refs become `{token}` parts again on
 * save. Converting back matters because a `{token}` addresses a step
 * *structurally* — surviving any later renaming or reordering — while `$name`
 * is resolved through the namespace in scope. Saving text-only would leave the
 * automation's meaning riding on names alone.
 */
import type { ActionCatalogEntry, AutomationDefinition, ChipText, TokenRef } from '../automation.js';
import { isTokenPart } from './chip-parts.js';
import { mapStepChipText } from './step-chip-text.js';
import { scopeAt } from './token-scope.js';
import {
  buildVariableNamespace,
  extractVariableRefs,
  formatVariableRef,
  sanitizeVariableName,
  type VariableNamespace,
} from './variables.js';

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
  let text = '';
  for (const part of parts) {
    if (!isTokenPart(part)) {
      text += part;
      continue;
    }
    const name = nameFor(part.token) ?? sanitizeVariableName(part.token.output);
    const path = part.token.field ? part.token.field.split('.') : [];
    // A token landing mid-word (`todo/` + ref) has to be written `${name}`:
    // a bare `$` there is literal text no extractor would ever see.
    text += formatVariableRef(name, path, text);
  }
  return text;
}

/** Edited text back onto the wire. Empty text is no parts, the spelling the contract already uses for an unfilled field. */
export function textToChipText(text: string): ChipText {
  return text === '' ? [] : [text];
}

/**
 * Edited text with every resolvable `$name` turned back into the `{token}` it
 * came from. A name nothing in scope defines stays literal text — the user is
 * mid-edit, or typed a `$` that means nothing here, and `validate` reports it.
 */
export function textToRefs(text: string, namespace: VariableNamespace): ChipText {
  const parts: ChipText = [];
  let cursor = 0;
  for (const ref of extractVariableRefs(text)) {
    const descriptor = namespace.byName.get(ref.name);
    if (!descriptor) continue;
    if (ref.start > cursor) parts.push(text.slice(cursor, ref.start));
    const token: TokenRef = { stepId: descriptor.ref.stepId, output: descriptor.ref.output };
    if (ref.path.length > 0) token.field = ref.path.join('.');
    parts.push({ token });
    cursor = ref.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function convertDefinition(
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
  convert: (value: ChipText, namespace: VariableNamespace) => ChipText,
): AutomationDefinition {
  const steps = definition.steps.map((step) =>
    mapStepChipText(step, (value, owner) =>
      convert(value, buildVariableNamespace(scopeAt(definition, catalog, owner.id))),
    ),
  );
  return { ...definition, steps };
}

/**
 * One-time load-time upgrade: every ChipText field in `definition` becomes
 * guaranteed single-string text (legacy `{token}` parts resolved to their
 * `$name` via the namespace in scope at that field's own step). Called once
 * in `AutomationEditor.draftFrom`; every step config component downstream
 * only ever reads/writes plain strings, never re-running this resolution.
 */
export function normalizeDefinitionChipText(
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
): AutomationDefinition {
  return convertDefinition(definition, catalog, (value, namespace) =>
    textToChipText(chipTextToText(value, namespace.nameFor)),
  );
}

/**
 * The save-side inverse of `normalizeDefinitionChipText`: the text the editor
 * produced, with every in-scope `$name` restored to a structural `{token}`.
 * Called once in `AutomationEditor.handleSave`, so a definition survives a trip
 * through the editor with its refs intact.
 */
export function definitionTextToRefs(
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
): AutomationDefinition {
  return convertDefinition(definition, catalog, (value, namespace) =>
    textToRefs(chipTextToText(value, namespace.nameFor), namespace),
  );
}
