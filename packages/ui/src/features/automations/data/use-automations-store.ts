/**
 * Automations v2 data store — definitions/runs/interactions/catalog/
 * credentials, all fetched through an injected `AutomationsGateway`. Defaults
 * to the in-memory fixture gateway so every surface works with no live daemon
 * routes; `setGateway` swaps in the real `http-gateway.ts` at the entry-point
 * boundary.
 *
 * The library is a SCOPE-KEYED cache (`libraries`, see `library-cache.ts`):
 * the modal loads its own project's entry and the sidebar list loads
 * `soleProjectId ?? 'all'`, and neither load evicts the other. Read an entry
 * with `selectLibrary(scope)`; resolve one automation regardless of which scope
 * loaded it with `selectAutomationById(id)`. `loadInteractions` is separate
 * because the rail's pending badge is alive whether or not any library loads.
 */
import { create } from 'zustand';
import type {
  ActionCatalogEntry,
  AutomationInteractionSummary,
  AutomationRunSummary,
  AutomationSummary,
} from '../contract';
import { createFixtureGateway } from '../fixtures/fixture-gateway';
import type { AutomationsGateway } from './gateway';
import {
  EMPTY_LIBRARY,
  findDefinitionInCache,
  findRunInCache,
  patchDefinitionInCache,
  patchRunInCache,
  removeDefinitionFromCache,
  scopeKeyOf,
  type LibraryCache,
  type LibraryEntry,
  type ScopeKey,
} from './library-cache';

/** One in-flight sequence per scope, so a stale response for scope A never lands over a fresh one for A. */
const librarySeqs = new Map<ScopeKey, number>();
let interactionsSeq = 0;

const TERMINAL_RUN_STATUSES: ReadonlySet<AutomationRunSummary['status']> = new Set([
  'succeeded',
  'failed',
  'cancelled',
]);

function isTerminalRunStatus(status: AutomationRunSummary['status']): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

interface AutomationsState {
  gateway: AutomationsGateway;
  /** The project the open Automations modal is showing — the editor's save target and its project-scoped pickers read it too. `null` whenever the modal is closed, and while it is open when the user is on "All projects". */
  scopeProjectId: string | null;
  libraries: LibraryCache;
  /** Bumped by `patchRun` on every applied update — lets a run view refetch on every `automation.run.updated` for its run id, not just status changes (a run can emit one per step transition). */
  runRevisions: Record<string, number>;
  interactions: AutomationInteractionSummary[];
  catalog: ActionCatalogEntry[];
  credentials: string[];
  setGateway: (gateway: AutomationsGateway) => void;
  setScopeProjectId: (projectId: string | null) => void;
  /** Pending interactions only — the rail badge's load, and never the library's. */
  loadInteractions: () => Promise<void>;
  /** Fill one scope's entry: that scope's automations plus their runs, and the (scope-free) catalog and credential labels. */
  loadLibrary: (projectId: string | null) => Promise<void>;
  patchDefinition: (definition: AutomationSummary) => void;
  removeDefinition: (id: string) => void;
  patchRun: (run: AutomationRunSummary) => void;
  addInteraction: (interaction: AutomationInteractionSummary) => void;
  resolveInteraction: (interactionId: string) => void;
  addCredential: (label: string) => void;
  removeCredential: (label: string) => void;
}

function entryOf(libraries: LibraryCache, scope: ScopeKey): LibraryEntry {
  return libraries[scope] ?? EMPTY_LIBRARY;
}

async function fetchRuns(
  gateway: AutomationsGateway,
  definitions: AutomationSummary[],
): Promise<{ runs: AutomationRunSummary[]; error: string | null }> {
  const results = await Promise.allSettled(definitions.map((d) => gateway.listRuns(d.id)));
  const runs: AutomationRunSummary[] = [];
  let error: string | null = null;
  for (const result of results) {
    if (result.status === 'fulfilled') runs.push(...result.value);
    else error = result.reason instanceof Error ? result.reason.message : 'Failed to load run history';
  }
  runs.sort((a, b) => b.startedAt - a.startedAt);
  return { runs, error };
}

export const useAutomationsStore = create<AutomationsState>((set, get) => ({
  gateway: createFixtureGateway(),
  scopeProjectId: null,
  libraries: {},
  runRevisions: {},
  interactions: [],
  catalog: [],
  credentials: [],

  setGateway: (gateway) => set({ gateway }),
  setScopeProjectId: (scopeProjectId) => set({ scopeProjectId }),

  loadInteractions: async () => {
    const seqAtStart = ++interactionsSeq;
    try {
      const interactions = await get().gateway.listInteractions();
      if (seqAtStart !== interactionsSeq) return;
      set({ interactions });
    } catch (err) {
      // The badge is ambient — a failure here must not paint a library's
      // error screen, which belongs to the load the user asked for.
      console.warn('[automations/use-automations-store] failed to load pending interactions', err);
    }
  },

  loadLibrary: async (projectId) => {
    const scope = scopeKeyOf(projectId);
    const seqAtStart = (librarySeqs.get(scope) ?? 0) + 1;
    librarySeqs.set(scope, seqAtStart);
    const isCurrent = () => librarySeqs.get(scope) === seqAtStart;
    const patchEntry = (patch: Partial<LibraryEntry>) =>
      set((s) => ({ libraries: { ...s.libraries, [scope]: { ...entryOf(s.libraries, scope), ...patch } } }));
    const { gateway } = get();
    // A retry keeps the prior rows on screen while it refetches (the library's
    // error banner sits over stale rows rather than a blank list).
    patchEntry({ loading: true, error: null });
    try {
      const [definitions, catalog, credentials] = await Promise.all([
        gateway.listAutomations(projectId),
        gateway.listActions(),
        gateway.listCredentialLabels(),
      ]);
      if (!isCurrent()) return;
      const { runs, error } = await fetchRuns(gateway, definitions);
      if (!isCurrent()) return;
      set({ catalog, credentials });
      patchEntry({ definitions, runs, loading: false, error, loadedAt: Date.now() });
    } catch (err) {
      if (!isCurrent()) return;
      patchEntry({ loading: false, error: err instanceof Error ? err.message : 'Failed to load automations' });
    }
  },

  patchDefinition: (definition) => set((s) => ({ libraries: patchDefinitionInCache(s.libraries, definition) })),

  removeDefinition: (id) => set((s) => ({ libraries: removeDefinitionFromCache(s.libraries, id) })),

  patchRun: (run) =>
    set((s) => {
      const existing = findRunInCache(s.libraries, run.id);
      // A fast run's WS terminal event can land before the 202 startRun response
      // resolves; the stale `running` snapshot must not clobber it — nothing
      // later would ever un-stick the view.
      if (existing && isTerminalRunStatus(existing.status) && !isTerminalRunStatus(run.status)) return s;
      const libraries = patchRunInCache(s.libraries, run);
      if (libraries === s.libraries) return s;
      return { libraries, runRevisions: { ...s.runRevisions, [run.id]: (s.runRevisions[run.id] ?? 0) + 1 } };
    }),

  addInteraction: (interaction) =>
    set((s) =>
      s.interactions.some((i) => i.id === interaction.id) ? s : { interactions: [interaction, ...s.interactions] },
    ),

  resolveInteraction: (interactionId) =>
    set((s) => ({ interactions: s.interactions.filter((i) => i.id !== interactionId) })),

  addCredential: (label) =>
    set((s) => (s.credentials.includes(label) ? s : { credentials: [...s.credentials, label] })),

  removeCredential: (label) => set((s) => ({ credentials: s.credentials.filter((c) => c !== label) })),
}));

export const selectPendingInteractionCount = (s: AutomationsState): number => s.interactions.length;

/** One scope's entry — a stable reference while that scope is untouched. */
export const selectLibrary =
  (scope: ScopeKey) =>
  (s: AutomationsState): LibraryEntry =>
    entryOf(s.libraries, scope);

/** The open modal's entry: whatever project `scopeProjectId` names, `'all'` when it is null. */
export const selectModalLibrary = (s: AutomationsState): LibraryEntry =>
  entryOf(s.libraries, scopeKeyOf(s.scopeProjectId));

/** A run as any loaded scope holds it — the toast's "View run" lands here whatever the modal's scope is. */
export const selectRunById =
  (id: string | null) =>
  (s: AutomationsState): AutomationRunSummary | undefined =>
    id == null ? undefined : findRunInCache(s.libraries, id);

/** Resolves across every loaded scope — a row clicked under the sidebar's scope resolves in the modal whatever ITS scope is. */
export const selectAutomationById =
  (id: string | null) =>
  (s: AutomationsState): AutomationSummary | undefined =>
    id == null ? undefined : findDefinitionInCache(s.libraries, id);
