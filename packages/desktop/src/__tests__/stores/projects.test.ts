import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Project } from '@mainframe/types';
import { useProjectsStore } from '../../renderer/store/projects.js';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    path: '/tmp/test-project',
    createdAt: '2026-01-01T00:00:00Z',
    lastOpenedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function resetStore(): void {
  useProjectsStore.setState({
    projects: [],
    activeProjectId: null,
    loading: false,
    error: null,
  });
}

describe('useProjectsStore', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('starts with empty projects array', () => {
      expect(useProjectsStore.getState().projects).toEqual([]);
    });

    it('starts with null activeProjectId', () => {
      expect(useProjectsStore.getState().activeProjectId).toBeNull();
    });

    it('starts with loading false', () => {
      expect(useProjectsStore.getState().loading).toBe(false);
    });

    it('starts with null error', () => {
      expect(useProjectsStore.getState().error).toBeNull();
    });
  });

  describe('setProjects', () => {
    it('sets the projects array', () => {
      const projects = [makeProject({ id: 'a' }), makeProject({ id: 'b' })];
      useProjectsStore.getState().setProjects(projects);
      expect(useProjectsStore.getState().projects).toEqual(projects);
    });

    it('replaces existing projects', () => {
      useProjectsStore.getState().setProjects([makeProject({ id: 'old' })]);
      const newProjects = [makeProject({ id: 'new' })];
      useProjectsStore.getState().setProjects(newProjects);
      expect(useProjectsStore.getState().projects).toHaveLength(1);
      expect(useProjectsStore.getState().projects[0]!.id).toBe('new');
    });
  });

  describe('setActiveProject', () => {
    it('sets the activeProjectId', () => {
      useProjectsStore.getState().setActiveProject('proj-1');
      expect(useProjectsStore.getState().activeProjectId).toBe('proj-1');
    });

    it('persists activeProjectId to localStorage', () => {
      useProjectsStore.getState().setActiveProject('proj-1');
      expect(localStorage.getItem('mf:activeProjectId')).toBe('proj-1');
    });

    it('removes localStorage entry when set to null', () => {
      useProjectsStore.getState().setActiveProject('proj-1');
      useProjectsStore.getState().setActiveProject(null);
      expect(localStorage.getItem('mf:activeProjectId')).toBeNull();
      expect(useProjectsStore.getState().activeProjectId).toBeNull();
    });
  });

  describe('addProject', () => {
    it('appends a project to the list', () => {
      const projA = makeProject({ id: 'a' });
      const projB = makeProject({ id: 'b' });
      useProjectsStore.getState().addProject(projA);
      useProjectsStore.getState().addProject(projB);
      const ids = useProjectsStore.getState().projects.map((p: Project) => p.id);
      expect(ids).toEqual(['a', 'b']);
    });
  });

  describe('removeProject', () => {
    it('removes a project by id', () => {
      useProjectsStore.getState().setProjects([makeProject({ id: 'a' }), makeProject({ id: 'b' })]);
      useProjectsStore.getState().removeProject('a');
      const ids = useProjectsStore.getState().projects.map((p: Project) => p.id);
      expect(ids).toEqual(['b']);
    });

    it('clears activeProjectId when active project is removed', () => {
      useProjectsStore.getState().setProjects([makeProject({ id: 'a' })]);
      useProjectsStore.getState().setActiveProject('a');
      useProjectsStore.getState().removeProject('a');
      expect(useProjectsStore.getState().activeProjectId).toBeNull();
    });

    it('preserves activeProjectId when a different project is removed', () => {
      useProjectsStore.getState().setProjects([makeProject({ id: 'a' }), makeProject({ id: 'b' })]);
      useProjectsStore.getState().setActiveProject('a');
      useProjectsStore.getState().removeProject('b');
      expect(useProjectsStore.getState().activeProjectId).toBe('a');
    });
  });

  describe('setLoading', () => {
    it('sets loading to true', () => {
      useProjectsStore.getState().setLoading(true);
      expect(useProjectsStore.getState().loading).toBe(true);
    });

    it('sets loading to false', () => {
      useProjectsStore.getState().setLoading(true);
      useProjectsStore.getState().setLoading(false);
      expect(useProjectsStore.getState().loading).toBe(false);
    });
  });

  describe('setError', () => {
    it('sets an error message', () => {
      useProjectsStore.getState().setError('Something went wrong');
      expect(useProjectsStore.getState().error).toBe('Something went wrong');
    });

    it('clears the error with null', () => {
      useProjectsStore.getState().setError('err');
      useProjectsStore.getState().setError(null);
      expect(useProjectsStore.getState().error).toBeNull();
    });
  });
});
