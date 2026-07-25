import { z } from 'zod';

export type RecommendationCategory = 'mcp' | 'skills' | 'hooks' | 'subagents' | 'plugins';

/**
 * Whose code the command installs.
 * - `first-party` — nothing external is fetched: an Anthropic command, a hook
 *   config snippet, or a skill scaffold this app authors.
 * - `vendor-official` — published by the technology's own vendor or a core
 *   maintainer of it.
 * - `third-party` — an unaffiliated author's aggregator repo.
 *
 * The UI must keep the three visually distinct: running a `third-party` command
 * puts a stranger's content on the user's machine, and they are entitled to see
 * that before they copy it.
 */
export type RecommendationProvenance = 'first-party' | 'vendor-official' | 'third-party';

/** Attribution for a command that installs a published repo's content. */
export interface RecommendationSource {
  /** GitHub `owner/repo` the command installs from. */
  repo: string;
  /** skills.sh install count when the dataset was compiled. Not live. */
  installs: number;
}

/**
 * A single Claude Code automation the Setup Advisor suggests for a project,
 * derived from concrete evidence in that project's files.
 */
export interface AutomationRecommendation {
  /** Stable kebab-case rule id, e.g. "mcp-supabase". Used in testids. */
  id: string;
  category: RecommendationCategory;
  title: string;
  /** The concrete detected evidence, e.g. "@supabase/supabase-js in package.json". */
  signal: string;
  /** One line: what the automation buys you, phrased off the signal. */
  why: string;
  /**
   * Copyable install/create text. Usually a single shell command
   * (`claude mcp add …`, `npx skills add …`). May be multi-line for
   * config-snippet recommendations (hooks); the UI renders the first line
   * truncated and copies the full text.
   * INVARIANT: a constant per rule — no fingerprint-derived substring ever
   * enters it. Fingerprint content (dependency names, git remote URLs) is
   * attacker-controlled for any cloned repo, and this string feeds a shell.
   */
  command: string;
  /** Where the artifact lives once created, e.g. ".claude/settings.json". */
  targetPath?: string;
  /** Adapter ids this applies to; ["*"] = any adapter. Enables later filtering as a data change. */
  adapters: string[];
  provenance: RecommendationProvenance;
  /** Absent for `first-party` rules, which fetch nobody's repo. */
  source?: RecommendationSource;
}

/** What the engine detected about a project. Display-only strings; never interpolated into commands. */
export interface ProjectFingerprint {
  languages: string[];
  frameworks: string[];
  databases: string[];
  externalApis: string[];
  testing: string[];
  tooling: string[];
  gitHost: 'github' | 'gitlab' | 'other' | null;
  /** `.claude/` or `CLAUDE.md` present. No MVP rule consumes it; detected for todo #192. */
  hasClaudeConfig: boolean;
  hasEnvFiles: boolean;
  hasLockFiles: boolean;
  /** Detected subset of: src, app, components, tests, api. */
  dirs: string[];
  /** Bounded approximation — the walk stops at a cap rather than counting every file. */
  fileCount: number;
  /** Human-readable evidence chips, e.g. "TypeScript", "Next.js". */
  signals: string[];
}

export interface SetupAdvisorReport {
  fingerprint: ProjectFingerprint;
  /** Ordered: canonical category order (mcp, skills, hooks, subagents, plugins), then rule priority within a category. */
  recommendations: AutomationRecommendation[];
}

export const RecommendationCategorySchema: z.ZodType<RecommendationCategory> = z.enum([
  'mcp',
  'skills',
  'hooks',
  'subagents',
  'plugins',
]);

export const RecommendationProvenanceSchema: z.ZodType<RecommendationProvenance> = z.enum([
  'first-party',
  'vendor-official',
  'third-party',
]);

export const RecommendationSourceSchema: z.ZodType<RecommendationSource> = z.object({
  repo: z.string().min(1),
  installs: z.number().int().nonnegative(),
});

export const AutomationRecommendationSchema: z.ZodType<AutomationRecommendation> = z.object({
  id: z.string().min(1),
  category: RecommendationCategorySchema,
  title: z.string().min(1),
  signal: z.string().min(1),
  why: z.string().min(1),
  command: z.string().min(1),
  targetPath: z.string().min(1).optional(),
  adapters: z.array(z.string().min(1)),
  provenance: RecommendationProvenanceSchema,
  source: RecommendationSourceSchema.optional(),
});

export const ProjectFingerprintSchema: z.ZodType<ProjectFingerprint> = z.object({
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  databases: z.array(z.string()),
  externalApis: z.array(z.string()),
  testing: z.array(z.string()),
  tooling: z.array(z.string()),
  gitHost: z.enum(['github', 'gitlab', 'other']).nullable(),
  hasClaudeConfig: z.boolean(),
  hasEnvFiles: z.boolean(),
  hasLockFiles: z.boolean(),
  dirs: z.array(z.string()),
  fileCount: z.number().int().nonnegative(),
  signals: z.array(z.string()),
});

export const SetupAdvisorReportSchema: z.ZodType<SetupAdvisorReport> = z.object({
  fingerprint: ProjectFingerprintSchema,
  recommendations: z.array(AutomationRecommendationSchema),
});
