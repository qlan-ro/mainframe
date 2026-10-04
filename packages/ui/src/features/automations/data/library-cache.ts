/**
 * library-cache — the pure half of the automations store's scope-keyed
 * library cache. One entry per scope (`projectId | 'all'`), so the modal
 * showing project A and the sidebar list showing "all" each hold their own
 * rows and neither load evicts the other.
 *
 * The patch helpers apply one WS/REST update to EVERY entry it belongs in: a
 * definition lives in its project's entry and in `'all'`; a run lives wherever
 * its automation does. Entries that never loaded are left alone — they will
 * fetch fresh when something asks for them.
 */
import type { AutomationRunSummary, AutomationSummary } from '../contract';

export type ScopeKey = string;

export const ALL_SCOPE: ScopeKey = 'all';

export function scopeKeyOf(projectId: string | null | undefined): ScopeKey {
  return projectId ?? ALL_SCOPE;
}

export interface LibraryEntry {
  definitions: AutomationSummary[];
  runs: AutomationRunSummary[];
  loading: boolean;
  error: string | null;
  /** When the last successful fetch landed; null until the first one. */
  loadedAt: number | null;
}

export type LibraryCache = Record<ScopeKey, LibraryEntry>;

export const EMPTY_LIBRARY: LibraryEntry = Object.freeze({
  definitions: [],
  runs: [],
  loading: false,
  error: null,
  loadedAt: null,
}) as LibraryEntry;

/** Whether a definition belongs in the entry for `scope`. Global automations belong everywhere. */
function belongsTo(scope: ScopeKey, definition: AutomationSummary): boolean {
  return scope === ALL_SCOPE || definition.projectId == null || definition.projectId === scope;
}

function mapEntries(cache: LibraryCache, fn: (scope: ScopeKey, entry: LibraryEntry) => LibraryEntry): LibraryCache {
  const next: LibraryCache = {};
  let changed = false;
  for (const [scope, entry] of Object.entries(cache)) {
    const updated = fn(scope, entry);
    next[scope] = updated;
    if (updated !== entry) changed = true;
  }
  return changed ? next : cache;
}

export function patchDefinitionInCache(cache: LibraryCache, definition: AutomationSummary): LibraryCache {
  return mapEntries(cache, (scope, entry) => {
    const present = entry.definitions.some((d) => d.id === definition.id);
    if (present) {
      return { ...entry, definitions: entry.definitions.map((d) => (d.id === definition.id ? definition : d)) };
    }
    if (!belongsTo(scope, definition)) return entry;
    return { ...entry, definitions: [...entry.definitions, definition] };
  });
}

export function removeDefinitionFromCache(cache: LibraryCache, id: string): LibraryCache {
  return mapEntries(cache, (_scope, entry) =>
    entry.definitions.some((d) => d.id === id)
      ? { ...entry, definitions: entry.definitions.filter((d) => d.id !== id) }
      : entry,
  );
}

/**
 * Replace or prepend a run in every entry that holds its automation. Returns
 * the cache unchanged when the run landed nowhere, so the caller can skip the
 * revision bump.
 */
export function patchRunInCache(cache: LibraryCache, run: AutomationRunSummary): LibraryCache {
  return mapEntries(cache, (_scope, entry) => {
    if (!entry.definitions.some((d) => d.id === run.automationId)) return entry;
    const existing = entry.runs.find((r) => r.id === run.id);
    return {
      ...entry,
      runs: existing ? entry.runs.map((r) => (r.id === run.id ? run : r)) : [run, ...entry.runs],
    };
  });
}

/** The run as any loaded entry currently holds it, for the terminal-status guard. */
export function findRunInCache(cache: LibraryCache, runId: string): AutomationRunSummary | undefined {
  for (const entry of Object.values(cache)) {
    const run = entry.runs.find((r) => r.id === runId);
    if (run) return run;
  }
  return undefined;
}

export function findDefinitionInCache(cache: LibraryCache, id: string): AutomationSummary | undefined {
  for (const entry of Object.values(cache)) {
    const definition = entry.definitions.find((d) => d.id === id);
    if (definition) return definition;
  }
  return undefined;
}

/** Every loaded run for one automation, deduplicated across scopes, newest first. */
export function runsForAutomation(cache: LibraryCache, automationId: string): AutomationRunSummary[] {
  const seen = new Map<string, AutomationRunSummary>();
  for (const entry of Object.values(cache)) {
    for (const run of entry.runs) if (run.automationId === automationId && !seen.has(run.id)) seen.set(run.id, run);
  }
  return [...seen.values()].sort((a, b) => b.startedAt - a.startedAt);
}
