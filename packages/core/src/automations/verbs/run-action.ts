// packages/core/src/automations/verbs/run-action.ts
//
// Task 23. `makeRunActionExecutor` is the run_action arm of VerbPorts: it
// renders every ChipText param into a single joined string (Decision 9) and
// hands it to the registered action — EXCEPT run_command's `script` param,
// which keeps chip boundaries as raw `{literal}|{chip}` parts so A1's
// per-chip env-var injection (run-command.ts) applies. `step.outputAs` is
// merged into the rendered input only for the two actions that declare it
// (run_command, files.read) — injecting it into every action would corrupt
// e.g. notion.add_row's catchall property schema.
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import type { ChipText, RunActionStep } from '@qlan-ro/mainframe-types';
import type { ActionRegistry } from '../actions/registry.js';
import type { ActionCtx, Credentials } from '../actions/types.js';
import { coerceToString, renderChipText, resolveToken, type TokenContext } from '../tokens/substitute.js';
import type { StepOutcome, VerbContext } from '../engine/types.js';

/** The only two actions whose input schema declares `outputAs` (contract §5). */
const ACTIONS_WITH_OUTPUT_AS = new Set(['run_command', 'files.read']);

export interface RunActionDeps {
  registry: ActionRegistry;
  resolveCredential: (label: string) => Credentials | null;
  resolveProjectRoot: (runId: string) => string;
  logger: Logger;
}

export function makeRunActionExecutor(deps: RunActionDeps) {
  return async function runAction(step: RunActionStep, ctx: VerbContext): Promise<StepOutcome> {
    let action;
    try {
      action = deps.registry.resolve(step.actionId);
    } catch (err) {
      return { type: 'failed', error: errorMessage(err) };
    }

    const creds = step.credential ? deps.resolveCredential(step.credential) : null;
    if (step.credential && !creds) {
      return {
        type: 'failed',
        error: `credential '${step.credential}' not found — add it via PUT /api/automation-credentials/${step.credential}`,
      };
    }

    const rawInput = buildActionInput(step, ctx.tokens);
    const parsed = action.input.safeParse(rawInput);
    if (!parsed.success) {
      return { type: 'failed', error: `invalid input for '${step.actionId}': ${parsed.error.message}` };
    }

    const actionCtx: ActionCtx = {
      creds,
      idempotencyKey: `${ctx.runId}:${ctx.stepRef}`,
      signal: ctx.signal,
      logger: deps.logger,
      resolvePath: (p) => resolve(p.startsWith('~') ? p.replace(/^~(?=$|\/)/, homedir()) : p),
      projectRoot: deps.resolveProjectRoot(ctx.runId),
    };

    try {
      const outputs = await action.run(actionCtx, parsed.data);
      return { type: 'completed', outputs };
    } catch (err) {
      return { type: 'failed', error: errorMessage(err) };
    }
  };
}

function buildActionInput(step: RunActionStep, tokens: TokenContext): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, chipText] of Object.entries(step.params)) {
    input[key] =
      step.actionId === 'run_command' && key === 'script'
        ? toRawScriptParts(chipText, tokens)
        : renderChipText(tokens, chipText);
  }
  if (step.outputAs !== undefined && ACTIONS_WITH_OUTPUT_AS.has(step.actionId)) {
    input['outputAs'] = step.outputAs;
  }
  return input;
}

/** A1: each token part becomes its own `{chip}` entry — never spliced into a shared string with literal text. */
function toRawScriptParts(chipText: ChipText, tokens: TokenContext): Array<{ literal: string } | { chip: string }> {
  return chipText.map((part) =>
    typeof part === 'string' ? { literal: part } : { chip: coerceToString(resolveToken(tokens, part.token)) },
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
