/**
 * store/projects.ts — the shared project list.
 *
 * Unlike adapters/quota, the daemon has no push event for project changes, so
 * this store is refreshed only by an explicit `reloadProjects(port)` call —
 * every `useProjects()` instance issues one on mount/port-change. The point of
 * moving the list here (out of `useProjects`'s old per-caller `useState`) is
 * that a reload from ANY one call site (e.g. the first-run "Add project" CTA)
 * is now visible to every other mounted consumer without a remount.
 */
import { create } from 'zustand';
import type { Project } from '@qlan-ro/mainframe-types';
import { getProjects } from '@/lib/api/projects';

interface ProjectsState {
  projects: Project[];
  loading: boolean;
}

export const useProjectsStore = create<ProjectsState>(() => ({ projects: [], loading: true }));

export function removeProjectFromList(projectId: string): void {
  useProjectsStore.setState((s) => ({ projects: s.projects.filter((p) => p.id !== projectId) }));
}

let reloadGeneration = 0;

/** Only the most recently-issued call is allowed to apply its result, so a slow
 *  response from an earlier reload can't clobber a fresher one that resolved first. */
export async function reloadProjects(port: number): Promise<void> {
  const generation = ++reloadGeneration;
  useProjectsStore.setState({ loading: true });
  try {
    const projects = await getProjects(port);
    if (generation === reloadGeneration) useProjectsStore.setState({ projects, loading: false });
  } catch (e: unknown) {
    console.warn('[store/projects] getProjects failed', e);
    if (generation === reloadGeneration) useProjectsStore.setState({ loading: false });
  }
}

/** Reserved for tests — mirrors resetAdapters/resetQuota. */
export function resetProjectsStore(): void {
  reloadGeneration = 0;
  useProjectsStore.setState({ projects: [], loading: true });
}
