/**
 * skills-cli.ts — REST wrapper for the daemon's skills-cli routes.
 *
 * Raw `fetch` + `authHeaders()`, not `request()`: a 502 failure body carries
 * `tail`/`exitCode` beyond the standard `{ success, error }` envelope, and
 * `request()` discards unknown error fields. `createProject` in
 * `projects.ts` is the existing precedent for this escape hatch.
 */
import type {
  SkillsCatalog,
  SkillsCliManifest,
  SkillsCliProbe,
  SkillsCliScope,
  SkillsSearchResult,
} from '@qlan-ro/mainframe-types';
import {
  SkillsCatalogSchema,
  SkillsCliManifestSchema,
  SkillsCliProbeSchema,
  SkillsSearchResponseSchema,
} from '@qlan-ro/mainframe-types';
import { apiBase, authHeaders } from './http';

/** Thrown for every non-2xx response. Carries the daemon's CLI failure fields when present. */
export class SkillsCliError extends Error {
  readonly tail?: string;
  readonly exitCode?: number | null;

  constructor(message: string, tail?: string, exitCode?: number | null) {
    super(message);
    this.name = 'SkillsCliError';
    this.tail = tail;
    this.exitCode = exitCode;
  }
}

function fetchInit(method: string, body?: unknown): RequestInit {
  const headers = { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
  const init: RequestInit = { method };
  if (Object.keys(headers).length > 0) init.headers = headers;
  if (body !== undefined) init.body = JSON.stringify(body);
  return init;
}

async function throwFailure(res: Response): Promise<never> {
  const body = (await res.json()) as { error?: string; tail?: string; exitCode?: number | null };
  throw new SkillsCliError(body.error ?? `Request failed with status ${res.status}`, body.tail, body.exitCode);
}

export async function getSkillsCliManifest(projectId: string, adapterId?: string): Promise<SkillsCliManifest> {
  const qs = adapterId !== undefined ? `?adapterId=${encodeURIComponent(adapterId)}` : '';
  const url = `${apiBase()}/api/projects/${encodeURIComponent(projectId)}/skills-cli/manifest${qs}`;
  const res = await fetch(url, fetchInit('GET'));
  if (!res.ok) return throwFailure(res);
  const { data } = (await res.json()) as { data: unknown };
  return SkillsCliManifestSchema.parse(data);
}

export async function probeSkillsSource(
  projectId: string,
  source: string,
  adapterId?: string,
): Promise<SkillsCliProbe> {
  const url = `${apiBase()}/api/projects/${encodeURIComponent(projectId)}/skills-cli/probe`;
  const res = await fetch(url, fetchInit('POST', { source, adapterId }));
  if (!res.ok) return throwFailure(res);
  const { data } = (await res.json()) as { data: unknown };
  return SkillsCliProbeSchema.parse(data);
}

export async function installSkills(
  projectId: string,
  source: string,
  skills: string[],
  scope: SkillsCliScope,
  adapterId?: string,
): Promise<void> {
  const url = `${apiBase()}/api/projects/${encodeURIComponent(projectId)}/skills-cli/install`;
  const res = await fetch(url, fetchInit('POST', { source, skills, scope, adapterId }));
  if (!res.ok) await throwFailure(res);
}

/** The registry's ranked catalog. Not project-scoped — it's the same everywhere. */
export async function getSkillsCatalog(): Promise<SkillsCatalog> {
  const res = await fetch(`${apiBase()}/api/skills-cli/catalog`, fetchInit('GET'));
  if (!res.ok) return throwFailure(res);
  const { data } = (await res.json()) as { data: unknown };
  return SkillsCatalogSchema.parse(data);
}

/** The daemon rejects a query under 2 characters, so callers must debounce and gate on length. */
export async function searchSkills(query: string): Promise<SkillsSearchResult[]> {
  const url = `${apiBase()}/api/skills-cli/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, fetchInit('GET'));
  if (!res.ok) return throwFailure(res);
  const { data } = (await res.json()) as { data: unknown };
  return SkillsSearchResponseSchema.parse(data).entries;
}

export async function uninstallSkills(
  projectId: string,
  skills: string[],
  scope: SkillsCliScope,
  adapterId?: string,
): Promise<void> {
  const url = `${apiBase()}/api/projects/${encodeURIComponent(projectId)}/skills-cli/uninstall`;
  const res = await fetch(url, fetchInit('POST', { skills, scope, adapterId }));
  if (!res.ok) await throwFailure(res);
}
