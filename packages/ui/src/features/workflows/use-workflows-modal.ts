import { create } from 'zustand';
export type WfSection = 'needs' | 'runs' | 'library';
export type WfEditorTarget = { mode: 'new' } | { mode: 'edit'; workflowId: string };
interface State {
  open: boolean;
  section: WfSection;
  selectedRunId: string | null;
  editorTarget: WfEditorTarget | null;
  openModal: (section?: WfSection) => void;
  close: () => void;
  setSection: (s: WfSection) => void;
  openRun: (id: string) => void;
  backToList: () => void;
  openEditor: (t: WfEditorTarget) => void;
  closeEditor: () => void;
}
export const useWorkflowsModal = create<State>((set) => ({
  open: false,
  section: 'needs',
  selectedRunId: null,
  editorTarget: null,
  openModal: (section = 'needs') => set({ open: true, section, selectedRunId: null }),
  close: () => set({ open: false, selectedRunId: null, editorTarget: null }),
  setSection: (section) => set({ section, selectedRunId: null }),
  openRun: (selectedRunId) => set({ selectedRunId }),
  backToList: () => set({ selectedRunId: null }),
  openEditor: (editorTarget) => set({ editorTarget }),
  closeEditor: () => set({ editorTarget: null }),
}));
