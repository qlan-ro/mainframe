'use client';

/** The session's uncommitted changes at the end of the bottom strip (K8). Hidden when there are none. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { toChangesSummary, useWorkingChanges } from '@/features/review/use-working-changes';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { ComposerHint } from '../composer-card-context';
import { BOTTOM_STRIP_BUTTON } from './BottomStrip';

const SHOWN_FILES = 8;

function Count({ additions, deletions }: { additions?: number; deletions?: number }) {
  return (
    <span className="flex shrink-0 gap-1 font-medium tabular-nums">
      {additions != null && <span className="text-success">+{additions}</span>}
      {deletions != null && <span className="text-destructive">−{deletions}</span>}
    </span>
  );
}

export function ChangesButton({ port, projectId, chatId }: { port: number; projectId: string; chatId: string }) {
  const [open, setOpen] = useState(false);
  const changes = useWorkingChanges({ port, projectId, chatId });
  const summary = toChangesSummary(changes);
  // Loading and error both mean "unknown": the part waits rather than guessing.
  if (changes.loading || changes.error || summary.fileCount === 0) return null;

  const files = `${summary.fileCount} changed file${summary.fileCount === 1 ? '' : 's'}`;
  const rest = changes.files.length - SHOWN_FILES;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ComposerHint label={files}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="composer-changes"
            aria-label={`Changes: ${files}`}
            className={cn(BOTTOM_STRIP_BUTTON, 'ml-auto shrink-0', open && 'bg-accent')}
          >
            {summary.additions == null && summary.deletions == null ? files : <Count {...summary} />}
          </button>
        </PopoverTrigger>
      </ComposerHint>
      <PopoverContent
        data-testid="composer-changes-popover"
        align="end"
        side="top"
        sideOffset={6}
        className="gap-1 p-2"
      >
        <span className="px-2 text-xs text-muted-foreground">{files}</span>
        <div className="flex max-h-60 flex-col overflow-y-auto">
          {changes.files.slice(0, SHOWN_FILES).map((file) => (
            <div key={file.path} className="flex min-h-7 min-w-0 items-center gap-2 px-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono" dir="rtl" title={file.path}>
                <bdi>{file.path}</bdi>
              </span>
              <Count additions={file.additions} deletions={file.deletions} />
            </div>
          ))}
          {rest > 0 && <span className="px-2 py-1 text-xs text-muted-foreground">and {rest} more</span>}
        </div>
        <Button
          variant="outline"
          size="sm"
          data-testid="composer-changes-open-diff"
          onClick={() => {
            setOpen(false);
            emitSurfaceIntent({ type: 'open-review' });
          }}
        >
          Open diff
        </Button>
      </PopoverContent>
    </Popover>
  );
}
