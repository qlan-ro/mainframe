// packages/core/src/workflows/dsl/types.ts
export interface RetryPolicy {
  attempts: number;
  backoff?: 'none' | 'exponential';
  initialDelayMs?: number;
}

export interface BaseStep {
  id: string;
  name?: string;
  retry?: RetryPolicy;
  on_failure?: 'fail' | 'continue';
  output?: unknown;
}

export interface ConnectorStep extends BaseStep {
  connector: string;
  credential?: string;
  with?: Record<string, unknown>;
}

export interface AgentStep extends BaseStep {
  agent: {
    prompt: string;
    adapterId?: string;
    model?: string;
    permissionMode?: string;
    projectId?: string;
    worktree?: { baseBranch?: string; branchName: string };
    timeoutMinutes?: number;
  };
}

export interface QuestionField {
  key: string;
  type: 'text' | 'number' | 'choice' | 'multi' | 'textarea';
  label?: string;
  options?: string[];
  required?: boolean;
  when?: { key: string; equals: string };
}

export interface QuestionStep extends BaseStep {
  question: {
    title: string;
    timeout?: number;
    fields: QuestionField[];
  };
}

export interface ChooseArm {
  when?: string;
  else?: boolean;
  steps: StepDef[];
}

export interface ChooseStep extends BaseStep {
  choose: ChooseArm[];
}

export interface ForeachStep extends BaseStep {
  foreach: string;
  as?: string;
  steps: StepDef[];
}

export interface ParallelStep extends BaseStep {
  parallel: Record<string, StepDef[]>;
}

export interface CallStep extends BaseStep {
  call: string;
  with?: Record<string, unknown>;
}

export interface SetStep extends BaseStep {
  set: Record<string, unknown>;
}

export type StepDef =
  | ConnectorStep
  | AgentStep
  | QuestionStep
  | ChooseStep
  | ForeachStep
  | ParallelStep
  | CallStep
  | SetStep;

export type StepKind = 'connector' | 'agent' | 'question' | 'choose' | 'foreach' | 'parallel' | 'call' | 'set';

export function stepKind(step: StepDef): StepKind {
  if ('connector' in step) return 'connector';
  if ('agent' in step) return 'agent';
  if ('question' in step) return 'question';
  if ('choose' in step) return 'choose';
  if ('foreach' in step) return 'foreach';
  if ('parallel' in step) return 'parallel';
  if ('call' in step) return 'call';
  return 'set';
}

export type TriggerDef =
  | { schedule: { cron: string; on_missed?: 'skip' | 'run_once' } }
  | { event: { on: string; workflow?: string } };

export interface WorkflowDef {
  version: 1;
  name: string;
  description?: string;
  inputs?: Record<string, { type: string; title?: string; default?: unknown; required?: boolean; enum?: unknown[] }>;
  triggers?: TriggerDef[];
  vars?: Record<string, unknown>;
  steps: StepDef[];
  outputs?: Record<string, string>;
}
