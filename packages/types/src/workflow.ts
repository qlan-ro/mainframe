export interface QuestionField {
  key: string;
  type: 'text' | 'number' | 'choice' | 'multi' | 'textarea';
  label?: string;
  options?: string[];
  required?: boolean;
  when?: { key: string; equals: string };
}

export type WorkflowRunStatus = 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type WorkflowStepStatus = 'running' | 'waiting' | 'succeeded' | 'failed' | 'skipped' | 'ambiguous';

export interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  projectId: string | null;
  filePath: string;
  triggers: Array<{ kind: 'schedule' | 'event'; detail: string }>;
}

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  triggerKind: 'manual' | 'cron' | 'event' | 'call';
  parentRunId: string | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  outputs: unknown;
}

export interface WorkflowStepSummary {
  stepPath: string;
  stepId: string | null;
  kind: string;
  attempt: number;
  status: WorkflowStepStatus;
  // input/output are display-truncated by the API layer (full values stay in run_values)
  input: unknown;
  output: unknown;
  truncated: boolean;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  chatId?: string; // for agent steps — UI links to the chat
}

export interface WorkflowInteractionSummary {
  id: string;
  runId: string;
  stepPath: string;
  title: string;
  formSchema: QuestionField[];
  createdAt: number;
  expiresAt: number | null;
}
