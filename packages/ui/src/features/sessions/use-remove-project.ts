/**
 * useRemoveProject — the remove-project orchestration: confirm in-app, ask the
 * daemon to drop the project, then update the list, the filter and the toast.
 *
 * The confirmation goes through the app's confirm bridge rather than a browser
 * dialog: the Tauri webview implements no JavaScript confirm panel, so a native
 * call resolves false without rendering and the removal never happens.
 *
 * `removeProjectFromList` is injected rather than pulled from a fresh
 * `useProjects()` call, for testability — `useProjects` now reads the shared
 * `store/projects.ts` store, so any caller's `removeProjectFromList()` updates
 * every mounted consumer.
 */
import { useCallback } from 'react';
import type { Project } from '@qlan-ro/mainframe-types';
import { removeProject } from '@/lib/api/projects';
import { requestConfirm } from '@/lib/confirm-bridge';
import { mfToast } from '@/lib/toast';
import { useSessionFilters } from '@/store/session-filters';
import { useDaemonPort } from './runtime/daemon-port-context';

export function useRemoveProject(
  removeProjectFromList: (projectId: string) => void,
): (project: Project) => Promise<void> {
  const port = useDaemonPort();
  const { filterProjectId, setFilterProjectId } = useSessionFilters();

  return useCallback(
    async (project: Project) => {
      const confirmed = await requestConfirm({
        title: `Remove "${project.name}"?`,
        body: 'Its sessions stop and the project is removed from Mainframe. Files on disk are not affected. This cannot be undone.',
        confirmLabel: 'Remove',
        destructive: true,
        testid: 'sessions-remove-project-dialog',
      });
      if (!confirmed) return;

      try {
        await removeProject(port, project.id);
        removeProjectFromList(project.id);
        if (filterProjectId === project.id) setFilterProjectId(null);
        mfToast.success('Project removed', { description: project.name });
      } catch (error) {
        console.warn('[sessions] remove project failed', error);
        mfToast.error('Failed to remove project', {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [filterProjectId, port, removeProjectFromList, setFilterProjectId],
  );
}
