/**
 * Automations v2 navigation store — which body `AutomationsView` renders
 * (editor | describe | details), mirroring `use-workflows-modal.ts`'s shape.
 *
 * Automations is a rail view now (D1/D5), not a dialog: `openHost` shows the
 * body by setting `sidebarView` ('automations') in `ui-prefs` — the shared
 * chrome store, so this is not a reach-through into another feature's store,
 * same allowance `use-session-tab-handlers.ts` takes for Chats.
 *
 * 2026-10 redesign: there is no body-wide library any more — the sidebar list
 * is the only "browse automations" surface, and a selected automation's runs
 * live in a second-level column next to it rather than a Runs/Overview tab
 * switch. `detailsAutomationId` + `selectedRunId` together are that column's
 * state: `selectedRunId` is the chosen run, or `null` for "Overview". Opening
 * a NEW automation (`openDetails`/`openEditor`/`openDescribe`) always clears
 * the other two, but `openEditor`/`openDescribe` deliberately leave
 * `detailsAutomationId` alone — editing or describing on top of an open
 * details view remembers it, so closing the editor/describe flow (`closeEditor`/
 * `closeDescribe`) falls straight back to it. A brand-new editor/describe
 * flow (reached from the empty state, where no automation is open) finds
 * `detailsAutomationId` already null, so the same "fall back" behavior lands
 * on the empty state instead — no special-casing needed.
 */
import { create } from 'zustand';
import { useUiPrefs } from '@/store/ui-prefs';
import type { AutomationCreateInput } from '../contract';

/**
 * `draft` lets Describe-it's "Open in editor" hand its canned draft straight
 * to `AutomationEditor`'s initial state — the only way a `new`-mode editor
 * target can start pre-filled instead of empty.
 */
export type AutomationsEditorTarget =
  { mode: 'new'; draft?: AutomationCreateInput } | { mode: 'edit'; automationId: string };

interface AutomationsNavState {
  editorTarget: AutomationsEditorTarget | null;
  describeOpen: boolean;
  detailsAutomationId: string | null;
  /** The runs column's selection for the open automation; `null` means "Overview". Meaningless while `detailsAutomationId` is null. */
  selectedRunId: string | null;
  openHost: () => void;
  openEditor: (target: AutomationsEditorTarget) => void;
  closeEditor: () => void;
  openDescribe: () => void;
  closeDescribe: () => void;
  /** Opens an automation's details. `runId` pins the column's initial selection — a toast's "View run" — omitted, the column defaults to the automation's most recent run itself. */
  openDetails: (automationId: string, runId?: string) => void;
  closeDetails: () => void;
  /** Changes the runs-column selection without leaving details: a run row click, Overview, or a fresh run replacing the one just viewed. */
  selectRun: (runId: string | null) => void;
}

export const useAutomationsNav = create<AutomationsNavState>((set) => ({
  editorTarget: null,
  describeOpen: false,
  detailsAutomationId: null,
  selectedRunId: null,
  openHost: () => useUiPrefs.getState().setSidebarView('automations'),
  openEditor: (editorTarget) => set({ editorTarget, describeOpen: false }),
  closeEditor: () => set({ editorTarget: null }),
  openDescribe: () => set({ describeOpen: true, editorTarget: null }),
  closeDescribe: () => set({ describeOpen: false }),
  openDetails: (detailsAutomationId, runId) =>
    set({ detailsAutomationId, editorTarget: null, describeOpen: false, selectedRunId: runId ?? null }),
  closeDetails: () => set({ detailsAutomationId: null, selectedRunId: null }),
  selectRun: (selectedRunId) => set({ selectedRunId }),
}));
