/**
 * useAddProject — the add-project orchestration: pick a directory, register it
 * with the daemon, then refetch the project list and toast the outcome.
 *
 * `reloadProjects` is passed in (not pulled from a local `useProjects()`) so the
 * refetch hits the CALLER's rendered `useProjects` instance — `useProjects` is
 * local `useState` per caller, so a fresh instance here would update nothing the
 * sidebar renders. Per decision, the active filter is left untouched on add.
 */
import { useCallback } from 'react';
import { createProject } from '@/lib/api/projects';
import { mfToast } from '@/lib/toast';
import { useDirectoryPicker } from '@/features/files/use-directory-picker';
import { useDaemonPort } from './runtime/daemon-port-context';

export function useAddProject(reloadProjects: () => Promise<void>): () => Promise<void> {
  const port = useDaemonPort();
  const pickDirectory = useDirectoryPicker((s) => s.pickDirectory);

  return useCallback(async () => {
    const path = await pickDirectory({ mode: 'directory', title: 'Add project' });
    if (path == null) return;

    try {
      const { alreadyExists } = await createProject(port, path);
      await reloadProjects();
      if (alreadyExists) {
        mfToast.info('Project already added', { description: path });
      } else {
        mfToast.success('Project added', { description: path });
      }
    } catch (error) {
      console.warn('[sessions] add project failed', error);
      mfToast.error('Failed to add project', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [pickDirectory, port, reloadProjects]);
}
