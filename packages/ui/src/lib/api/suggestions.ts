/** Repo-suggestions client for the new-session Welcome state. */
import type { Suggestion } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

/** Fetch ≤3 ranked repo suggestions for a project. Throws on HTTP/API error. */
export function getSuggestions(port: number, projectId: string): Promise<Suggestion[]> {
  return request<Suggestion[]>('GET', `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/suggestions`);
}
