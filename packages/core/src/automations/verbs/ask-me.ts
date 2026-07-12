// packages/core/src/automations/verbs/ask-me.ts
//
// Task 18 (contract §2, §3 "interaction resolution is one transaction").
// `makeAskMeExecutor` is the ask_me arm of VerbPorts (engine/types.ts):
// it creates the pending interaction and parks the run. `InteractionService`
// is the respond-side: validate -> claim + write into the checkpoint in
// InteractionStore.resolveInOneTx's single transaction -> advance.
import type {
  AskMeStep,
  AutomationFormField,
  AutomationInteractionSummary,
  DaemonEvent,
} from '@qlan-ro/mainframe-types';
import type { InteractionStore } from '../store/interaction-store.js';
import type { AutomationCheckpoint, AutomationInteractionRecord } from '../store/types.js';
import type { StepOutcome, VerbContext } from '../engine/types.js';

/** VerbPorts.askMe. AskMeStep has no ChipText fields (title/labels are plain strings) — nothing to render. */
export function makeAskMeExecutor(interactions: InteractionStore, emitEvent: (event: DaemonEvent) => void) {
  return async function askMe(step: AskMeStep, ctx: VerbContext): Promise<StepOutcome> {
    const existing = interactions.findPendingForStep(ctx.runId, ctx.stepRef);
    if (!existing) {
      const created = interactions.create({
        runId: ctx.runId,
        stepRef: ctx.stepRef,
        title: step.title,
        fields: step.fields,
      });
      emitEvent({ type: 'automation.interaction.created', interaction: toInteractionSummary(created) });
    }
    // No expiry in v2 (contract §9) — the wait never carries a wakeAt.
    return { type: 'wait', wakeAt: null, kind: 'ask_me' };
  };
}

/** Exported for the admin routes layer (Task 25) — GET /api/automation-interactions projects the same wire shape. */
export function toInteractionSummary(record: AutomationInteractionRecord): AutomationInteractionSummary {
  return {
    id: record.id,
    runId: record.runId,
    stepRef: record.stepRef,
    title: record.title,
    fields: record.fields,
    status: record.status,
    createdAt: record.createdAt,
    resolvedAt: record.resolvedAt,
  };
}

/** Ported from v1 workflows/interactions.ts:9 — `when` renamed to `showWhen` (contract §1). */
function validateForm(fields: AutomationFormField[], payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    const { key, type, options, required, showWhen } = field;

    if (showWhen && String(payload[showWhen.key]) !== showWhen.equals) continue;

    const value = payload[key];
    if (value === undefined || value === null) {
      if (required !== false) errors.push(`missing required field '${key}'`);
      continue;
    }

    if (type === 'number' && typeof value !== 'number') {
      errors.push(`'${key}' must be a number`);
    } else if ((type === 'text' || type === 'textarea') && typeof value !== 'string') {
      errors.push(`'${key}' must be a string`);
    } else if (type === 'choice' && options && !options.includes(String(value))) {
      errors.push(`'${key}' must be one of ${JSON.stringify(options)}`);
    } else if (type === 'multi') {
      if (!Array.isArray(value)) errors.push(`'${key}' must be an array`);
      else if (options) {
        const invalid = value.filter((v) => !options.includes(String(v)));
        if (invalid.length > 0) errors.push(`'${key}' contains invalid values: ${JSON.stringify(invalid)}`);
      }
    }
  }
  return errors;
}

function applyAnswers(
  checkpoint: AutomationCheckpoint,
  stepRef: string,
  answers: Record<string, unknown>,
): AutomationCheckpoint {
  const target = checkpoint.steps[stepRef];
  if (!target) throw new Error(`ask_me step '${stepRef}' not found in checkpoint`);
  target.status = 'succeeded';
  target.outputs = answers;
  target.error = null;
  target.finishedAt = Date.now();
  return checkpoint;
}

export class InteractionService {
  constructor(
    private readonly interactions: InteractionStore,
    private readonly advanceRun: (runId: string) => Promise<void>,
    private readonly emitEvent: (event: DaemonEvent) => void,
  ) {}

  async respond(interactionId: string, payload: Record<string, unknown>): Promise<void> {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) throw new Error(`interaction not found: ${interactionId}`);
    if (interaction.status === 'answered') throw new Error('interaction already answered');
    if (interaction.status === 'cancelled') throw new Error('interaction already cancelled');

    const errors = validateForm(interaction.fields, payload);
    if (errors.length > 0) throw new Error(`invalid response: ${errors.join('; ')}`);

    const resolved = this.interactions.resolveInOneTx(
      interactionId,
      payload,
      interaction.runId,
      (checkpoint, answers) => applyAnswers(checkpoint, interaction.stepRef, answers),
    );

    this.emitEvent({ type: 'automation.interaction.resolved', interactionId: resolved.id, runId: interaction.runId });
    await this.advanceRun(interaction.runId);
  }
}
