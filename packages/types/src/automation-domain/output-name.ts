/**
 * Minting a producing step's `outputName` — the stored ordinal that makes
 * `$agent_result` mean the same step no matter where the step later sits.
 *
 * Without it, `buildVariableNamespace` suffixed by position, so inserting a
 * producer *above* an existing one handed the newcomer the bare name and
 * silently demoted the incumbent to `_2`; every `$agent_result` already written
 * downstream then pointed at the wrong step, and `validate` saw nothing wrong.
 *
 * Two rules make the ordinal stable:
 * - A step that already has an `outputName` never gets a new one. Its names are
 *   `reserved` up front, definition-wide, so a newcomer minted anywhere avoids
 *   them regardless of scope.
 * - A newcomer's ordinal is minted against the names in scope where it sits,
 *   which reproduces the names a pre-`outputName` definition already had — with
 *   one deliberate exception: an `if`'s two branches share one namespace, since
 *   both leak into scope after the block (M6). Two agent steps, one per branch,
 *   are therefore `$agent_result` and `$agent_result_2`, not two `$agent_result`
 *   where the `then` arm wins and the `otherwise` arm renders empty.
 */
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep } from '../automation.js';
import {
  builtinTokens,
  findStepById,
  outputNameOrdinal,
  stepProduces,
  triggerTokens,
  type TokenDescriptor,
} from './tokens.js';
import { variableNameFor, variableNamesInScope } from './variables.js';

/** Steps that carry an `outputName`. `set_variable` is excluded on purpose — its `name` is the user's, explicit and never suffixed. */
function isProducingStep(step: AutomationStep): step is Extract<AutomationStep, { outputName?: string }> {
  return step.kind === 'ask_agent' || step.kind === 'ask_me' || step.kind === 'run_action';
}

/** Every name one step claims: a set-value's own name, or each output of a producing step at `ordinal` — the step's stored one unless a caller is mid-mint and has just chosen it. */
function namesClaimedBy(
  step: AutomationStep,
  catalog: ActionCatalogEntry[],
  ordinal: number | undefined = outputNameOrdinal(step),
): string[] {
  if (step.kind === 'set_variable') {
    const trimmed = step.name.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!isProducingStep(step)) return [];
  const suffix = ordinal === undefined ? '' : `_${ordinal}`;
  return stepProduces(step, catalog).map((descriptor) => variableNameFor(descriptor) + suffix);
}

function eachStep(steps: AutomationStep[], visit: (step: AutomationStep) => void): void {
  for (const step of steps) {
    visit(step);
    if (step.kind === 'if') {
      eachStep(step.then, visit);
      eachStep(step.otherwise, visit);
    } else if (step.kind === 'repeat') {
      eachStep(step.steps, visit);
    }
  }
}

/**
 * Every name any step in the definition claims, at any depth and regardless of
 * scope — the set a *rename* has to stay clear of.
 *
 * Wider than `variableNamesClashingWith` on purpose: a rename rewrites `$old`
 * as text everywhere in the definition, so landing on a name held anywhere —
 * even inside a repeat body that shares no scope — rebinds that holder's own
 * references to the renamed step.
 */
export function variableNamesInDefinition(
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
  /** Skipped entirely, so a step can be checked against everything *else* the automation claims. */
  exceptStepId?: string,
): Set<string> {
  const names = new Set<string>();
  eachStep(definition.steps, (step) => {
    if (step.id === exceptStepId) return;
    for (const name of namesClaimedBy(step, catalog)) names.add(name);
  });
  return names;
}

/** Names claimed directly in this region: `if` arms belong to the region around them, a `repeat` body is its own. */
function regionNames(
  steps: AutomationStep[],
  catalog: ActionCatalogEntry[],
  exceptStepId: string,
  into: Set<string>,
): void {
  for (const step of steps) {
    if (step.id === exceptStepId) continue;
    if (step.kind === 'if') {
      regionNames(step.then, catalog, exceptStepId, into);
      regionNames(step.otherwise, catalog, exceptStepId, into);
      continue;
    }
    if (step.kind === 'repeat') continue;
    for (const name of namesClaimedBy(step, catalog)) into.add(name);
  }
}

/** The repeat body containing `stepId`, or `null` when the step sits in this region itself. */
function enclosingRepeatBody(steps: AutomationStep[], stepId: string): AutomationStep[] | null {
  for (const step of steps) {
    if (step.kind === 'repeat') {
      if (findStepById(step.steps, stepId)) return step.steps;
      continue;
    }
    if (step.kind === 'if') {
      const inThen = enclosingRepeatBody(step.then, stepId);
      if (inThen) return inThen;
      const inOtherwise = enclosingRepeatBody(step.otherwise, stepId);
      if (inOtherwise) return inOtherwise;
    }
  }
  return null;
}

/**
 * Names a step cannot reuse: everything claimed in its own naming region and in
 * every region enclosing it, minus its own.
 *
 * A region is the top level or a `repeat` body. `if` arms belong to the region
 * around them — both leak into scope once the block closes, so two arms each
 * defining `$summary` leave the second one unaddressable (first wins, and every
 * `$summary` written for the other arm renders empty). Two sibling repeat
 * bodies are separate regions and may reuse a name, which is what the runtime
 * already does.
 */
export function variableNamesClashingWith(
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
  stepId: string,
): Set<string> {
  const names = new Set<string>();
  let steps = definition.steps;
  for (;;) {
    regionNames(steps, catalog, stepId, names);
    const body = enclosingRepeatBody(steps, stepId);
    if (!body) return names;
    steps = body;
  }
}

/** Names already spoken for by steps whose ordinal is settled — a newcomer must not take one, wherever it sits. */
function reservedNames(definition: AutomationDefinition, catalog: ActionCatalogEntry[]): Set<string> {
  const names = new Set<string>();
  eachStep(definition.steps, (step) => {
    if (isProducingStep(step) && step.outputName === undefined) return;
    for (const name of namesClaimedBy(step, catalog)) names.add(name);
  });
  return names;
}

interface MintContext {
  catalog: ActionCatalogEntry[];
  reserved: Set<string>;
  /** The name minted for each step id, by this pass only. */
  minted: Map<string, string>;
}

function mintFor(base: string, claimed: Set<string>, reserved: Set<string>): { name: string; ordinal?: number } {
  if (!claimed.has(base) && !reserved.has(base)) return { name: base };
  for (let ordinal = 2; ; ordinal += 1) {
    const name = `${base}_${ordinal}`;
    if (!claimed.has(name) && !reserved.has(name)) return { name, ordinal };
  }
}

function mintWalk(steps: AutomationStep[], claimed: Set<string>, ctx: MintContext): void {
  for (const step of steps) {
    if (step.kind === 'set_variable') {
      const trimmed = step.name.trim();
      if (trimmed) claimed.add(trimmed);
      continue;
    }
    if (step.kind === 'if') {
      // One namespace across both arms: after the block, both leak into scope.
      mintWalk(step.then, claimed, ctx);
      mintWalk(step.otherwise, claimed, ctx);
      continue;
    }
    if (step.kind === 'repeat') {
      const inner = new Set(claimed);
      inner.add('item');
      mintWalk(step.steps, inner, ctx);
      continue;
    }
    if (!isProducingStep(step)) continue;

    const descriptors = stepProduces(step, ctx.catalog);
    // Nothing to name yet (an action with no chosen `actionId`, a form with no
    // keyed fields) — minting waits for the step's first real output.
    if (descriptors.length === 0) continue;

    let ordinal = outputNameOrdinal(step);
    if (step.outputName === undefined) {
      const fresh = mintFor(variableNameFor(descriptors[0]!), claimed, ctx.reserved);
      ctx.minted.set(step.id, fresh.name);
      ordinal = fresh.ordinal;
    }
    for (const name of namesClaimedBy(step, ctx.catalog, ordinal)) claimed.add(name);
  }
}

function stampStep(step: AutomationStep, minted: Map<string, string>): AutomationStep {
  if (step.kind === 'if') {
    return {
      ...step,
      then: step.then.map((inner) => stampStep(inner, minted)),
      otherwise: step.otherwise.map((inner) => stampStep(inner, minted)),
    };
  }
  if (step.kind === 'repeat') return { ...step, steps: step.steps.map((inner) => stampStep(inner, minted)) };
  const outputName = minted.get(step.id);
  if (outputName === undefined || !isProducingStep(step)) return step;
  return { ...step, outputName };
}

/**
 * `definition` with an `outputName` on every producing step that has an output
 * and lacks one. Idempotent, and it never rewrites a name already stored: run
 * it on load and after every recipe edit, and a step's variable names are fixed
 * from the moment it first produces anything.
 */
export function mintOutputNames(definition: AutomationDefinition, catalog: ActionCatalogEntry[]): AutomationDefinition {
  const ctx: MintContext = { catalog, reserved: reservedNames(definition, catalog), minted: new Map() };
  const claimed = variableNamesInScope(builtinTokens().concat(triggerTokens(definition.triggers)));
  mintWalk(definition.steps, claimed, ctx);
  if (ctx.minted.size === 0) return definition;
  return { ...definition, steps: definition.steps.map((step) => stampStep(step, ctx.minted)) };
}
