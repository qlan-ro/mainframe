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

export interface AutomationExpectedOutput {
  key: string;
  type: 'text' | 'number' | 'list' | 'choice';
  options?: string[];
}

export interface AskAgentStep extends AutomationStepBase {
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
}

export interface AutomationFormField {
  key: string;
  type: 'text' | 'number' | 'choice' | 'multi' | 'textarea';
  label?: string;
  options?: string[];
  required?: boolean;
  showWhen?: { key: string; equals: string };
}

export interface AskMeStep extends AutomationStepBase {
  kind: 'ask_me';
  title: string;
  fields: AutomationFormField[];
}

export interface RunActionStep extends AutomationStepBase {
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
  | 'is'
  | 'is_not'
  | 'contains'
  | 'starts_with'
  | 'eq'
  | 'lt'
  | 'gt'
  | 'is_empty'
  | 'not_empty'
  | 'is_one_of';

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
  steps: AutomationStep[];
}

export type AutomationStep = AskAgentStep | AskMeStep | RunActionStep | NotifyStep | IfBlock | RepeatBlock;

export type SchedulePattern =
  | { type: 'daily'; at: string }
  | { type: 'weekdays'; at: string }
  | { type: 'weekly'; days: number[]; at: string }
  | { type: 'every_n_hours'; n: number };

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

export interface WebhookTrigger {
  id: string;
  kind: 'webhook';
  hookId: string;
  preset?: WebhookPreset;
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
}
