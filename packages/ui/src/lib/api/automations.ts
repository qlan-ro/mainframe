/**
 * Automations v2 REST client (contract §4). Unlike older `lib/api` modules,
 * these calls take no `port` — the automations feature was built daemon-
 * target-agnostic from Phase 0 (`AutomationsGateway` has no port param,
 * `AutomationsHost` mounts with no port prop); `apiBase()` already resolves
 * the active daemon target on its own (`lib/api/http.ts`).
 *
 * `POST /api/automation-webhooks/:hookId` (webhook ingress) is intentionally
 * absent — contract §4 marks it daemon-only, never a UI caller.
 */
import type {
  ActionCatalogEntry,
  AutomationCreateInput,
  AutomationInteractionSummary,
  AutomationRunSummary,
  AutomationSummary,
  AutomationTimelineEntry,
} from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

export interface AutomationRunDetail {
  run: AutomationRunSummary;
  timeline: AutomationTimelineEntry[];
}

const b = () => `${apiBase()}/api`;

export const listAutomations = (): Promise<AutomationSummary[]> => request('GET', `${b()}/automations`);

export const createAutomation = (input: AutomationCreateInput): Promise<AutomationSummary> =>
  request('POST', `${b()}/automations`, input);

export const getAutomation = (id: string): Promise<AutomationSummary> =>
  request('GET', `${b()}/automations/${encodeURIComponent(id)}`);

export const updateAutomation = (id: string, input: AutomationCreateInput): Promise<AutomationSummary> =>
  request('PUT', `${b()}/automations/${encodeURIComponent(id)}`, input);

export const deleteAutomation = (id: string): Promise<void> =>
  requestEmpty('DELETE', `${b()}/automations/${encodeURIComponent(id)}`);

export const setAutomationEnabled = (id: string, enabled: boolean): Promise<AutomationSummary> =>
  request('PATCH', `${b()}/automations/${encodeURIComponent(id)}/enabled`, { enabled });

export const startAutomationRun = (id: string): Promise<AutomationRunSummary> =>
  request('POST', `${b()}/automations/${encodeURIComponent(id)}/runs`);

export const listAutomationRuns = (id: string): Promise<AutomationRunSummary[]> =>
  request('GET', `${b()}/automations/${encodeURIComponent(id)}/runs`);

/** GET /api/automation-runs/:id returns `{run, timeline}` together — the gateway's split getRun/getRunTimeline both call this and pick a field. */
export const getAutomationRun = (runId: string): Promise<AutomationRunDetail> =>
  request('GET', `${b()}/automation-runs/${encodeURIComponent(runId)}`);

export const cancelAutomationRun = (runId: string): Promise<void> =>
  requestEmpty('POST', `${b()}/automation-runs/${encodeURIComponent(runId)}/cancel`);

export const listAutomationInteractions = (): Promise<AutomationInteractionSummary[]> =>
  request('GET', `${b()}/automation-interactions`);

export const respondAutomationInteraction = (id: string, response: Record<string, unknown>): Promise<void> =>
  requestEmpty('POST', `${b()}/automation-interactions/${encodeURIComponent(id)}/respond`, { response });

export const listAutomationActions = (): Promise<ActionCatalogEntry[]> => request('GET', `${b()}/automation-actions`);

export const listAutomationCredentialLabels = (): Promise<{ labels: string[] }> =>
  request('GET', `${b()}/automation-credentials`);

export const getAutomationCredential = (label: string): Promise<{ label: string; kind: string }> =>
  request('GET', `${b()}/automation-credentials/${encodeURIComponent(label)}`);

export const putAutomationCredential = (label: string, token: string): Promise<void> =>
  requestEmpty('PUT', `${b()}/automation-credentials/${encodeURIComponent(label)}`, { token });

export const deleteAutomationCredential = (label: string): Promise<void> =>
  requestEmpty('DELETE', `${b()}/automation-credentials/${encodeURIComponent(label)}`);
