// packages/core/src/workflows/dsl/schema.ts
import { z } from 'zod';
import type { StepDef } from './types.js';

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/);

const retrySchema = z.object({
  attempts: z.number().int().min(1).max(10),
  backoff: z.enum(['none', 'exponential']).optional(),
  initialDelayMs: z.number().int().min(0).optional(),
});

const baseFields = {
  id: idSchema,
  name: z.string().optional(),
  retry: retrySchema.optional(),
  on_failure: z.enum(['fail', 'continue']).optional(),
  output: z.unknown().optional(),
};

const questionFieldSchema = z.object({
  key: idSchema,
  type: z.enum(['text', 'number', 'choice', 'multi', 'textarea']),
  label: z.string().optional(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  when: z.object({ key: idSchema, equals: z.string() }).optional(),
});

const KIND_KEYS = ['connector', 'agent', 'question', 'choose', 'foreach', 'parallel', 'call', 'set'] as const;

// stepSchema is recursive (choose.steps, foreach.steps, parallel branches)
export const stepSchema: z.ZodType<StepDef> = z.lazy(
  () =>
    z
      .object({
        ...baseFields,
        // connector
        connector: z
          .string()
          .regex(/^[a-z0-9_-]+\.[a-z0-9_]+$/)
          .optional(),
        credential: z.string().optional(),
        with: z.record(z.string(), z.unknown()).optional(),
        // agent
        agent: z
          .object({
            prompt: z.string(),
            adapterId: z.string().optional(),
            model: z.string().optional(),
            permissionMode: z.string().optional(),
            projectId: z.string().optional(),
            worktree: z.object({ baseBranch: z.string().optional(), branchName: z.string() }).optional(),
            timeoutMinutes: z.number().int().min(0).optional(),
          })
          .optional(),
        // question
        question: z
          .object({
            title: z.string(),
            timeout: z.number().int().min(1).optional(),
            fields: z.array(questionFieldSchema),
          })
          .optional(),
        // choose
        choose: z
          .array(
            z.object({
              when: z.string().optional(),
              else: z.literal(true).optional(),
              steps: z.array(stepSchema),
            }),
          )
          .optional(),
        // foreach
        foreach: z.string().optional(),
        as: idSchema.optional(),
        steps: z.array(stepSchema).optional(),
        // parallel
        parallel: z.record(idSchema, z.array(stepSchema)).optional(),
        // call
        call: z.string().optional(),
        // set
        set: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .superRefine((step, ctx) => {
        const kinds = KIND_KEYS.filter((k) => step[k] !== undefined);
        if (kinds.length !== 1) {
          ctx.addIssue({
            code: 'custom',
            message: `step '${step.id}' must have exactly one of: ${KIND_KEYS.join(', ')} (found: ${kinds.join(', ') || 'none'})`,
          });
        }
        if (step.foreach !== undefined && step.steps === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `foreach step '${step.id}' requires 'steps'`,
          });
        }
        if (step.choose !== undefined) {
          step.choose.forEach((arm, i) => {
            if (arm.steps === undefined || arm.steps.length === 0) {
              ctx.addIssue({
                code: 'custom',
                message: `choose arm [${i}] in step '${step.id}' requires 'steps'`,
              });
            }
          });
        }
      }) as z.ZodType<StepDef>,
);

const triggerSchema = z.union([
  z
    .object({
      schedule: z.union([
        z.object({
          cron: z.string(),
          on_missed: z.enum(['skip', 'run_once']).optional(),
        }),
        z.string().transform((cron) => ({ cron })),
      ]),
    })
    .strict(),
  z
    .object({
      event: z.object({ on: z.string(), workflow: z.string().optional() }),
    })
    .strict(),
]);

export const workflowSchema = z
  .object({
    version: z.literal(1),
    name: idSchema,
    description: z.string().optional(),
    inputs: z
      .record(
        idSchema,
        z.object({
          type: z.string(),
          title: z.string().optional(),
          default: z.unknown().optional(),
          required: z.boolean().optional(),
          enum: z.array(z.unknown()).optional(),
        }),
      )
      .optional(),
    triggers: z.array(triggerSchema).optional(),
    vars: z.record(idSchema, z.unknown()).optional(),
    steps: z.array(stepSchema).min(1),
    outputs: z.record(idSchema, z.string()).optional(),
  })
  .strict();
