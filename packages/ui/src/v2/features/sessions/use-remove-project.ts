/**
 * Removing a project from the switcher.
 *
 * The list is pruned locally rather than refetched: the daemon has already
 * accepted the delete, and a refetch would flash the row back while it lands.
 * A filter pointing at the removed project is cleared, or the sessions list
 * would show nothing with no way back.
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import type { Project } from '@qlan-ro/mainframe-types';
import { removeProject } from '@/lib/api/projects';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useSessionFilters } from '@/store/session-filters';

const CONFIRM_BODY =
  'This will stop all its sessions and remove the project from the database. Files on disk are NOT affected.\n\nThis cannot be undone.';

export function useRemoveProject(removeProjectFromList: (projectId: string) => void): (project: Project) => void {
  const port = useDaemonPort();
  const { filterProjectId, setFilterProjectId } = useSessionFilters();

  return useCallback(
    (project: Project) => {
      if (!window.confirm(`Remove project "${project.name}"?\n\n${CONFIRM_BODY}`)) return;

      void removeProject(port, project.id)
        .then(() => {
          removeProjectFromList(project.id);
          if (filterProjectId === project.id) setFilterProjectId(null);
          toast.success('Project removed', { description: project.name });
        })
        .catch((error: unknown) => {
          console.warn('[v2/sessions] remove project failed', error);
          toast.error('Failed to remove project', {
            description: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [filterProjectId, port, removeProjectFromList, setFilterProjectId],
  );
}
