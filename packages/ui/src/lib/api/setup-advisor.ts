/**
 * Setup Advisor REST client. Follows the `automations.ts` no-port convention
 * (`apiBase()` resolves the active daemon on its own) — the newest pattern in
 * `lib/api`, not the older `getProjects(port, …)` shape.
 */
import type { SetupAdvisorReport } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

const b = () => `${apiBase()}/api`;

export const getAutomationRecommendations = (projectId: string): Promise<SetupAdvisorReport> =>
  request('GET', `${b()}/projects/${encodeURIComponent(projectId)}/automation-recommendations`);
