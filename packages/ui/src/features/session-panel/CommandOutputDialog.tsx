/**
 * CommandOutputDialog — a background command's output, read when it opens. Its
 * transcript row holds only what the call answered when it started; the output
 * moves into that row with the transcript redesign (T1a), and this goes.
 */
import { useEffect, useState, type RefObject } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface CommandOutputDialogProps {
  title: string;
  command?: string;
  read: () => Promise<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row it was opened for; the menu item that opened it is gone by then. */
  returnFocus: RefObject<HTMLElement | null>;
}

type Output = { text: string } | { error: string } | null;

function useOutput(open: boolean, read: () => Promise<string>): Output {
  const [output, setOutput] = useState<Output>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setOutput(null);
    read().then(
      (text) => active && setOutput({ text }),
      (error: unknown) => active && setOutput({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      active = false;
    };
  }, [open, read]);
  return output;
}

function OutputBody({ output }: { output: Output }) {
  if (!output) return <p className="text-muted-foreground">Loading output…</p>;
  if ('error' in output)
    return (
      <p role="alert" className="text-fail">
        {output.error}
      </p>
    );
  if (!output.text) return <p className="text-muted-foreground">No output</p>;
  return (
    <pre
      data-testid="session-panel-output-text"
      // Scrolls, so it takes the arrow keys.
      tabIndex={0}
      className="max-h-[60vh] overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs wrap-break-word whitespace-pre-wrap focus-visible:focus-line"
    >
      {output.text}
    </pre>
  );
}

export function CommandOutputDialog({
  title,
  command,
  read,
  open,
  onOpenChange,
  returnFocus,
}: CommandOutputDialogProps) {
  const output = useOutput(open, read);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="session-panel-output-dialog"
        className="gap-4 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-8 wrap-break-word">{title}</DialogTitle>
          <DialogDescription className="text-xs wrap-break-word">
            {command && command !== title ? <code className="font-mono">{command}</code> : 'Background command'}
          </DialogDescription>
        </DialogHeader>
        <OutputBody output={output} />
      </DialogContent>
    </Dialog>
  );
}
