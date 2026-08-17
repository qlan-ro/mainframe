/**
 * store/projects.ts — the shared project list.
 *
 * Unlike adapters/quota, the daemon has no push event for project changes, so
 * this store is refreshed only by an explicit `reloadProjects(port)` call —
 * every `useProjects()` instance issues one on mount/port-change. The point of
 * moving the list here (out of `useProjects`'s old per-caller `useState`) is
 * that a reload from ANY one call site (e.g. the first-run "Add project" CTA)
 * is now visible to every other mounted consumer without a remount.
 *
 * Because every mounted consumer reloads on mount, a screen with many
 * consumers (11+, as of the sessions sidebar) fires that many concurrent
 * `getProjects` HTTP calls at once. `reloadProjects` dedupes same-port calls
 * that overlap an in-flight request onto that request's promise; a call for a
 * different port, or one that starts after the previous request settled
 * (e.g. after a mutation like "Add project"), always gets a fresh fetch.
 *
 * `loading` means "the initial load hasn't resolved yet", not "a fetch is
 * currently in flight" — it flips false on the first settle and stays there. A
 * consumer gated on it (ChatSurface's first-run hero vs. the normal thread
 * view) mounts/unmounts a DIFFERENT subtree depending on its value; if a later
 * reload set it back to `true`, that swap would unmount the current subtree
 * and mount the other one, whose own `useProjects()` fires yet another reload
 * — flipping `loading` back and forth forever. This is exactly what produced
 * ~9500 mount/unmount cycles and thousands of `/api/projects` calls in a
 * single zero-projects boot (the actual mechanism behind the release-blocking
 * sessions-draft.spec.ts failure; request dedup alone reduces the herd per
 * cycle but can't break the cycle itself, since each cycle's requests settle
 * before the next mount fires).
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
let inFlight: { port: number; token: object; promise: Promise<void> } | null = null;

/** Only the most recently-issued call is allowed to apply its result, so a slow
 *  response from an earlier reload can't clobber a fresher one that resolved first. */
export async function reloadProjects(port: number): Promise<void> {
  if (inFlight && inFlight.port === port) return inFlight.promise;

  const generation = ++reloadGeneration;
  const token = {};
  const promise = (async () => {
    try {
      const projects = await getProjects(port);
      if (generation === reloadGeneration) useProjectsStore.setState({ projects, loading: false });
    } catch (e: unknown) {
      console.warn('[store/projects] getProjects failed', e);
      if (generation === reloadGeneration) useProjectsStore.setState({ loading: false });
    } finally {
      if (inFlight?.token === token) inFlight = null;
    }
  })();
  inFlight = { port, token, promise };
  return promise;
}

/** Reserved for tests — mirrors resetAdapters/resetQuota. */
export function resetProjectsStore(): void {
  reloadGeneration = 0;
  inFlight = null;
  useProjectsStore.setState({ projects: [], loading: true });
}
