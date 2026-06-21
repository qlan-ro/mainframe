/**
 * Projects REST wrapper — lists the daemon's known projects.
 */
import type { Project } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestNoContent } from './http';

export const getProjects = (port: number): Promise<Project[]> =>
  request<Project[]>('GET', `${apiBase(port)}/api/projects`);

export const removeProject = (port: number, projectId: string): Promise<void> =>
  requestNoContent('DELETE', `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}`);

/**
 * Registers an existing directory as a project.
 *
 * Uses a raw fetch (not the shared `request` helper) because the daemon returns
 * 409 with a body for an already-registered path — a success case for us, not an
 * error. 200 → newly created; 409 → already registered (returns the existing row).
 */
export async function createProject(
  port: number,
  path: string,
  name?: string,
): Promise<{ project: Project; alreadyExists: boolean }> {
  const res = await fetch(`${apiBase(port)}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name !== undefined ? { path, name } : { path }),
  });

  if (res.status === 409) {
    const body = (await res.json()) as { data: Project };
    return { project: body.data, alreadyExists: true };
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      /* expected: body may not be JSON */
    }
    throw new Error(message);
  }
  const body = (await res.json()) as { data: Project };
  return { project: body.data, alreadyExists: false };
}
