/**
 * Wire contract for the daemon's `skills-cli` routes (todo #243, plan
 * `docs/plans/2026-08-01-todo-243-skills-management-ui-plan.md`, "Wire
 * contract" section). Schemas are permissive on unknown fields — the daemon
 * may add some — and strict only on the fields each side actually reads.
 */
import { z } from 'zod';

export const SkillsCliScopeSchema = z.enum(['project', 'global']);
export type SkillsCliScope = z.infer<typeof SkillsCliScopeSchema>;

// The CLI's manifest and probe-source list both accept a bare skill name
// with no source/description attached (`skills_cli/manifest.rs`'s
// `parse_entries`, `skills_cli/probe_parse.rs`'s bare-name branch) — the
// daemon serializes the absent field as JSON `null`, so these stay
// `.nullish()` rather than `z.string()`.
export const SkillsCliEntrySchema = z
  .object({
    name: z.string().min(1),
    scope: SkillsCliScopeSchema,
    source: z.string().nullish(),
    sourceType: z.string().nullish(),
    skillPath: z.string().nullish(),
  })
  .loose();
export type SkillsCliEntry = z.infer<typeof SkillsCliEntrySchema>;

const SkillsCliManifestAvailableSchema = z
  .object({
    status: z.literal('available'),
    entries: z.array(SkillsCliEntrySchema),
  })
  .loose();

const SkillsCliManifestUnavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    executable: z.string(),
    packageRunner: z.string(),
  })
  .loose();

export const SkillsCliManifestSchema = z.discriminatedUnion('status', [
  SkillsCliManifestAvailableSchema,
  SkillsCliManifestUnavailableSchema,
]);
export type SkillsCliManifest = z.infer<typeof SkillsCliManifestSchema>;

export const ProbedSkillSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().nullish(),
  })
  .loose();
export type ProbedSkill = z.infer<typeof ProbedSkillSchema>;

const SkillsCliProbeProbedSchema = z
  .object({
    status: z.literal('probed'),
    skills: z.array(ProbedSkillSchema),
  })
  .loose();

const SkillsCliProbeUnparseableSchema = z
  .object({
    status: z.literal('unparseable'),
  })
  .loose();

export const SkillsCliProbeSchema = z.discriminatedUnion('status', [
  SkillsCliProbeProbedSchema,
  SkillsCliProbeUnparseableSchema,
]);
export type SkillsCliProbe = z.infer<typeof SkillsCliProbeSchema>;

/**
 * The 502 failure body carries `tail`/`exitCode` beyond the standard
 * `{ success, error }` envelope (wire contract table). `exitCode` is `null`
 * for a spawn failure or timeout, absent entirely for non-CLI failures
 * (404/400/409).
 */
export const SkillsCliFailureSchema = z
  .object({
    success: z.literal(false),
    error: z.string(),
    tail: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
  })
  .loose();
export type SkillsCliFailure = z.infer<typeof SkillsCliFailureSchema>;
