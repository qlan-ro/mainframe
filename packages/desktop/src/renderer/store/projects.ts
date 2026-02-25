import { create } from 'zustand';
import type { Project } from '@mainframe/types';

interface ProjectsState {
  projects: Project[];
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;

  setProjects: (projects: Project[]) => void;
  setActiveProject: (id: string | null) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  activeProjectId: null,
  loading: false,
  error: null,

  setProjects: (projects) => set({ projects }),
  setActiveProject: (id) => {
    if (id) localStorage.setItem('mf:activeProjectId', id);
    else localStorage.removeItem('mf:activeProjectId');
    set({ activeProjectId: id });
  },
  addProject: (project) =>
    set((state) => {
      if (state.projects.some((p) => p.id === project.id)) return state;
      return { projects: [...state.projects, project] };
    }),
  removeProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
