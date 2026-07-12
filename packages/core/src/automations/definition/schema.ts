// packages/core/src/automations/definition/schema.ts
//
// The single write-path validator for AutomationDefinition (contract §1).
// Field names mirror packages/types/src/automation.ts exactly — this schema
// only adds runtime shape/business-rule checks on top of those wire types.
import { z } from 'zod';
import type { AutomationDefinition, AutomationStep, AutomationTrigger } from '@qlan-ro/mainframe-types';

/** Repo convention (`^[a-zA-Z0-9_-]+$`) for user-authored identifiers: step/trigger ids, field/output keys. */
const idSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, 'must match ^[a-zA-Z0-9_-]+$');
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24h HH:MM time');

const tokenRefSchema = z.object({ stepId: idSchema, output: idSchema, field: z.string().min(1).optional() }).strict();

const chipPartSchema = z.union([z.string(), z.object({ token: tokenRefSchema }).strict()]);
const chipTextSchema = z.array(chipPartSchema);

const comparatorSchema = z.enum([
  'is',
  'is_not',
  'contains',
  'starts_with',
  'eq',
  'lt',
  'gt',
  'is_empty',
  'not_empty',
  'is_one_of',
]);

const conditionValueSchema = z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]);

/** A3: `is_one_of` requires an array value; every other comparator accepts scalar or array. */
const conditionRowSchema = z
  .object({ token: tokenRefSchema, comparator: comparatorSchema, value: conditionValueSchema.optional() })
  .strict()
  .superRefine((row, ctx) => {
    if (row.comparator === 'is_one_of' && !Array.isArray(row.value)) {
      ctx.addIssue({ code: 'custom', message: "comparator 'is_one_of' requires an array value" });
    }
  });

const automationFormFieldSchema = z
  .object({
    key: idSchema,
    type: z.enum(['text', 'number', 'choice', 'multi', 'textarea']),
    label: z.string().optional(),
    options: z.array(z.string()).optional(),
    required: z.boolean().optional(),
    showWhen: z.object({ key: idSchema, equals: z.string() }).strict().optional(),
  })
  .strict();

/** A2: declared keys become named outputs, parsed from the agent's final-message JSON. */
const expectedOutputSchema = z
  .object({
    key: idSchema,
    type: z.enum(['text', 'number', 'list', 'choice']),
    options: z.array(z.string()).optional(),
  })
  .strict();

const stepBase = { id: idSchema, keepGoing: z.boolean().optional() };

const askAgentStepSchema = z
  .object({
    ...stepBase,
    kind: z.literal('ask_agent'),
    prompt: chipTextSchema,
    adapterId: z.string().optional(),
    model: z.string().optional(),
    permissionMode: z.string().optional(),
    projectId: z.string().optional(),
    worktree: z.object({ baseBranch: z.string().optional(), branchName: chipTextSchema }).strict().optional(),
    autoApprove: z.array(z.string()).optional(),
    timeoutMinutes: z.number().int().positive().optional(),
    expects: z.array(expectedOutputSchema).optional(),
  })
  .strict();

const askMeStepSchema = z
  .object({
    ...stepBase,
    kind: z.literal('ask_me'),
    title: z.string().min(1),
    fields: z.array(automationFormFieldSchema),
  })
  .strict();

const runActionStepSchema = z
  .object({
    ...stepBase,
    kind: z.literal('run_action'),
    actionId: z.string().min(1),
    credential: z.string().optional(),
    params: z.record(z.string(), chipTextSchema),
    outputAs: z.enum(['text', 'lines']).optional(),
  })
  .strict();

const notifyStepSchema = z.object({ ...stepBase, kind: z.literal('notify'), message: chipTextSchema }).strict();

// if/repeat recurse into AutomationStep[]; z.lazy defers evaluation past this
// module's own initialization so the forward reference to StepSchema resolves.
// Left untyped (not `z.ZodType<...>`) so TS keeps the concrete discriminable
// shape z.discriminatedUnion needs below — StepSchema's own annotation is the
// single type anchor that breaks the mutual-recursion cycle (v1 dsl/schema.ts
// pattern: one `z.ZodType<T>` cast at the top, none on the inner branches).
const ifBlockSchema = z.lazy(() =>
  z
    .object({
      ...stepBase,
      kind: z.literal('if'),
      match: z.enum(['all', 'any']),
      conditions: z.array(conditionRowSchema).min(1),
      then: z.array(StepSchema),
      otherwise: z.array(StepSchema),
    })
    .strict(),
);

const repeatBlockSchema = z.lazy(() =>
  z.object({ ...stepBase, kind: z.literal('repeat'), items: tokenRefSchema, steps: z.array(StepSchema) }).strict(),
);

export const StepSchema: z.ZodType<AutomationStep> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    askAgentStepSchema,
    askMeStepSchema,
    runActionStepSchema,
    notifyStepSchema,
    ifBlockSchema,
    repeatBlockSchema,
  ]),
);

const schedulePatternSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('daily'), at: timeOfDaySchema }).strict(),
    z.object({ type: z.literal('weekdays'), at: timeOfDaySchema }).strict(),
    z
      .object({ type: z.literal('weekly'), days: z.array(z.number().int().min(0).max(6)).min(1), at: timeOfDaySchema })
      .strict(),
    z.object({ type: z.literal('every_n_hours'), n: z.number().int().positive() }).strict(),
  ])
  // Superrefine after the union (not on the branch itself) so discriminatedUnion
  // keeps a plain object with an introspectable literal per branch.
  .superRefine((pattern, ctx) => {
    if (pattern.type === 'every_n_hours' && 24 % pattern.n !== 0) {
      ctx.addIssue({ code: 'custom', message: `every_n_hours 'n' (${pattern.n}) must evenly divide 24` });
    }
  });

const scheduleTriggerSchema = z
  .object({
    id: idSchema,
    kind: z.literal('schedule'),
    schedule: schedulePatternSchema,
    onMissed: z.enum(['run_once', 'skip']),
  })
  .strict();

const eventTriggerSchema = z
  .object({
    id: idSchema,
    kind: z.literal('event'),
    event: z.enum(['session.finished', 'automation.finished', 'automation.failed']),
    automationId: z.string().optional(),
  })
  .strict();

const webhookTriggerSchema = z
  .object({
    id: idSchema,
    kind: z.literal('webhook'),
    hookId: idSchema,
    preset: z.enum(['github_pr_opened', 'github_pr_merged']).optional(),
  })
  .strict();

export const TriggerSchema: z.ZodType<AutomationTrigger> = z.discriminatedUnion('kind', [
  scheduleTriggerSchema,
  eventTriggerSchema,
  webhookTriggerSchema,
]);

export const AutomationDefinitionSchema: z.ZodType<AutomationDefinition> = z
  .object({ triggers: z.array(TriggerSchema), steps: z.array(StepSchema) })
  .strict();
