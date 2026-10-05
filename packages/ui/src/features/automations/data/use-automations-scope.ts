/**
 * The ONE automations project-scope rule (D7): the session scope's sole
 * project loads/reads that project's library; an empty scope loads/reads
 * 'all'; a multi-project scope also loads/reads 'all' and filters
 * client-side to definitions whose project is in scope, plus unscoped
 * (global) ones — the server-side cache has no "several projects" key of
 * its own.
 *
 * Two hooks, because only ONE mount per surface should own the fetch:
 *  - `useScopedAutomationsLibrary` loads AND reads — `AutomationsSidebarList`
 *    (the sidebar's own load) and `AutomationsSurface` (keeps the store's
 *    `scopeProjectId` in sync, which IS the body's load, mirroring the old
 *    `AutomationsHost`).
 *  - `useAutomationsLibraryView` reads the already-loaded entry (keyed off
 *    the store's `scopeProjectId`, which `AutomationsSurface` owns) WITHOUT
 *    triggering a second fetch of its own — `LibraryList` and the body
 *    header's count. Calling the loading hook from both the surface and
 *    the list it renders would double-fetch on every mount.
 */
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import type { AutomationSummary } from '../contract';
import type { LibraryEntry } from './library-cache';
import { useAutomationsLibrary } from './use-automations-library';
import { selectModalLibrary, useAutomationsStore } from './use-automations-store';

function filterByScope(definitions: AutomationSummary[], scope: ReadonlySet<string>): AutomationSummary[] {
  // A sole-project or empty-scope load is already correctly scoped
  // server-side — only the multi-project case needs a client-side filter.
  if (scope.size <= 1) return definitions;
  return definitions.filter((d) => d.projectId == null || scope.has(d.projectId));
}

export interface ScopedAutomationsLibrary extends LibraryEntry {
  /** What the load resolved to — null means 'all'. Feeds `scopeProjectId`
   *  (the editor's save target and the project-scoped field pickers). */
  loadProjectId: string | null;
}

/** Loads AND reads — exactly one mount per surface should use this. */
export function useScopedAutomationsLibrary(): ScopedAutomationsLibrary {
  const scope = useSessionFilters((s) => s.filterProjectIds);
  const loadProjectId = soleProjectId(scope);
  const entry = useAutomationsLibrary(loadProjectId);
  return { ...entry, loadProjectId, definitions: filterByScope(entry.definitions, scope) };
}

/** Reads the entry the store's `scopeProjectId` already names — no fetch. */
export function useAutomationsLibraryView(): LibraryEntry {
  const scope = useSessionFilters((s) => s.filterProjectIds);
  const entry = useAutomationsStore(selectModalLibrary);
  return { ...entry, definitions: filterByScope(entry.definitions, scope) };
}
