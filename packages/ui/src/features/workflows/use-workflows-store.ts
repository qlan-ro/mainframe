import { create } from 'zustand';
import type {
  WorkflowSummary,
  WorkflowRunSummary,
  WorkflowStepSummary,
  WorkflowInteractionSummary,
} from '@qlan-ro/mainframe-types';
import * as wfApi from '@/lib/api/workflows';
import type { RunDetail } from '@/lib/api/workflows';

let loadSeq = 0; // stale-response guard for loadAll
let runSeq = 0; // stale-response guard for selectRun

interface WorkflowsState {
  workflows: WorkflowSummary[];
  runs: WorkflowRunSummary[];
  runDetail: RunDetail | null;
  interactions: WorkflowInteractionSummary[];
  loading: boolean;
  error: string | null;
  loadAll: (port: number) => Promise<void>;
  selectRun: (port: number, runId: string) => Promise<void>;
  clearRun: () => void;
  patchRun: (run: WorkflowRunSummary) => void;
  patchStep: (runId: string, step: Pick<WorkflowStepSummary, 'stepPath' | 'stepId' | 'status' | 'attempt'>) => void;
  addInteraction: (i: WorkflowInteractionSummary) => void;
  resolveInteraction: (interactionId: string) => void;
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  workflows: [],
  runs: [],
  runDetail: null,
  interactions: [],
  loading: false,
  error: null,

  loadAll: async (port) => {
    const seq = ++loadSeq;
    set({ loading: true, error: null });
    try {
      const [workflows, interactions] = await Promise.all([wfApi.listWorkflows(port), wfApi.listInteractions(port)]);
      // Aggregate runs across all workflows (most recent first).
      const runLists = await Promise.all(
        workflows.map((w) => wfApi.listRuns(port, w.id).catch(() => [] as WorkflowRunSummary[])),
      );
      if (seq !== loadSeq) return;
      const runs = runLists.flat().sort((a, b) => b.startedAt - a.startedAt);
      set({ workflows, interactions, runs, loading: false });
    } catch (err) {
      if (seq !== loadSeq) return;
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load workflows' });
    }
  },

  selectRun: async (port, runId) => {
    const seq = ++runSeq;
    try {
      const detail = await wfApi.getRun(port, runId);
      if (seq !== runSeq) return;
      // Also upsert into `runs` (via patchRun) — otherwise WfRunsList/WfLibrary
      // only learn about this run's latest status/outputs through the
      // `workflow.run.updated` WS event, which the RunDetail view doesn't
      // depend on; a run finishing while its detail is open would show
      // "succeeded" here but stay stale everywhere else until a manual
      // reopen (re-triggering loadAll) forced a fresh fetch.
      set({ runDetail: detail });
      get().patchRun(detail.run);
    } catch (err) {
      if (seq !== runSeq) return;
      set({ error: err instanceof Error ? err.message : 'Failed to load run' });
    }
  },

  clearRun: () => set({ runDetail: null }),

  patchRun: (run) =>
    set((s) => ({
      runs: s.runs.some((r) => r.id === run.id) ? s.runs.map((r) => (r.id === run.id ? run : r)) : [run, ...s.runs],
      runDetail: s.runDetail && s.runDetail.run.id === run.id ? { ...s.runDetail, run } : s.runDetail,
    })),

  // A step changed: if this run's detail is open, the events hook calls
  // selectRun to refetch the authoritative tree.
  patchStep: (runId) => {
    const d = get().runDetail;
    if (d && d.run.id === runId) {
      /* consumer (use-workflows-events) triggers selectRun refresh */
    }
  },

  addInteraction: (i) =>
    set((s) => (s.interactions.some((x) => x.id === i.id) ? s : { interactions: [i, ...s.interactions] })),

  resolveInteraction: (interactionId) =>
    set((s) => ({ interactions: s.interactions.filter((x) => x.id !== interactionId) })),
}));

export const selectPendingCount = (s: WorkflowsState): number => s.interactions.length;
