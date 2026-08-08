/**
 * ToastDetailsHost — the dialog behind every toast's Details button, mounted
 * once at the app root. Shows the raise's title/description plus the raw
 * payload (stack, stderr, response body …) in a copyable monospace block, so
 * an abstract toast ("Agent Error") always has a way to the specifics.
 */
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToastDetails } from '@/store/toast-details';

export function ToastDetailsHost() {
  const payload = useToastDetails((s) => s.payload);
  const dismiss = useToastDetails((s) => s.dismiss);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (payload == null) return;
    navigator.clipboard
      .writeText(payload.details)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* expected: clipboard can be unavailable in restricted webviews */
      });
  };

  // Never early-return null while open (Radix body pointer-events wedge);
  // render closed and let onOpenChange clear the payload.
  return (
    <Dialog
      open={payload != null}
      onOpenChange={(o) => {
        if (!o) dismiss();
      }}
    >
      <DialogContent data-testid="toast-details-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="min-w-0 truncate">{payload?.title ?? ''}</DialogTitle>
          {payload?.description ? (
            <DialogDescription>{payload.description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Full details for the notification.</DialogDescription>
          )}
        </DialogHeader>
        <pre
          data-testid="toast-details-body"
          className="max-h-[50vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground select-text"
        >
          {payload?.details ?? ''}
        </pre>
        <DialogFooter>
          <Button data-testid="toast-details-copy" variant="outline" onClick={copy}>
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button data-testid="toast-details-close" onClick={dismiss}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
