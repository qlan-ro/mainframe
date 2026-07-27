/**
 * use-setup-advisor-store — data store for the Setup Advisor sheet.
 *
 * Holds the fetched report (keyed to the project it was fetched for) and the
 * copied-command ledger. Two things outlive a project switch or a report
 * refetch by design (spec Decisions 15/21):
 *   - `copiedByProject` is per-app-session, not per-report — a stale report
 *     never clears copy history for a project the user switched away from.
 *   - `selectCopiedCount` is the intersection of the current project's copied
 *     ids with the *current* report's recommendation ids, never a raw count,
 *     so a copied id from a since-changed report can't overcount the footer.
 *
 * Stale-completion guard: a module-level counter (`_loadSeq`), the
 * `features/tasks/use-todos-store.ts` idiom — lives outside React/zustand so
 * it survives across renders, and outside the store so `set()` calls can't
 * accidentally reset it.
 */
import { create } from 'zustand';
import type { SetupAdvisorReport } from '@qlan-ro/mainframe-types';
import { getAutomationRecommendations } from '@/lib/api/setup-advisor';

let _loadSeq = 0;

interface SetupAdvisorState {
  report: SetupAdvisorReport | null;
  reportProjectId: string | null;
  loading: boolean;
  error: string | null;
  copiedByProject: Record<string, Set<string>>;
  load: (projectId: string) => Promise<void>;
  clearForProjectSwitch: () => void;
  markCopied: (projectId: string, recId: string) => void;
}

export const useSetupAdvisorStore = create<SetupAdvisorState>((set) => ({
  report: null,
  reportProjectId: null,
  loading: false,
  error: null,
  copiedByProject: {},

  load: async (projectId) => {
    const seq = ++_loadSeq;
    set({ loading: true, error: null });
    try {
      const report = await getAutomationRecommendations(projectId);
      if (seq !== _loadSeq) return;
      set({ report, reportProjectId: projectId, loading: false, error: null });
    } catch (err) {
      if (seq !== _loadSeq) return;
      set({ loading: false, error: err instanceof Error ? err.message : 'Could not analyze this project' });
    }
  },

  clearForProjectSwitch: () => set({ report: null, reportProjectId: null }),

  markCopied: (projectId, recId) =>
    set((state) => {
      const existing = state.copiedByProject[projectId] ?? new Set<string>();
      const next = new Set(existing);
      next.add(recId);
      return { copiedByProject: { ...state.copiedByProject, [projectId]: next } };
    }),
}));

export const selectCopiedCount = (state: SetupAdvisorState): number => {
  if (!state.report || !state.reportProjectId) return 0;
  const copied = state.copiedByProject[state.reportProjectId];
  if (!copied || copied.size === 0) return 0;
  const reportIds = new Set(state.report.recommendations.map((r) => r.id));
  let count = 0;
  for (const id of copied) {
    if (reportIds.has(id)) count++;
  }
  return count;
};
