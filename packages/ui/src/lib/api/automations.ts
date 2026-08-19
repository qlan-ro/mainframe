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
  WebhookRegistration,
} from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

export interface AutomationRunDetail {
  run: AutomationRunSummary;
  timeline: AutomationTimelineEntry[];
}

const b = () => `${apiBase()}/api`;

export const listAutomations = (projectId?: string | null): Promise<AutomationSummary[]> =>
  request('GET', projectId ? `${b()}/automations?projectId=${encodeURIComponent(projectId)}` : `${b()}/automations`);

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

/** Arms a webhook trigger's hook server-side (idempotent) and returns the ingest URL the daemon will accept. */
export const registerAutomationWebhook = (id: string, triggerId: string): Promise<WebhookRegistration> =>
  request('POST', `${b()}/automations/${encodeURIComponent(id)}/webhooks/${encodeURIComponent(triggerId)}/register`);

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

/** `POST /api/automation-credentials/github/device/start` response — one device-flow session. */
export interface GithubDeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export type GithubDevicePollStatus = 'pending' | 'slow_down' | 'expired' | 'denied' | 'connected' | 'error';

/** `POST /api/automation-credentials/github/device/poll` response — one poll attempt's outcome. */
export interface GithubDevicePollResult {
  status: GithubDevicePollStatus;
  interval?: number;
  message?: string;
}

/** Throws (status 501) when no OAuth App client ID is configured yet — see `github_device.rs`. */
export const startGithubDeviceFlow = (): Promise<GithubDeviceStart> =>
  request('POST', `${b()}/automation-credentials/github/device/start`);

export const pollGithubDeviceFlow = (deviceCode: string): Promise<GithubDevicePollResult> =>
  request('POST', `${b()}/automation-credentials/github/device/poll`, { deviceCode });

/** Whether a GitHub App client ID is registered — gates the sign-in-with-GitHub button. */
export const getGithubDeviceFlowStatus = (): Promise<{ configured: boolean }> =>
  request('GET', `${b()}/automation-credentials/github/device/status`);
