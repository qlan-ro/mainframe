/**
 * useAddProject — the add-project orchestration: pick a directory, register it
 * with the daemon, then refetch the project list and toast the outcome.
 *
 * `reloadProjects` is injected rather than pulled from a fresh `useProjects()`
 * call, for testability — `useProjects` now reads the shared `store/projects.ts`
 * store, so any caller's `reloadProjects()` updates every mounted consumer.
 * Per decision, the active filter is left untouched on add.
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
    const path = await pickDirectory({ mode: 'directory' });
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
