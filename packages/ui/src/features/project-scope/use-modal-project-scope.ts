/**
 * The project scope one open of a modal holds.
 *
 * Seeds on the rising edge of `open` from {@link seedProjectScope} and then
 * stops listening: a sidebar filter or active-session change while the modal is
 * open must not retarget it under the user's cursor. The scope is local state —
 * it is never written back to the sidebar filter, never shared with the other
 * modal, and never persisted, so every open starts from the sidebar again.
 */
import { useEffect, useRef, useState } from 'react';
import { useSessionFilters } from '@/store/session-filters';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useProjects } from '@/features/sessions/use-projects';
import { seedProjectScope } from './seed-project-scope';

export interface ModalProjectScope {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
}

export function useModalProjectScope(open: boolean): ModalProjectScope {
  const filterProjectId = useSessionFilters((s) => s.filterProjectId);
  const sessionProjectId = useActiveIdentity().projectId ?? null;
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);

  // `false` even when the first render is already open: a mount in the open
  // state is a rising edge, and several hosts render their modal that way.
  const wasOpen = useRef(false);
  // `useProjects` returns [] while it fetches, so an open that lands in that
  // window seeds against nothing. This latch buys exactly one more attempt.
  const awaitingProjects = useRef(false);

  // The guards, not the dependency list, decide when a seed happens — every
  // value the seed reads is a dependency, and all but a rising edge are ignored.
  useEffect(() => {
    if (!open) {
      if (wasOpen.current || awaitingProjects.current) {
        wasOpen.current = false;
        awaitingProjects.current = false;
        setProjectId(null);
      }
      return;
    }

    const rising = !wasOpen.current;
    const listArrived = awaitingProjects.current && projects.length > 0;
    if (!rising && !listArrived) return;

    wasOpen.current = true;
    awaitingProjects.current = projects.length === 0;
    setProjectId(seedProjectScope({ filterProjectId, sessionProjectId, projects }));
  }, [open, projects, filterProjectId, sessionProjectId]);

  return { projectId, setProjectId };
}
