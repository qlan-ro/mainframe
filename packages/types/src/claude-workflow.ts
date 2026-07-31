/**
 * Ported from `packages/core-rs/crates/mainframe-types/src/claude_workflow.rs`.
 *
 * Wire types for a Claude CLI workflow run (`/workflows` scripts), assembled from
 * `task_progress`/`task_updated` system events and the on-disk `wf_<runId>.json` record. Prefixed
 * `ClaudeWorkflow` to stay distinct from the unrelated Automations `Workflow*` types.
 */

export type ClaudeWorkflowRunStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'paused' | 'unavailable';

export type ClaudeWorkflowAgentState = 'start' | 'progress' | 'done' | 'error' | 'unknown';

export type ClaudeWorkflowRunSource = 'launch' | 'snapshot' | 'record';

export interface ClaudeWorkflowPhase {
  index: number;
  title: string;
  kind?: string;
}

export interface ClaudeWorkflowAgent {
  agentId: string;
  index: number;
  phaseIndex: number;
  label: string;
  state: ClaudeWorkflowAgentState;
  model?: string;
  attempt?: number;
  tokens: number;
  toolCalls: number;
  durationMs: number;
  error?: string;
  resultPreview?: string;
  lastToolName?: string;
  lastToolSummary?: string;
  /** ms epoch. */
  lastProgressAt?: number;
}

export interface ClaudeWorkflowRun {
  /** Canonical key (A1) — the CLI's `task_progress`/`task_updated` `task_id`. */
  taskId: string;
  runId?: string;
  workflowName?: string;
  status: ClaudeWorkflowRunStatus;
  source: ClaudeWorkflowRunSource;
  totalTokens: number;
  durationMs: number;
  /** `usage.durationMs` of the last accepted snapshot. */
  structureRevision?: number;
  /** ms epoch the run went terminal. */
  terminalAt?: number;
  phases: ClaudeWorkflowPhase[];
  agents: ClaudeWorkflowAgent[];
}
