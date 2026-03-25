import { create } from 'zustand';
import type { Project } from '@qlan-ro/mainframe-types';

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;

  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  loading: false,
  error: null,

  setProjects: (projects) => set({ projects }),
  addProject: (project) =>
    set((state) => {
      if (state.projects.some((p) => p.id === project.id)) return state;
      return { projects: [...state.projects, project] };
    }),
  removeProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
