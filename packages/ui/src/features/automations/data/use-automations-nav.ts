/**
 * Automations v2 navigation store — open/close + which body AutomationsView
 * renders (library | editor | run | describe), mirroring
 * `use-workflows-modal.ts`'s shape.
 */
import { create } from 'zustand';

export type AutomationsEditorTarget = { mode: 'new' } | { mode: 'edit'; automationId: string };

interface AutomationsNavState {
  open: boolean;
  editorTarget: AutomationsEditorTarget | null;
  runId: string | null;
  openHost: () => void;
  close: () => void;
  openEditor: (target: AutomationsEditorTarget) => void;
  closeEditor: () => void;
  openRun: (runId: string) => void;
  closeRun: () => void;
}

export const useAutomationsNav = create<AutomationsNavState>((set) => ({
  open: false,
  editorTarget: null,
  runId: null,
  openHost: () => set({ open: true }),
  close: () => set({ open: false, editorTarget: null, runId: null }),
  openEditor: (editorTarget) => set({ editorTarget, runId: null }),
  closeEditor: () => set({ editorTarget: null }),
  openRun: (runId) => set({ runId, editorTarget: null }),
  closeRun: () => set({ runId: null }),
}));
