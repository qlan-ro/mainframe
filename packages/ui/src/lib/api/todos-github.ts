/**
 * GitHub sync client for the todos plugin.
 *
 * Plugin routes return RAW JSON bodies (NOT the `ApiResponse<T>` envelope) —
 * use `requestPlugin`/`requestPluginNoContent`, not `request`.
 *
 * Base: /api/plugins/todos/github
 */
import { apiBase, requestPlugin, requestPluginNoContent, expectField } from './http';

// ── Wire types (frozen contract — see the plan's "Wire contract" section) ──

export interface Link {
  projectId: string;
  owner: string;
  repo: string;
  remoteName: string;
  credentialLabel: string;
  lastSyncedAt: string | null;
}

export interface LinkInput {
  projectId: string;
  owner: string;
  repo: string;
  remoteName: string;
  credentialLabel: string;
}

export type PairState = 'clean' | 'overwritten' | 'errored' | 'remotely-unlinked';

export interface Pair {
  todoId: string;
  todoNumber: number;
  issueNumber: number;
  issueUrl: string;
  pairState: PairState;
  stateReason: string | null;
}

export interface RemoteIssue {
  number: number;
  title: string;
  labels: string[];
  pairedTodoNumber: number | null;
}

export interface Failure {
  kind: 'auth' | 'rate-limit' | 'network';
  message: string;
  reached: number;
  total: number;
}

export interface RunSummary {
  runId: string;
  finishedAt: string;
  pairsReconciled: number;
  overwrites: number;
  failure: Failure | null;
  reached: number;
  total: number;
}

export interface ReportRow {
  id: string;
  todoNumber: number;
  todoTitle: string;
  issueNumber: number;
  field: 'title' | 'body' | 'state';
  winner: 'github' | 'mainframe';
  rule: 'recency' | 'tie' | 'in-progress-close';
  /** Null whenever the decision did not compare that stamp (AC21). */
  localAt: string | null;
  remoteAt: string | null;
  remoteCoarse: boolean;
  winningValue: string;
  replacedValue: string;
}

export interface Report {
  runId: string;
  finishedAt: string;
  pairsReconciled: number;
  failure: Failure | null;
  rows: ReportRow[];
}

/** The daemon's reserved-label denylist — see `todos_github::labels` (the sole source). */
export interface WorkflowLabelSet {
  prefixes: string[];
  labels: string[];
}

export interface LinkStatus {
  link: Link | null;
  running: boolean;
  latestRunId: string | null;
  workflowLabels: WorkflowLabelSet;
}

export interface ImportResult {
  imported: { issueNumber: number; todoId: string; todoNumber: number }[];
  skipped: { issueNumber: number; reason: string }[];
}

// ── URL helper ──

const base = (port: number): string => `${apiBase(port)}/api/plugins/todos/github`;

const projectQs = (projectId: string): string => `?projectId=${encodeURIComponent(projectId)}`;

// ── API functions ──

export const getLink = (port: number, projectId: string): Promise<LinkStatus> =>
  requestPlugin<LinkStatus>('GET', `${base(port)}/link${projectQs(projectId)}`);

export const linkRepo = async (port: number, input: LinkInput): Promise<Link> =>
  expectField<Link>(await requestPlugin('PUT', `${base(port)}/link`, input), 'link');

export const unlinkRepo = (port: number, projectId: string): Promise<void> =>
  requestPluginNoContent('DELETE', `${base(port)}/link${projectQs(projectId)}`);

export const listPairs = async (port: number, projectId: string): Promise<Pair[]> =>
  expectField<Pair[]>(await requestPlugin('GET', `${base(port)}/pairs${projectQs(projectId)}`), 'pairs');

export const deletePair = (port: number, todoId: string): Promise<void> =>
  requestPluginNoContent('DELETE', `${base(port)}/pairs/${encodeURIComponent(todoId)}`);

export const listIssues = async (port: number, projectId: string): Promise<RemoteIssue[]> =>
  expectField<RemoteIssue[]>(await requestPlugin('GET', `${base(port)}/issues${projectQs(projectId)}`), 'issues');

export const importIssues = (port: number, projectId: string, issueNumbers: number[]): Promise<ImportResult> =>
  requestPlugin<ImportResult>('POST', `${base(port)}/import`, { projectId, issueNumbers });

export const publishTask = async (port: number, projectId: string, todoId: string): Promise<Pair> =>
  expectField<Pair>(await requestPlugin('POST', `${base(port)}/publish`, { projectId, todoId }), 'pair');

export const runSync = async (port: number, projectId: string): Promise<RunSummary> =>
  expectField<RunSummary>(await requestPlugin('POST', `${base(port)}/sync`, { projectId }), 'run');

export const getReport = async (port: number, projectId: string, runId?: string): Promise<Report | null> => {
  const suffix = runId ? `${projectQs(projectId)}&runId=${encodeURIComponent(runId)}` : projectQs(projectId);
  return expectField<Report | null>(await requestPlugin('GET', `${base(port)}/report${suffix}`), 'report');
};
