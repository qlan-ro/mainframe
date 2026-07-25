/**
 * Setup Advisor REST client. Follows the `automations.ts` no-port convention
 * (`apiBase()` resolves the active daemon on its own) — the newest pattern in
 * `lib/api`, not the older `getProjects(port, …)` shape.
 *
 * The response is parsed, not cast: it is serialized by the Rust daemon, so a
 * field-rename or shape drift on that side would otherwise reach the sheet as
 * blank rows. Parsing turns it into the store's error state instead.
 */
import { SetupAdvisorReportSchema, type SetupAdvisorReport } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

const b = () => `${apiBase()}/api`;

export async function getAutomationRecommendations(projectId: string): Promise<SetupAdvisorReport> {
  const raw = await request<unknown>(
    'GET',
    `${b()}/projects/${encodeURIComponent(projectId)}/automation-recommendations`,
  );
  const parsed = SetupAdvisorReportSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  const at = issue ? issue.path.join('.') : '';
  throw new Error(`The daemon returned a report this app can't read${at ? ` (at ${at})` : ''}.`);
}
