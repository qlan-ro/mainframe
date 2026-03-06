import type { Chat, ExternalSession } from '@mainframe/types';
import { API_BASE, postJson } from './http';

export async function getExternalSessions(projectId: string): Promise<ExternalSession[]> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/external-sessions`);
  if (!res.ok) return [];
  const json = (await res.json()) as { data: ExternalSession[] };
  return json.data;
}

export async function importExternalSession(
  projectId: string,
  sessionId: string,
  adapterId: string,
  title?: string,
): Promise<Chat> {
  const json = await postJson<{ success: boolean; data: Chat }>(
    `${API_BASE}/api/projects/${projectId}/external-sessions/import`,
    { sessionId, adapterId, title },
  );
  return json.data;
}
