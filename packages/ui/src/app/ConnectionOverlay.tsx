/**
 * The window-state overlay: boot ("Starting up…"), daemon reconnect, and the
 * host of DaemonUnreachableBody via the children slot.
 *
 * Not a dialog on purpose — it must render before providers exist, is never
 * dismissable, and sits above every Radix layer. Built on v2 tokens with a
 * stock indeterminate Progress; the spinner uses Tailwind's own spin/pulse.
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { Progress } from '@/components/ui/progress';

const DEFAULT_TITLE = 'Reconnecting to daemon…';
const DEFAULT_SUBTITLE = 'Your sessions are safe. Work resumes automatically the moment the connection is back.';

interface ConnectionOverlayProps {
  open: boolean;
  embedded?: boolean;
  /** Overlay heading. Defaults to the reconnect copy. */
  title?: string;
  /** Secondary line under the heading. Defaults to the reconnect copy. */
  subtitle?: string;
  /** Card `data-testid` (so the boot/"starting" variant can keep its own hook). */
  testId?: string;
  /**
   * Optional body override. When provided, renders this node instead of the
   * default spinner card. The scrim container is still applied.
   * Use this slot to inject DaemonUnreachableBody or similar surfaces.
   */
  children?: React.ReactNode;
}

export function ConnectionOverlay({
  open,
  embedded = false,
  title = DEFAULT_TITLE,
  subtitle = DEFAULT_SUBTITLE,
  testId = 'connection-overlay',
  children,
}: ConnectionOverlayProps): React.ReactElement | null {
  // A plain conditional render is safe here — this is not a Radix modal, so
  // there is no pointer-events cleanup to miss.
  if (!open) return null;

  const inner = children != null ? children : <Card title={title} subtitle={subtitle} testId={testId} />;

  const body = (
    <div className="absolute inset-0 z-[11000] flex items-center justify-center bg-background/60 backdrop-blur-[10px] backdrop-saturate-125">
      {inner}
    </div>
  );

  if (embedded) return body;

  return ReactDOM.createPortal(<div className="fixed inset-0 z-[11000]">{body}</div>, document.body);
}

function Card({ title, subtitle, testId }: { title: string; subtitle: string; testId: string }): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex min-w-80 flex-col items-center gap-4 rounded-xl border bg-popover px-9 pt-7 pb-6 shadow-lg"
    >
      <Spinner />
      <div className="text-center">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-1 max-w-64 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <Progress className="h-1 w-48" />
    </div>
  );
}

function Spinner(): React.ReactElement {
  return (
    <div className="relative size-11">
      <div className="absolute inset-0 rounded-full border-2 border-border" />
      <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary border-r-primary" />
      <div className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-primary" />
    </div>
  );
}
