/**
 * Daemon REST wrapper for external-session discovery and import.
 *
 * Both routes live under /api/projects/:projectId/external-sessions.
 * The daemon returns the standard {success, data} envelope; `request<T>`
 * unwraps it, so callers receive the typed payload directly.
 */
import type { Chat, ExternalSession } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

/** Body sent to POST /api/projects/:projectId/external-sessions/import. */
export interface ImportExternalSessionBody {
  sessionId: string;
  adapterId: string;
  title?: string;
  createdAt?: string;
  modifiedAt?: string;
}

/** List external sessions the daemon found for a project (not yet imported). */
export const getExternalSessions = (port: number, projectId: string): Promise<ExternalSession[]> =>
  request<ExternalSession[]>('GET', `${apiBase(port)}/api/projects/${projectId}/external-sessions`);

/** Import a single external session into the daemon's chat store. */
export const importExternalSession = (
  port: number,
  projectId: string,
  body: ImportExternalSessionBody,
): Promise<Chat> => request<Chat>('POST', `${apiBase(port)}/api/projects/${projectId}/external-sessions/import`, body);
