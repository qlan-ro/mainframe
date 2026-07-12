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

interface AutomationsState {
  gateway: AutomationsGateway;
  definitions: AutomationSummary[];
  runs: AutomationRunSummary[];
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
      const runLists = await Promise.all(
        definitions.map((d) => gateway.listRuns(d.id).catch(() => [] as AutomationRunSummary[])),
      );
      if (seqAtStart !== loadSeq) return;
      const runs = runLists.flat().sort((a, b) => b.startedAt - a.startedAt);
      set({ definitions, interactions, catalog, credentials, runs, loading: false });
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
    set((s) => ({
      runs: s.runs.some((r) => r.id === run.id) ? s.runs.map((r) => (r.id === run.id ? run : r)) : [run, ...s.runs],
    })),

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
