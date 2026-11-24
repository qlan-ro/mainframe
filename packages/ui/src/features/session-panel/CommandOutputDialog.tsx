/**
 * CommandOutputDialog — a background command's output, read when it opens and
 * again when the command ends. Its transcript row holds only what the call
 * answered when it started; the output moves into that row with the transcript
 * redesign (T1a), and this goes.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { BackgroundTaskOutput } from '@/lib/api/background-tasks';
import { errorMessage } from '@/lib/error-message';

interface CommandOutputDialogProps {
  title: string;
  command?: string;
  read: () => Promise<BackgroundTaskOutput>;
  /** The command still runs, so what was read isn't its end. */
  running: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Puts focus back; the control that opened it may be gone by then. */
  returnFocus: () => void;
}

type Output = BackgroundTaskOutput | { error: string } | null;

function useOutput(read: () => Promise<BackgroundTaskOutput>, running: boolean): Output {
  const [output, setOutput] = useState<Output>(null);
  useEffect(() => {
    let active = true;
    read().then(
      (next) => active && setOutput(next),
      (error: unknown) => active && setOutput({ error: errorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [read, running]);
  return output;
}

/** Mounted while the dialog is open, so each opening reads afresh. */
function OutputBody({ read, running }: Pick<CommandOutputDialogProps, 'read' | 'running'>) {
  const output = useOutput(read, running);
  if (!output) return <p className="text-muted-foreground">Loading output…</p>;
  if ('error' in output)
    return (
      <p role="alert" className="text-fail">
        {output.error}
      </p>
    );
  if (!output.text) return <p className="text-muted-foreground">No output</p>;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {output.truncated && (
        <p data-testid="session-panel-output-truncated" className="text-xs text-muted-foreground">
          The start is left out. This is the last 1 MB.
        </p>
      )}
      <pre
        data-testid="session-panel-output-text"
        // Scrolls, so it takes the arrow keys.
        tabIndex={0}
        className="max-h-[60vh] overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs wrap-break-word whitespace-pre-wrap focus-visible:focus-line"
      >
        {output.text}
      </pre>
    </div>
  );
}

export function CommandOutputDialog({
  title,
  command,
  read,
  running,
  open,
  onOpenChange,
  returnFocus,
}: CommandOutputDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="session-panel-output-dialog"
        className="gap-4 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-8 wrap-break-word">{title}</DialogTitle>
          <DialogDescription className="text-xs wrap-break-word">
            {command && command !== title ? <code className="font-mono">{command}</code> : 'Background command'}
          </DialogDescription>
        </DialogHeader>
        <OutputBody read={read} running={running} />
      </DialogContent>
    </Dialog>
  );
}
