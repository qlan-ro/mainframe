/**
 * WfDraft domain types — the mutable model held by the visual builder.
 *
 * These are the in-memory representations of the canonical YAML grammar's
 * constructs. serializeWorkflow() in yaml-serialize.ts converts them to
 * the on-disk YAML form.
 */

export interface WfTrigger {
  kind: 'schedule' | 'event' | 'webhook' | 'manual';
  cron?: string;
  label?: string;
  /** Canonical grammar field name. */
  on_missed?: string;
  /** Camel alias accepted from the builder (converted on serialise). */
  onMissed?: string;
  event?: string;
  path?: string;
}

export interface WfField {
  key: string;
  type: string;
  options?: string[];
  required?: boolean;
}

export interface WfLane {
  name: string;
  steps: WfStep[];
}

export interface WfArm {
  /** JSONata condition string, or the "else" sentinel. */
  cond: string;
  else?: boolean;
  steps: WfStep[];
}

/** A single step in the workflow (leaf or composite). */
export interface WfStep {
  id?: string;
  kind: 'question' | 'service' | 'agent' | 'parallel' | 'branch' | 'loop' | 'subflow' | 'set';
  name?: string;
  title?: string;

  // question
  timeout?: { afterMinutes: number; onTimeout: 'cancel' | 'skip' };
  fields?: WfField[];

  // service
  connector?: string;
  action?: string;
  args?: Record<string, string>;
  credential?: string;

  // agent
  prompt?: string;
  worktree?: string;

  // parallel
  lanes?: WfLane[];

  // branch
  arms?: WfArm[];

  // loop
  over?: string;
  as?: string;
  steps?: WfStep[];

  // subflow
  ref?: string;
  /** Input map forwarded to the sub-workflow. */
  with?: Record<string, string>;

  // set
  value?: unknown;
}

export interface WfInput {
  name: string;
  type: string;
  default?: string | number | boolean;
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
  steps: WfStep[];
  outputs: WfOutput[];
}
