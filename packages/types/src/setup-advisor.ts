import { z } from 'zod';

export type RecommendationCategory = 'mcp' | 'skills' | 'hooks' | 'subagents' | 'plugins';

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

export const AutomationRecommendationSchema: z.ZodType<AutomationRecommendation> = z.object({
  id: z.string().min(1),
  category: RecommendationCategorySchema,
  title: z.string().min(1),
  signal: z.string().min(1),
  why: z.string().min(1),
  command: z.string().min(1),
  targetPath: z.string().min(1).optional(),
  adapters: z.array(z.string().min(1)),
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
