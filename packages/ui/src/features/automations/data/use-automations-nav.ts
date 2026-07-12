/**
 * Automations v2 navigation store — open/close + which body AutomationsView
 * renders (library | editor | run | describe), mirroring
 * `use-workflows-modal.ts`'s shape.
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
  openHost: () => void;
  close: () => void;
  openEditor: (target: AutomationsEditorTarget) => void;
  closeEditor: () => void;
  openRun: (runId: string) => void;
  closeRun: () => void;
  openDescribe: () => void;
  closeDescribe: () => void;
}

export const useAutomationsNav = create<AutomationsNavState>((set) => ({
  open: false,
  editorTarget: null,
  runId: null,
  describeOpen: false,
  openHost: () => set({ open: true }),
  close: () => set({ open: false, editorTarget: null, runId: null, describeOpen: false }),
  openEditor: (editorTarget) => set({ editorTarget, runId: null, describeOpen: false }),
  closeEditor: () => set({ editorTarget: null }),
  openRun: (runId) => set({ runId, editorTarget: null, describeOpen: false }),
  closeRun: () => set({ runId: null }),
  openDescribe: () => set({ describeOpen: true, editorTarget: null, runId: null }),
  closeDescribe: () => set({ describeOpen: false }),
}));
