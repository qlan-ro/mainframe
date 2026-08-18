/**
 * Automations v2 — the "When + Do" model shared by the Node daemon, the UI,
 * and the parallel Rust engine. Field names are the wire contract, not a
 * style choice: `keepGoing`, `showWhen`, `items` (Repeat), and the flat
 * `ChipPart` union are exact — do not rename them.
 * (docs/plans/2026-07-12-automations-v2-contract.md §1)
 *
 * TokenRef conventions the fixtures under packages/types/fixtures/automations/
 * rely on:
 * - `{stepId:'trigger', output:<name>}` — schedule triggers produce no
 *   tokens; event triggers (`session.finished` / `automation.finished` /
 *   `automation.failed`) produce `result`/`chatId`; webhook triggers produce
 *   `payload`, dug into via `field` (e.g. `field:'pull_request.html_url'`).
 * - `{stepId:'builtin', output:'today'|'now'}` — always in scope.
 * - `{stepId:'current', output:'item', field?}` — the Repeat block's current
 *   item; valid only inside that Repeat's `steps`.
 */

export const TOKEN_STEP_TRIGGER = 'trigger';
export const TOKEN_STEP_BUILTIN = 'builtin';
export const TOKEN_STEP_CURRENT = 'current';

export interface TokenRef {
  stepId: string;
  output: string;
  field?: string;
}

export type ChipPart = string | { token: TokenRef };
export type ChipText = ChipPart[];

interface AutomationStepBase {
  id: string;
  keepGoing?: boolean;
}

/**
 * A producing step's stored variable name, minted once when the step first has
 * an output and never recomputed (`automation-domain/output-name.ts`). Only its
 * trailing `_2`/`_3` ordinal is read: a step produces several outputs, so the
 * stored name pins the step's slot in the collision namespace and every output
 * of that step carries the same ordinal. Optional for back-compat — a step
 * without one falls back to position-ordered suffixing.
 */
interface ProducingStep extends AutomationStepBase {
  outputName?: string;
}

export interface AutomationExpectedOutput {
  key: string;
  type: 'text' | 'number' | 'list' | 'choice';
  options?: string[];
}

export interface AskAgentStep extends ProducingStep {
  kind: 'ask_agent';
  prompt: ChipText;
  adapterId?: string;
  model?: string;
  permissionMode?: string;
  projectId?: string;
  worktree?: { baseBranch?: string; branchName: ChipText };
  autoApprove?: string[];
  timeoutMinutes?: number;
  /** A2: declared keys are parsed from the final message's JSON and become named outputs alongside `result`/`chatId`. */
  expects?: AutomationExpectedOutput[];
  /** Filenames handed to the agent alongside the prompt (wf2-stepconfig.jsx `WfAttachments`). Names only — no upload/storage path exists yet; UI-added per the 2026-07-12 design-conformance pass. */
  attachments?: string[];
}

export interface AutomationFormField {
  key: string;
  type: 'text' | 'number' | 'choice' | 'multi' | 'textarea';
  label?: string;
  options?: string[];
  required?: boolean;
  showWhen?: { key: string; equals: string };
}

export interface AskMeStep extends ProducingStep {
  kind: 'ask_me';
  title: string;
  fields: AutomationFormField[];
}

export interface RunActionStep extends ProducingStep {
  kind: 'run_action';
  actionId: string;
  credential?: string;
  params: Record<string, ChipText>;
  outputAs?: 'text' | 'lines';
}

export interface NotifyStep extends AutomationStepBase {
  kind: 'notify';
  message: ChipText;
}

/** A3 adds `is_one_of`; `contains` is polymorphic (text substring / list membership). */
export type Comparator =
  'is' | 'is_not' | 'contains' | 'starts_with' | 'eq' | 'lt' | 'gt' | 'is_empty' | 'not_empty' | 'is_one_of';

export interface ConditionRow {
  token: TokenRef;
  comparator: Comparator;
  value?: string | number | Array<string | number>;
}

export interface IfBlock extends AutomationStepBase {
  kind: 'if';
  match: 'all' | 'any';
  conditions: ConditionRow[];
  then: AutomationStep[];
  otherwise: AutomationStep[];
}

export interface RepeatBlock extends AutomationStepBase {
  kind: 'repeat';
  items: TokenRef;
  /** Absent or `1`: sequential (today's behavior). `2..=32`: iterations run concurrently. */
  concurrency?: number;
  steps: AutomationStep[];
}

/**
 * Parks the run for a fixed delay, then resumes.
 *
 * Resolution is the engine's 30s due-sweep, not a timer, so short waits round
 * up. That also makes it restart-safe: `wakeAt` lives in the run's checkpoint,
 * so a daemon restart mid-wait resumes on schedule instead of losing a timer.
 * Capped at 7 days by validation — a longer delay belongs on a schedule trigger.
 */
export interface WaitStep extends AutomationStepBase {
  kind: 'wait';
  seconds: number;
}

/**
 * A condition-driven loop — the counterpart to `RepeatBlock`, whose list is
 * resolved once before it starts and so cannot poll or converge.
 *
 * Conditions are re-evaluated before each pass, against the PREVIOUS pass's
 * outputs. Before the first pass there is nothing to read, and the rule there
 * is: if the condition's tokens don't resolve yet, run the pass. Without it
 * "repeat while the build is running" would exit before running anything,
 * since the step producing that status lives inside the loop. It costs `until`
 * nothing — a goal provable from outside the loop still resolves, so "poll
 * until the build is green" still runs zero passes when it already was.
 *
 * `maxIterations` is mandatory (capped at 500, Repeat's bound) and exhausting
 * it FAILS the block: a poll that never went green must not read as one that did.
 */
export interface LoopBlock extends AutomationStepBase {
  kind: 'loop';
  mode: 'while' | 'until';
  match: 'all' | 'any';
  conditions: ConditionRow[];
  maxIterations: number;
  steps: AutomationStep[];
}

/**
 * Re-runs its body from the top when it fails.
 *
 * Each attempt walks in its own frame, so a failed attempt's checkpoint entries
 * never shadow the next one's — the walk treats an already-failed step as
 * settled, so without that a replayed attempt would report success.
 *
 * **Retrying re-runs side effects.** A body that opened a PR and then failed
 * opens a second one on the next attempt. Prefer retrying reads and commands.
 */
export interface RetryBlock extends AutomationStepBase {
  kind: 'retry';
  /** Total tries, including the first — `1` is "no retry". */
  maxAttempts: number;
  steps: AutomationStep[];
}

/** Leaves the innermost enclosing `loop` or `repeat`. Validation rejects one with no enclosing block. */
export interface BreakStep extends AutomationStepBase {
  kind: 'break';
}

/** Defines a named value downstream steps address as `$name` (automation-domain/variables.ts). */
export interface SetVariableStep extends AutomationStepBase {
  kind: 'set_variable';
  name: string;
  value: ChipText;
}

export type AutomationStep =
  | AskAgentStep
  | AskMeStep
  | RunActionStep
  | NotifyStep
  | SetVariableStep
  | WaitStep
  | BreakStep
  | IfBlock
  | RepeatBlock
  | LoopBlock
  | RetryBlock;

export type SchedulePattern =
  | { type: 'daily'; at: string }
  | { type: 'weekdays'; at: string }
  | { type: 'weekly'; days: number[]; at: string }
  | { type: 'every_n_hours'; n: number }
  /** `at` is naive-local `YYYY-MM-DDTHH:MM` — the `datetime-local` input format, NOT the daemon's seconds-bearing `scheduled_for_string`. */
  | { type: 'once'; at: string };

export interface ScheduleTrigger {
  id: string;
  kind: 'schedule';
  schedule: SchedulePattern;
  onMissed: 'run_once' | 'skip';
}

export type AutomationEventName = 'session.finished' | 'automation.finished' | 'automation.failed';

export interface EventTrigger {
  id: string;
  kind: 'event';
  event: AutomationEventName;
  automationId?: string;
}

/**
 * Server-side match predicate a webhook trigger opts into (contract §4 —
 * "webhook presets carry a server-side match predicate"). Absent = every
 * verified delivery starts a run (no filter). NOT in the original contract
 * doc: `WebhookTrigger` had no field naming which predicate to evaluate,
 * yet §4/Task 25 both require "the preset's matchPreset predicate" to be
 * evaluated per-trigger. Added here minimally — flag to the Rust/UI plans.
 */
export type WebhookPreset = 'github_pr_opened' | 'github_pr_merged';

/** Server-computed on read; the daemon ignores it on write. Mirrors the Rust `WebhookRegistration`. */
export interface WebhookRegistration {
  hookId: string;
  /** The local ingest endpoint — reachable only from this machine. */
  url: string;
  /** A present `null` means "registered, never delivered"; an absent `registration` means "not registered". */
  lastDeliveryAt: string | null;
}

export interface WebhookTrigger {
  id: string;
  kind: 'webhook';
  hookId: string;
  preset?: WebhookPreset;
  registration?: WebhookRegistration;
}

export type AutomationTrigger = ScheduleTrigger | EventTrigger | WebhookTrigger;

export interface AutomationDefinition {
  triggers: AutomationTrigger[];
  steps: AutomationStep[];
}

export type AutomationScope = 'global' | 'project';

export interface AutomationSummary {
  id: string;
  name: string;
  description?: string;
  scope: AutomationScope;
  projectId: string | null;
  enabled: boolean;
  definition: AutomationDefinition;
  createdAt: number;
  updatedAt: number;
}

/**
 * POST /api/automations body, and the shape of the canonical fixture files
 * under packages/types/fixtures/automations/*.json (contract §8).
 */
export interface AutomationCreateInput {
  name: string;
  description?: string;
  scope: AutomationScope;
  projectId?: string | null;
  definition: AutomationDefinition;
}

export type AutomationRunStatus = 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type AutomationRunTriggerKind = 'schedule' | 'event' | 'webhook' | 'manual';

export interface AutomationRunSummary {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  trigger: { kind: AutomationRunTriggerKind; tokens?: Record<string, unknown> };
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export type AutomationStepStatus = 'running' | 'succeeded' | 'failed' | 'waiting' | 'skipped';

export interface AutomationTimelineEntry {
  stepRef: string;
  stepId: string;
  kind: AutomationStep['kind'];
  status: AutomationStepStatus;
  outputPreview?: string;
  error?: string | null;
  chatId?: string;
  interactionId?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type AutomationInteractionStatus = 'pending' | 'answered' | 'cancelled';

export interface AutomationInteractionSummary {
  id: string;
  runId: string;
  stepRef: string;
  title: string;
  fields: AutomationFormField[];
  status: AutomationInteractionStatus;
  createdAt: number;
  resolvedAt: number | null;
}

export type ActionOutputType = 'text' | 'number' | 'list' | 'record';

export interface ActionCatalogEntry {
  id: string;
  title: string;
  group: 'builtin' | 'connector' | 'mcp';
  auth: 'none' | 'token';
  credentialLabelHint?: string;
  paramsSchema: unknown;
  outputs: Array<{ name: string; type: ActionOutputType }>;
  /**
   * False when a prerequisite is missing on this machine (the GitHub actions
   * need the `gh` CLI installed and signed in). The editor mutes the action
   * instead of letting a step be built on it. Optional so an older daemon's
   * payload still reads as usable.
   */
  available?: boolean;
  /** One sentence naming the prerequisite and its remedy, shown verbatim. */
  unavailableReason?: string;
}
