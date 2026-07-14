/**
 * Automations v2 navigation store — open/close + which body AutomationsView
 * renders (library | editor | run | describe | details), mirroring
 * `use-workflows-modal.ts`'s shape.
 *
 * `details` (todo #233) is the automation's read-only details view — reached
 * by clicking a library row (`LibraryRow`'s click handler decides whether to
 * route straight to `openRun` instead, when there's exactly one run to show).
 */
import { create } from 'zustand';
import type { AutomationCreateInput } from '../contract';

/**
 * `draft` lets Describe-it's "Open in editor" hand its canned draft straight
 * to `AutomationEditor`'s initial state — the only way a `new`-mode editor
 * target can start pre-filled instead of empty.
 */
export type AutomationsEditorTarget =
  | { mode: 'new'; draft?: AutomationCreateInput }
  | { mode: 'edit'; automationId: string };

interface AutomationsNavState {
  open: boolean;
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
  open: false,
  editorTarget: null,
  runId: null,
  describeOpen: false,
  detailsAutomationId: null,
  openHost: () => set({ open: true }),
  close: () => set({ open: false, editorTarget: null, runId: null, describeOpen: false, detailsAutomationId: null }),
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
