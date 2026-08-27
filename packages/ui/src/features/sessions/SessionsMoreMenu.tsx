/**
 * The session list's overflow menu: the archive, and the import flow.
 *
 * Both dialogs are siblings of the menu, not children of a menu item — a Radix
 * menu unmounts its content on select, which would tear the dialog down in the
 * same frame it opened.
 *
 * Import needs somewhere to import into, so it stays disabled until a project
 * exists; the archive is meaningful either way.
 */
import { useState } from 'react';
import { ArchiveIcon, DownloadIcon, MoreHorizontalIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useProjects } from '@/features/sessions/use-projects';
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import { ArchivedSessionsDialog } from './ArchivedSessionsDialog';
import { ImportSessionsDialog } from './ImportSessionsDialog';

export function SessionsMoreMenu() {
  const port = useDaemonPort();
  const { projects } = useProjects();
  const filterProjectIds = useSessionFilters((s) => s.filterProjectIds);
  const [importOpen, setImportOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        {/* Hint WRAPS the trigger — inside it, TooltipTrigger's asChild would
            swallow the menu's own ref and onClick. */}
        <Hint label="More session actions">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="sessions-more-button"
              aria-label="More session actions"
              className="size-6"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent data-testid="sessions-more-menu" align="end" sideOffset={6} className="w-52">
          <DropdownMenuItem data-testid="sessions-more-archived" onSelect={() => setArchivedOpen(true)}>
            <ArchiveIcon />
            Archived sessions
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="sessions-more-import"
            disabled={projects.length === 0}
            onSelect={() => setImportOpen(true)}
          >
            <DownloadIcon />
            Import external sessions
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ArchivedSessionsDialog
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        port={port}
        projects={projects}
        filterProjectIds={filterProjectIds}
      />
      <ImportSessionsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        port={port}
        projects={projects}
        filterProjectId={soleProjectId(filterProjectIds)}
      />
    </>
  );
}
