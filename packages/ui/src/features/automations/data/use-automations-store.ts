/**
 * Automations v2 data store — definitions/runs/interactions/catalog/
 * credentials, all fetched through an injected `AutomationsGateway`. Defaults
 * to the in-memory fixture gateway so every phase through Phase 5 works with
 * no live daemon routes; `setGateway` is how Phase 6 swaps in the real
 * `http-gateway.ts` at the entry-point boundary, mirroring
 * `use-workflows-store.ts`'s stale-response guard.
 *
 * Two loaders, because two consumers disagree about scope: `loadInteractions`
 * feeds the sidebar's pending badge and runs from app boot whether or not the
 * modal is open, while `loadLibrary` fetches one project's automations for the
 * open modal.
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

let librarySeq = 0;
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
  /** The current session's active project — resolved once, at the `AutomationsHost` mount boundary, via `useActiveIdentity()` (todo #234 bullet 1: automations are project-scoped non-configurably, mirroring Todos). `null` before an active project resolves. */
  scopeProjectId: string | null;
  definitions: AutomationSummary[];
  runs: AutomationRunSummary[];
  /** Bumped by `patchRun` on every applied update — lets a run view refetch on every `automation.run.updated` for its run id, not just status changes (a run can emit one per step transition). */
  runRevisions: Record<string, number>;
  interactions: AutomationInteractionSummary[];
  catalog: ActionCatalogEntry[];
  credentials: string[];
  loading: boolean;
  error: string | null;
  setGateway: (gateway: AutomationsGateway) => void;
  setScopeProjectId: (projectId: string | null) => void;
  /** Pending interactions only — the sidebar badge's load, and never the library's. */
  loadInteractions: () => Promise<void>;
  /** The open modal's library: that project's automations plus their runs, the action catalog and the credential labels. */
  loadLibrary: (projectId: string | null) => Promise<void>;
  patchDefinition: (definition: AutomationSummary) => void;
  removeDefinition: (id: string) => void;
  patchRun: (run: AutomationRunSummary) => void;
  addInteraction: (interaction: AutomationInteractionSummary) => void;
  resolveInteraction: (interactionId: string) => void;
  addCredential: (label: string) => void;
  removeCredential: (label: string) => void;
}

export const useAutomationsStore = create<AutomationsState>((set, get) => ({
  gateway: createFixtureGateway(),
  scopeProjectId: null,
  definitions: [],
  runs: [],
  runRevisions: {},
  interactions: [],
  catalog: [],
  credentials: [],
  loading: false,
  error: null,

  setGateway: (gateway) => set({ gateway }),
  setScopeProjectId: (scopeProjectId) => set({ scopeProjectId }),

  loadInteractions: async () => {
    const seqAtStart = ++interactionsSeq;
    try {
      const interactions = await get().gateway.listInteractions();
      if (seqAtStart !== interactionsSeq) return;
      set({ interactions });
    } catch (err) {
      // The badge is ambient — a failure here must not paint the library's
      // error screen, which belongs to the load the user asked for.
      console.warn('[automations/use-automations-store] failed to load pending interactions', err);
    }
  },

  loadLibrary: async (projectId) => {
    const seqAtStart = ++librarySeq;
    set({ loading: true, error: null });
    const { gateway } = get();
    try {
      const [definitions, catalog, credentials] = await Promise.all([
        gateway.listAutomations(projectId),
        gateway.listActions(),
        gateway.listCredentialLabels(),
      ]);
      if (seqAtStart !== librarySeq) return;
      const runResults = await Promise.allSettled(definitions.map((d) => gateway.listRuns(d.id)));
      if (seqAtStart !== librarySeq) return;
      const runs: AutomationRunSummary[] = [];
      let runsError: string | null = null;
      for (const result of runResults) {
        if (result.status === 'fulfilled') runs.push(...result.value);
        else runsError = result.reason instanceof Error ? result.reason.message : 'Failed to load run history';
      }
      runs.sort((a, b) => b.startedAt - a.startedAt);
      set({ definitions, catalog, credentials, runs, loading: false, error: runsError });
    } catch (err) {
      if (seqAtStart !== librarySeq) return;
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load automations' });
    }
  },

  patchDefinition: (definition) =>
    set((s) => ({
      definitions: s.definitions.some((d) => d.id === definition.id)
        ? s.definitions.map((d) => (d.id === definition.id ? definition : d))
        : [...s.definitions, definition],
    })),

  removeDefinition: (id) => set((s) => ({ definitions: s.definitions.filter((d) => d.id !== id) })),

  patchRun: (run) =>
    set((s) => {
      const existing = s.runs.find((r) => r.id === run.id);
      // A fast run's WS terminal event can land before the 202 startRun response
      // resolves; the stale `running` snapshot must not clobber it — nothing
      // later would ever un-stick the view.
      if (existing && isTerminalRunStatus(existing.status) && !isTerminalRunStatus(run.status)) return s;
      return {
        runs: existing ? s.runs.map((r) => (r.id === run.id ? run : r)) : [run, ...s.runs],
        runRevisions: { ...s.runRevisions, [run.id]: (s.runRevisions[run.id] ?? 0) + 1 },
      };
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
