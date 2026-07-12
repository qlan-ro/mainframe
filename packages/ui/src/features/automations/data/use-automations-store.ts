/**
 * Automations v2 data store — definitions/runs/interactions/catalog/
 * credentials, all fetched through an injected `AutomationsGateway`. Defaults
 * to the in-memory fixture gateway so every phase through Phase 5 works with
 * no live daemon routes; `setGateway` is how Phase 6 swaps in the real
 * `http-gateway.ts` at the entry-point boundary, mirroring
 * `use-workflows-store.ts`'s `loadAll` stale-response guard.
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

let loadSeq = 0;

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
  loadAll: () => Promise<void>;
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
  definitions: [],
  runs: [],
  runRevisions: {},
  interactions: [],
  catalog: [],
  credentials: [],
  loading: false,
  error: null,

  setGateway: (gateway) => set({ gateway }),

  loadAll: async () => {
    const seqAtStart = ++loadSeq;
    set({ loading: true, error: null });
    const { gateway } = get();
    try {
      const [definitions, interactions, catalog, credentials] = await Promise.all([
        gateway.listAutomations(),
        gateway.listInteractions(),
        gateway.listActions(),
        gateway.listCredentialLabels(),
      ]);
      if (seqAtStart !== loadSeq) return;
      const runResults = await Promise.allSettled(definitions.map((d) => gateway.listRuns(d.id)));
      if (seqAtStart !== loadSeq) return;
      const runs: AutomationRunSummary[] = [];
      let runsError: string | null = null;
      for (const result of runResults) {
        if (result.status === 'fulfilled') runs.push(...result.value);
        else runsError = result.reason instanceof Error ? result.reason.message : 'Failed to load run history';
      }
      runs.sort((a, b) => b.startedAt - a.startedAt);
      set({ definitions, interactions, catalog, credentials, runs, loading: false, error: runsError });
    } catch (err) {
      if (seqAtStart !== loadSeq) return;
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
