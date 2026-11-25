'use client';

/** The session's uncommitted changes at the end of the bottom strip (K8). Hidden when there are none. */
import { useState } from 'react';
import { Diff, FileText } from 'lucide-react';
import { MENU_DETAIL, MENU_ITEM, MENU_LABEL, MENU_SEPARATOR } from '@/components/ui/menu-item';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { toChangesSummary, useWorkingChanges } from '@/features/review/use-working-changes';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { ComposerHint } from '../composer-card-context';
import { BOTTOM_STRIP_BUTTON } from './BottomStrip';

const SHOWN_FILES = 8;

function Count({ additions, deletions, className }: { additions?: number; deletions?: number; className?: string }) {
  return (
    <span className={cn('flex shrink-0 gap-1.5 font-medium tabular-nums', className)}>
      {additions != null && <span className="text-success">+{additions}</span>}
      {deletions != null && <span className="text-red">−{deletions}</span>}
    </span>
  );
}

export function ChangesButton({ port, projectId, chatId }: { port: number; projectId: string; chatId: string }) {
  const [open, setOpen] = useState(false);
  const changes = useWorkingChanges({ port, projectId, chatId, withBranch: false });
  const summary = toChangesSummary(changes);
  // Loading and error both mean "unknown": the part waits rather than guessing.
  if (changes.loading || changes.error || summary.fileCount === 0) return null;

  const suffix = summary.fileCount === 1 ? '' : 's';
  const files = `${summary.fileCount} changed file${suffix}`;
  const totals = [
    summary.additions == null ? null : `+${summary.additions}`,
    summary.deletions == null ? null : `−${summary.deletions}`,
  ]
    .filter((count) => count != null)
    .join(' ');
  const rest = changes.files.length - SHOWN_FILES;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ComposerHint label={files}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="composer-changes"
            aria-label={`Changes: ${files}`}
            className={cn(BOTTOM_STRIP_BUTTON, 'ml-auto shrink-0', open && 'bg-chrome-press hover:bg-chrome-press')}
          >
            {summary.additions == null && summary.deletions == null ? files : <Count {...summary} />}
          </button>
        </PopoverTrigger>
      </ComposerHint>
      <PopoverContent
        data-testid="composer-changes-popover"
        align="start"
        side="top"
        sideOffset={6}
        className="w-85 gap-0 p-1"
      >
        <span className={MENU_LABEL}>
          Changes · {summary.fileCount} file{suffix}
        </span>
        <div className="flex max-h-60 flex-col overflow-y-auto">
          {changes.files.slice(0, SHOWN_FILES).map((file) => (
            <div key={file.path} className="flex min-h-7 min-w-0 items-center gap-2.5 px-2.5 py-[7px]">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-small/[20px]" dir="rtl" title={file.path}>
                <bdi>{file.path}</bdi>
              </span>
              <Count
                additions={file.additions}
                deletions={file.deletions}
                className="gap-2 font-mono text-meta/[1.45] font-normal"
              />
            </div>
          ))}
          {rest > 0 && <span className="px-2.5 py-1 text-meta/[1.45] text-muted-foreground">and {rest} more</span>}
        </div>
        <div className={MENU_SEPARATOR} />
        <button
          type="button"
          data-testid="composer-changes-open-diff"
          className={MENU_ITEM}
          onClick={() => {
            setOpen(false);
            emitSurfaceIntent({ type: 'open-review' });
          }}
        >
          <Diff aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span>Open diff</span>
            {totals && (
              <span className={MENU_DETAIL}>
                {totals} across {summary.fileCount} file{suffix}
              </span>
            )}
          </span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
