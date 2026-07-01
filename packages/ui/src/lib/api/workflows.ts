import type { WorkflowSummary, WorkflowRunSummary, WorkflowInteractionSummary } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

// The daemon returns the nested tree shape for a run detail.
export interface RunTreeNode {
  stepPath: string;
  stepId: string | null;
  kind: string;
  status: string;
  attempt: number;
  input: unknown;
  output: unknown;
  truncated?: boolean;
  error: string | null;
  chatId?: string;
  lanes?: Array<{ label: string; status: string; steps: RunTreeNode[] }>;
  arms?: Array<{ cond: string; taken: boolean; steps: RunTreeNode[] }>;
  iterations?: Array<{ label: string; status: string; steps: RunTreeNode[] }>;
  ref?: string;
  childRunId?: string;
  steps?: RunTreeNode[];
}

export interface RunDetail {
  run: WorkflowRunSummary;
  tree: RunTreeNode[];
}

const b = (port: number) => `${apiBase(port)}/api`;

export const listWorkflows = (port: number): Promise<WorkflowSummary[]> => request('GET', `${b(port)}/workflows`);

export const rescanWorkflows = (port: number): Promise<{ errors: Array<{ file: string; error: string }> }> =>
  request('POST', `${b(port)}/workflows/rescan`);

export const startRun = (port: number, id: string, inputs?: Record<string, unknown>): Promise<WorkflowRunSummary> =>
  request('POST', `${b(port)}/workflows/${encodeURIComponent(id)}/runs`, {
    inputs: inputs ?? {},
  });

export const listRuns = (port: number, id: string): Promise<WorkflowRunSummary[]> =>
  request('GET', `${b(port)}/workflows/${encodeURIComponent(id)}/runs`);

export const getRun = (port: number, runId: string): Promise<RunDetail> =>
  request('GET', `${b(port)}/workflow-runs/${encodeURIComponent(runId)}`);

export const cancelRun = (port: number, runId: string): Promise<void> =>
  requestEmpty('POST', `${b(port)}/workflow-runs/${encodeURIComponent(runId)}/cancel`);

export const listInteractions = (port: number): Promise<WorkflowInteractionSummary[]> =>
  request('GET', `${b(port)}/workflow-interactions`);

export const respondInteraction = (port: number, id: string, response: Record<string, unknown>): Promise<void> =>
  requestEmpty('POST', `${b(port)}/workflow-interactions/${encodeURIComponent(id)}/respond`, { response });

export const getConnectors = (port: number): Promise<unknown> => request('GET', `${b(port)}/workflow-connectors`);

export const listCredentials = (port: number): Promise<{ labels: string[] }> =>
  request('GET', `${b(port)}/workflow-credentials`);

export const putCredential = (port: number, label: string, token: string): Promise<void> =>
  requestEmpty('PUT', `${b(port)}/workflow-credentials/${encodeURIComponent(label)}`, {
    token,
  });

export const deleteCredential = (port: number, label: string): Promise<void> =>
  requestEmpty('DELETE', `${b(port)}/workflow-credentials/${encodeURIComponent(label)}`);

export const validateYaml = (
  port: number,
  yaml: string,
): Promise<{ valid: boolean; errors: Array<{ message: string }> }> =>
  request('POST', `${b(port)}/workflows/validate`, { yaml });

export const putWorkflow = (port: number, id: string, yaml: string): Promise<WorkflowSummary> =>
  request('PUT', `${b(port)}/workflows/${encodeURIComponent(id)}`, { yaml });

export const deleteWorkflow = (port: number, id: string): Promise<void> =>
  requestEmpty('DELETE', `${b(port)}/workflows/${encodeURIComponent(id)}`);

export const getWorkflowSource = (port: number, id: string): Promise<{ summary: WorkflowSummary; yaml: string }> =>
  request('GET', `${b(port)}/workflows/${encodeURIComponent(id)}`);
