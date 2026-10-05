/**
 * Automations v2 navigation store — which body `AutomationsView` renders
 * (library | editor | run | describe | details), mirroring
 * `use-workflows-modal.ts`'s shape.
 *
 * Automations is a rail view now (D1/D5), not a dialog: `openHost` shows the
 * body by setting `sidebarView` ('automations') in `ui-prefs` — the shared
 * chrome store, so this is not a reach-through into another feature's
 * store, same allowance `use-session-tab-handlers.ts` takes for Chats.
 * `close` does NOT leave the Automations view; it goes back to the bare
 * library by clearing every sub-view, for the view's own back button and the
 * sidebar's "Open the library".
 *
 * `details` (todo #233) is the automation's read-only details view — reached
 * by clicking a library row (`LibraryRow`'s click handler decides whether to
 * route straight to `openRun` instead, when there's exactly one run to show).
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
  runId: string | null;
  describeOpen: boolean;
  detailsAutomationId: string | null;
  openHost: () => void;
  close: () => void;
  openEditor: (target: AutomationsEditorTarget) => void;
  closeEditor: () => void;
  openRun: (runId: string) => void;
  closeRun: () => void;
  openDescribe: () => void;
  closeDescribe: () => void;
  openDetails: (automationId: string) => void;
  closeDetails: () => void;
}

export const useAutomationsNav = create<AutomationsNavState>((set) => ({
  editorTarget: null,
  runId: null,
  describeOpen: false,
  detailsAutomationId: null,
  openHost: () => useUiPrefs.getState().setSidebarView('automations'),
  close: () => set({ editorTarget: null, runId: null, describeOpen: false, detailsAutomationId: null }),
  openEditor: (editorTarget) => set({ editorTarget, runId: null, describeOpen: false, detailsAutomationId: null }),
  closeEditor: () => set({ editorTarget: null }),
  openRun: (runId) => set({ runId, editorTarget: null, describeOpen: false, detailsAutomationId: null }),
  closeRun: () => set({ runId: null }),
  openDescribe: () => set({ describeOpen: true, editorTarget: null, runId: null, detailsAutomationId: null }),
  closeDescribe: () => set({ describeOpen: false }),
  openDetails: (detailsAutomationId) =>
    set({ detailsAutomationId, editorTarget: null, runId: null, describeOpen: false }),
  closeDetails: () => set({ detailsAutomationId: null }),
}));
