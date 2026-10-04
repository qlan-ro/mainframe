/**
 * The sidebar Tasks list's project when the session scope does not name one
 * (`soleProjectId` is null under "All projects" or a multi-project scope).
 * Local and NOT persisted: it is a convenience pick for this run, and the
 * session scope — which IS persisted — stays the primary source.
 */
import { create } from 'zustand';

interface TasksSidebarScopeState {
  projectId: string | null;
  setProjectId: (projectId: string | null) => void;
}

export const useTasksSidebarScope = create<TasksSidebarScopeState>((set) => ({
  projectId: null,
  setProjectId: (projectId) => set({ projectId }),
}));
