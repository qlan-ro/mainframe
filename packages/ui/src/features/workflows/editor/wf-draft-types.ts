/**
 * WfDraft domain types — the mutable model held by the visual builder.
 *
 * These are the in-memory representations of the canonical YAML grammar's
 * constructs. serializeWorkflow() in yaml-serialize.ts converts them to
 * the on-disk YAML form, and yaml-parse.ts hydrates them back.
 *
 * v2: a full-parity discriminated union (see docs/plans/2026-07-09-workflow-step-config-plan.md).
 */

export type WfOnFailure = 'fail' | 'continue';

export interface WfRetry {
  attempts: number;
  backoff?: 'none' | 'exponential';
  initialDelayMs?: number;
}

export interface WfStepBase {
  id: string;
  name?: string;
  retry?: WfRetry;
  onFailure?: WfOnFailure; // canonical YAML key: on_failure
  // `unknown`, NOT string — the grammar types this `z.unknown().optional()`
  // (schema.ts:18). Usually a JSONata expression string, but narrowing here
  // would break full DSL parity for a non-string `output:` value on hydrate.
  output?: unknown;
}

export interface WfAgentConfig {
  prompt: string;
  adapterId?: string;
  model?: string;
  permissionMode?: string;
  projectId?: string;
  worktree?: { branchName: string; baseBranch?: string };
  timeoutMinutes?: number;
}

export type WfFieldType = 'text' | 'number' | 'choice' | 'multi' | 'textarea';

export interface WfField {
  key: string;
  type: WfFieldType;
  label?: string;
  options?: string[];
  required?: boolean;
  when?: { key: string; equals: string };
}

export interface WfFormConfig {
  title: string;
  timeout?: { afterMinutes: number; onTimeout: 'cancel' | 'fail' | 'continue' };
  fields: WfField[];
}

export interface WfArm {
  when?: string; // absent => else arm
  else?: true;
  steps: WfStep[];
}

export type WfStepBody =
  | { kind: 'agent'; agent: WfAgentConfig }
  | { kind: 'form'; form: WfFormConfig }
  | { kind: 'service'; connector: string; with?: Record<string, unknown>; credential?: string }
  | { kind: 'choose'; arms: WfArm[] }
  | { kind: 'foreach'; over: string; as: string; steps: WfStep[] }
  | { kind: 'parallel'; branches: Record<string, WfStep[]> }
  | { kind: 'call'; ref: string; with?: Record<string, unknown> }
  | { kind: 'set'; set: Record<string, unknown> };

export type WfStep = WfStepBase & WfStepBody;
export type WfStepKind = WfStepBody['kind'];

export type WfTrigger =
  | { kind: 'manual' }
  | { kind: 'schedule'; cron: string; on_missed?: 'skip' | 'run_once'; label?: string }
  | { kind: 'event'; on: string; workflow?: string };

export interface WfInput {
  name: string;
  type: string;
  title?: string;
  // `default` and `enum` are `unknown`/`unknown[]`, NOT narrowed — the grammar
  // types them `z.unknown().optional()` / `z.array(z.unknown()).optional()`
  // (schema.ts:149-151). Full DSL parity means no feature-side narrowing.
  default?: unknown;
  required?: boolean;
  enum?: unknown[];
}

export interface WfVar {
  key: string;
  value: unknown;
}

export interface WfOutput {
  name: string;
  expr: string;
}

/** The mutable draft model held by the visual builder. */
export interface WfDraft {
  name: string;
  description: string;
  scope: 'global' | 'project';
  triggers: WfTrigger[];
  inputs: WfInput[];
  vars: WfVar[];
  steps: WfStep[];
  outputs: WfOutput[];
}
