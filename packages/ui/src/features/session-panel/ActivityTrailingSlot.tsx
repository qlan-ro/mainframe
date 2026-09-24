/**
 * ActivityTrailingSlot — the row's fixed-width trailing column: elapsed time
 * or a stop control on a running row, a spinner while stopping, a retryable
 * error square on stop failure, or a static duration with a dismiss control
 * on a terminal row (todo #328).
 *
 * Both readings of the slot (time text, icon control) are stacked in the same
 * box so swapping between them on hover/focus never changes the row's width —
 * the icon layer sits on top with `opacity-0 pointer-events-none` until the
 * row is hovered or a descendant has focus (`group-hover`/`group-focus-within`
 * on the row's own `group` class), and stays reachable by keyboard the whole
 * time since `pointer-events-none` only blocks the mouse, not Tab/Enter.
 */
import { LoaderCircle, Square, X } from 'lucide-react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { formatRunDuration } from '@/features/chat/workflow/workflow-progress';
import type { ActivityRowState } from './activity-kinds';
import { formatElapsed } from './background-activity-view';

const SLOT = 'relative flex h-5 w-11 shrink-0 items-center justify-end';
// Unconditionally `pointer-events-none`: this reading is decorative text, never
// a control, and it visually overlaps the button it swaps for on hover/focus.
// A real Chromium click (not just jsdom) enforces hit-testing that a
// hover-only `group-hover:pointer-events-none` couldn't reliably beat — the
// button's own hover transition and this span's fade aren't guaranteed to
// land in the same frame, so the plain always-off rule is what actually holds.
const READING =
  'pointer-events-none font-mono text-xs tabular-nums text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0';
const OVERLAY_BUTTON =
  'absolute inset-y-0 right-0 flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 pointer-events-none transition-opacity hover:bg-foreground/8 hover:text-foreground group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto';

export interface ActivityTrailingSlotProps {
  task: BackgroundActivityTask;
  now: number;
  state: ActivityRowState;
  stopMessage: string | undefined;
  stopSupported: boolean;
  unsupportedReason: string | undefined;
  onStop: () => void;
  onDismiss: () => void;
}

export function ActivityTrailingSlot({
  task,
  now,
  state,
  stopMessage,
  stopSupported,
  unsupportedReason,
  onStop,
  onDismiss,
}: ActivityTrailingSlotProps) {
  if (state === 'stopping') {
    return (
      <span className={SLOT}>
        <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
      </span>
    );
  }

  if (state === 'stop-error') {
    const message = stopMessage ?? 'Stop failed.';
    return (
      <span className={SLOT}>
        <Hint label={message}>
          <button
            type="button"
            data-testid={`activity-stop-error-${task.id}`}
            aria-label={message}
            onClick={(event) => {
              event.stopPropagation();
              onStop();
            }}
            className="flex size-5 items-center justify-center rounded-sm bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25"
          >
            <Square className="size-3" fill="currentColor" aria-hidden />
          </button>
        </Hint>
      </span>
    );
  }

  if (state === 'running') {
    const stopButton = (
      <button
        type="button"
        data-testid={`activity-stop-${task.id}`}
        aria-label="Stop task"
        aria-disabled={stopSupported ? undefined : 'true'}
        onClick={(event) => {
          event.stopPropagation();
          if (stopSupported) onStop();
        }}
        className={cn(
          OVERLAY_BUTTON,
          !stopSupported && 'text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground/50',
        )}
      >
        <Square className="size-3" aria-hidden />
      </button>
    );
    return (
      <span className={SLOT}>
        <span className={READING}>{formatElapsed(task.startedAt, now)}</span>
        {stopSupported ? stopButton : <Hint label={unsupportedReason}>{stopButton}</Hint>}
      </span>
    );
  }

  // Terminal — a static total duration, with a dismiss control on hover/focus.
  const duration = task.endedAt !== undefined ? formatRunDuration(task.endedAt - task.startedAt) : '';
  return (
    <span className={SLOT}>
      <span className={READING}>{duration}</span>
      <button
        type="button"
        data-testid={`activity-dismiss-${task.id}`}
        aria-label="Dismiss"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        className={OVERLAY_BUTTON}
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}
