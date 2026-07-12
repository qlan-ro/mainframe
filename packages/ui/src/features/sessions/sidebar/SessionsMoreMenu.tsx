/**
 * SessionsMoreMenu — the ⋯ overflow menu in the Sessions group header.
 *
 * A shadcn DropdownMenu triggered by the MoreHorizontalIcon button (the
 * placeholder `sessions-more-button`). Two items:
 *   - "Import external sessions" (Download icon) — disabled when no projects
 *   - "Archived sessions"        (Archive icon)
 *
 * Each item opens its respective shadcn Dialog (controlled open state). The
 * two dialogs are rendered as siblings of the DropdownMenu so they remain
 * mounted in the portal even after the DropdownMenu closes (Radix best
 * practice — avoids animation teardown races).
 *
 * Data sourced from useDaemonPort, useProjects, and useSessionFilters — no
 * prop-drilling from SessionSidebar needed.
 */
import { useState } from 'react';
import { MoreHorizontalIcon, DownloadIcon, ArchiveIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { useProjects } from '../use-projects';
import { useSessionFilters } from '@/store/session-filters';
import { ImportSessionsDialog } from './ImportSessionsDialog';
import { Hint } from '@/components/ui/hint';
import { ArchivedSessionsDialog } from './ArchivedSessionsDialog';

const ICON_BTN =
  'inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground';

export function SessionsMoreMenu() {
  const port = useDaemonPort();
  const { projects } = useProjects();
  const { filterProjectId } = useSessionFilters();

  const [importOpen, setImportOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const noProjects = projects.length === 0;

  return (
    <>
      <DropdownMenu>
        <Hint label="More">
          <DropdownMenuTrigger asChild>
            <button data-testid="sessions-more-button" type="button" className={ICON_BTN}>
              <MoreHorizontalIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
        </Hint>

        {/* Order matches the 02-chrome prototype moreOpen panel: Archived, then Import. */}
        <DropdownMenuContent align="end" sideOffset={6} className="w-52">
          <DropdownMenuItem data-testid="sessions-more-archived" onSelect={() => setArchivedOpen(true)}>
            <ArchiveIcon className="mr-2 size-3.5 text-muted-foreground" />
            Archived sessions
          </DropdownMenuItem>

          <DropdownMenuItem
            data-testid="sessions-more-import"
            disabled={noProjects}
            onSelect={() => setImportOpen(true)}
          >
            <DownloadIcon className="mr-2 size-3.5 text-muted-foreground" />
            Import external sessions
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ImportSessionsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        port={port}
        projects={projects}
        filterProjectId={filterProjectId}
      />

      <ArchivedSessionsDialog
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        port={port}
        projects={projects}
        filterProjectId={filterProjectId}
      />
    </>
  );
}
