/**
 * The project scope one open of a modal holds.
 *
 * Seeds from {@link seedProjectScope} and stops listening: a sidebar filter or
 * active-session change while the modal is open must not retarget it under the
 * user's cursor. The scope is local state — it is never written back to the
 * sidebar filter, never shared with the other modal, and never persisted, so
 * every open starts from the sidebar again.
 *
 * The seed is computed DURING RENDER (React's documented "adjust state while
 * rendering" bailout — compare `open` to the previous render's value, and call
 * the setters conditionally), not in an effect. An effect fires one commit
 * after `open` flips, so a host reading `projectId` on that first commit would
 * see the previous open's value (or none) — enough to fire an unscoped fetch or
 * paint the wrong surface for a frame before the effect catches up. Seeding
 * during render resolves it before anything downstream ever sees the gap.
 *
 * The project list can still be behind at that instant (a fetch in flight),
 * so a follow-up effect reseeds once against a fresher list. It replays the
 * filter/session values CAPTURED at the rising edge, not the live ones —
 * reading live values would let a background filter change that lands inside
 * the fetch window leak into an open modal. A local pick from the modal's own
 * picker latches out that follow-up entirely: a list that resolves after the
 * user has already chosen must not override the choice.
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

interface SeedRecord {
  filterProjectId: string | null;
  sessionProjectId: string | null;
  /** The project list this record's `projectId` was last checked against. */
  against: readonly { id: string }[];
}

export function useModalProjectScope(open: boolean): ModalProjectScope {
  const filterProjectId = useSessionFilters((s) => s.filterProjectId);
  const sessionProjectId = useActiveIdentity().projectId ?? null;
  const { projects } = useProjects();

  const [projectId, setProjectId] = useState<string | null>(null);
  // `false` even when the first render is already open: a mount in the open
  // state is a rising edge, and several hosts render their modal that way.
  const [prevOpen, setPrevOpen] = useState(false);
  // `null` while closed or not yet seeded this open; set at the rising edge.
  const seedRecord = useRef<SeedRecord | null>(null);
  // Latched by a local pick (see file doc) — cleared on every open transition.
  const userPicked = useRef(false);

  if (open !== prevOpen) {
    setPrevOpen(open);
    userPicked.current = false;
    if (open) {
      setProjectId(seedProjectScope({ filterProjectId, sessionProjectId, projects }));
      seedRecord.current = { filterProjectId, sessionProjectId, against: projects };
    } else {
      setProjectId(null);
      seedRecord.current = null;
    }
  }

  // One follow-up reseed per open, once the list moves past what the rising
  // edge above saw — not on every unrelated change (the deps list only
  // includes `projects`; filter/session changes replay the captured record).
  useEffect(() => {
    const record = seedRecord.current;
    if (userPicked.current || record === null || projects === record.against) return;
    seedRecord.current = { ...record, against: projects };
    setProjectId(
      seedProjectScope({
        filterProjectId: record.filterProjectId,
        sessionProjectId: record.sessionProjectId,
        projects,
      }),
    );
  }, [projects]);

  return {
    projectId,
    setProjectId: (id) => {
      userPicked.current = true;
      setProjectId(id);
    },
  };
}
