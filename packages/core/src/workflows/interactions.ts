import type { Logger } from 'pino';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { InteractionStore } from './store/interaction-store.js';
import type { RunStore } from './store/run-store.js';
import type { WorkflowEngine } from './engine/engine.js';
import type { QuestionField, QuestionStep, StepDef } from './dsl/types.js';

/** Validate a payload against the ordered QuestionField[] array. */
function validateForm(fields: QuestionField[], payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    const { key, type, options, required, when } = field;

    // Respect visibility: skip validation for fields whose `when` condition isn't met.
    if (when) {
      const dependentValue = payload[when.key];
      if (String(dependentValue) !== when.equals) continue;
    }

    const value = payload[key];
    const isMissing = value === undefined || value === null;

    if (isMissing) {
      if (required !== false) errors.push(`missing required field '${key}'`);
      continue;
    }

    if (type === 'number') {
      if (typeof value !== 'number') errors.push(`'${key}' must be a number`);
    } else if (type === 'text' || type === 'textarea') {
      if (typeof value !== 'string') errors.push(`'${key}' must be a string`);
    } else if (type === 'choice') {
      if (options && !options.includes(String(value))) {
        errors.push(`'${key}' must be one of ${JSON.stringify(options)}`);
      }
    } else if (type === 'multi') {
      if (!Array.isArray(value)) {
        errors.push(`'${key}' must be an array`);
      } else if (options) {
        const invalid = (value as unknown[]).filter((v) => !options.includes(String(v)));
        if (invalid.length > 0) errors.push(`'${key}' contains invalid values: ${JSON.stringify(invalid)}`);
      }
    }
  }
  return errors;
}

/** Walk the step tree to find the step at `stepPath` (produced by the engine walker). */
function findStepByPath(steps: StepDef[], stepPath: string): StepDef | null {
  // Grammar: steps.<i>[(.choose.<n>.steps|#<n>.steps|.parallel.<name>).<i>]*
  const segments = stepPath.replace(/#\d+/g, '').split('.');
  let list: StepDef[] = steps;
  let current: StepDef | null = null;

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s] as string;
    if (seg === 'steps') continue;

    if (seg === 'choose') {
      // next segment is the arm index, then 'steps'
      s += 1;
      const armIdx = Number(segments[s]);
      if (current && 'choose' in current) {
        list = (current as { choose: Array<{ steps: StepDef[] }> }).choose[armIdx]?.steps ?? [];
      }
      continue;
    }

    if (seg === 'parallel') {
      s += 1;
      const name = segments[s] as string;
      if (current && 'parallel' in current) {
        list = (current as { parallel: Record<string, StepDef[]> }).parallel[name] ?? [];
      }
      continue;
    }

    const idx = Number(seg);
    if (!Number.isNaN(idx) && list) {
      current = list[idx] ?? null;
      if (!current) return null;
      if ('steps' in current && Array.isArray((current as { steps?: StepDef[] }).steps)) {
        list = (current as { steps: StepDef[] }).steps;
      }
    }
  }
  return current;
}

export class InteractionService {
  constructor(
    private readonly interactions: InteractionStore,
    private readonly store: RunStore,
    private readonly engine: WorkflowEngine,
    private readonly logger: Logger,
    private readonly emitEvent: (event: DaemonEvent) => void,
  ) {}

  async respond(interactionId: string, payload: Record<string, unknown>): Promise<void> {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) throw new Error('interaction not found');
    if (interaction.status !== 'pending') throw new Error('interaction already answered or expired');

    const errors = validateForm(interaction.formSchema, payload);
    if (errors.length > 0) throw new Error(`invalid response: ${errors.join('; ')}`);

    if (!this.interactions.claim(interactionId, 'answered')) {
      throw new Error('interaction already answered');
    }

    const latest = this.store.latestStepResults(interaction.runId).get(interaction.stepPath);
    this.store.commitStep(interaction.runId, {
      stepPath: interaction.stepPath,
      stepId: latest?.stepId ?? null,
      kind: 'question',
      attempt: latest?.attempt ?? 1,
      status: 'succeeded',
      input: null,
      output: payload,
      scratch: null,
      error: null,
    });
    this.emitEvent({ type: 'workflow.interaction.resolved', interactionId, runId: interaction.runId } as never);
    await this.engine.advance(interaction.runId);
  }

  /** Sweep expired interactions; called by the timer sweeper. */
  async expireDue(now: number): Promise<void> {
    for (const interaction of this.interactions.listDue(now)) {
      if (!this.interactions.claim(interaction.id, 'expired')) continue;

      const run = this.store.getRun(interaction.runId);
      if (!run) continue;

      const step = findStepByPath(run.definition.steps, interaction.stepPath) as QuestionStep | null;
      const policy = step?.question.timeout?.onTimeout ?? 'fail';
      const latest = this.store.latestStepResults(run.id).get(interaction.stepPath);
      const stepArgs = {
        stepPath: interaction.stepPath,
        stepId: latest?.stepId ?? null,
        kind: 'question',
        attempt: latest?.attempt ?? 1,
        input: null,
        output: null,
        scratch: null,
      } as const;

      if (policy === 'continue') {
        this.store.commitStep(run.id, { ...stepArgs, status: 'skipped', error: 'timed out' });
        await this.engine.advance(run.id);
      } else if (policy === 'cancel') {
        await this.engine.cancelRun(run.id);
      } else {
        this.store.commitStep(run.id, { ...stepArgs, status: 'failed', error: 'question input timed out' });
        await this.engine.advance(run.id);
      }

      this.logger.info({ runId: run.id, interactionId: interaction.id, policy }, 'interaction expired');
    }
  }
}
