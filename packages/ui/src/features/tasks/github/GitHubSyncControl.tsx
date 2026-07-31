/**
 * GitHubSyncControl — the Tasks board header's link/sync control.
 *
 * Unlinked it is an outline button; linked it is a connected pill that IS the
 * sync menu (there is no separate sync button). `CircleDot` is GitHub's own
 * open-issue glyph and the icon for this feature everywhere — lucide ships no
 * GitHub brand mark, and a hand-rolled one is not worth the drift.
 */
import React from 'react';
import { ChevronDown, CircleDot, Download, FileText, RefreshCw, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { syncedAgo } from './sync-format';
import { runOrToast } from './run-or-toast';
import { UnlinkRepoConfirm } from './UnlinkRepoConfirm';
import { useGitHubSyncStore } from './use-github-sync-store';

const ITEM_ICON = 'size-3.5 shrink-0 text-muted-foreground';

function LinkButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <Button
      data-testid="tasks-github-link"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="gap-1.5 border-[0.5px] bg-card font-semibold text-primary"
    >
      <CircleDot size={12} aria-hidden />
      Link GitHub repo
    </Button>
  );
}

export function GitHubSyncControl(): React.ReactElement {
  const { link, running, lastRun, openDialog, sync } = useGitHubSyncStore();
  const [confirmUnlink, setConfirmUnlink] = React.useState(false);

  if (link === null) return <LinkButton onClick={() => openDialog({ kind: 'link' })} />;

  return (
    <>
      <DropdownMenu>
        <Hint label={running ? 'A sync run is in progress' : 'GitHub sync options'}>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="tasks-github-pill"
              type="button"
              className="inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-mf-success/40 bg-mf-success-tint pl-2.5 pr-1.5 transition-colors hover:border-mf-success/60"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-mf-success" aria-hidden />
              <span className="text-caption text-foreground">{`${link.owner}/${link.repo}`}</span>
              <span className="text-caption text-mf-text-3" aria-hidden>
                ·
              </span>
              <span className="text-caption text-mf-text-3">{running ? 'syncing…' : syncedAgo(link.lastSyncedAt)}</span>
              <ChevronDown size={11} className="shrink-0 text-mf-text-3" aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </Hint>

        <DropdownMenuContent align="end" sideOffset={6} className="w-52">
          <DropdownMenuItem
            data-testid="tasks-github-menu-sync"
            disabled={running}
            onSelect={() => void runOrToast('Sync failed', sync)}
          >
            <RefreshCw className={ITEM_ICON} aria-hidden />
            Sync now
          </DropdownMenuItem>

          <DropdownMenuItem data-testid="tasks-github-menu-import" onSelect={() => openDialog({ kind: 'import' })}>
            <Download className={ITEM_ICON} aria-hidden />
            Import issues…
          </DropdownMenuItem>

          <DropdownMenuItem
            data-testid="tasks-github-menu-report"
            disabled={lastRun === null}
            onSelect={() => openDialog({ kind: 'report' })}
          >
            <FileText className={ITEM_ICON} aria-hidden />
            Last sync report
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            data-testid="tasks-github-menu-unlink"
            className="text-destructive [&_svg]:text-destructive"
            onSelect={() => setConfirmUnlink(true)}
          >
            <Unlink className="size-3.5 shrink-0" aria-hidden />
            Unlink repo…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {confirmUnlink && <UnlinkRepoConfirm onDone={() => setConfirmUnlink(false)} />}
    </>
  );
}
