'use client';

/**
 * Queued user message — a PENDING variant of the user bubble that lands in
 * narrative order at the thread tail (NOT a banner over the composer). Same
 * `tinted` fill as a sent turn, but a dashed hairline + slight ghost. Per-item
 * Edit / Cancel are hover/focus-revealed; the meta row sits under the bubble.
 *
 *  - Cancel → DELETE the queued message (it never sends).
 *  - Edit   → load it into the composer's edit mode (text stays editable there).
 *
 * Position / total props power the FIFO label. The message is already sent to
 * the CLI, which holds it in its own queue and may pick it up mid-turn or at
 * the next turn boundary — the copy must not claim it "sends after the run":
 *   position<=1 (head)   → "Queued · Claude will pick this up shortly"
 *   position>1           → "Queued · {ordinal(position)} in line"
 */
import { useCallback, type ReactNode } from 'react';
import { PencilIcon, XIcon } from 'lucide-react';
import { cn } from '@v2/lib/utils';
import { Bubble, BubbleContent } from '@v2/components/ui/bubble';
import { Button } from '@v2/components/ui/button';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useComposerEdit } from '../composer/edit/composer-edit-context';

// ── Ordinal helper ────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

// ── QueuedAction ──────────────────────────────────────────────────────────────

interface QueuedActionProps {
  icon: typeof PencilIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
  testid: string;
}

function QueuedAction({ icon: Icon, label, onClick, danger, testid }: QueuedActionProps) {
  return (
    <Button
      variant="ghost"
      size="xs"
      data-testid={testid}
      onClick={onClick}
      className={cn('text-muted-foreground', danger && 'hover:text-destructive')}
    >
      <Icon data-icon="inline-start" />
      {label}
    </Button>
  );
}

// ── QueuedMeta ────────────────────────────────────────────────────────────────

function QueuedMeta({ position = 1, total = 1 }: { position?: number; total?: number }) {
  const isHead = position <= 1;
  const isMulti = total > 1;

  const label = isHead ? 'Queued · Claude will pick this up shortly' : `Queued · ${ordinal(position)} in line`;

  // Non-head items use a steady amber dot (no spin); head/single uses the spinner.
  const showSpinner = isHead || !isMulti;

  return (
    <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
      {/* `warning` in v2 means wrong-but-not-broken; a queued turn is neither,
          so the waiting signal is the accent, matching the running indicator. */}
      {showSpinner ? (
        <span className="inline-block size-2 shrink-0 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
      ) : (
        <span className="inline-block size-2 shrink-0 rounded-full bg-primary" />
      )}
      {label}
    </span>
  );
}

// ── QueuedUserTurn ────────────────────────────────────────────────────────────

export function QueuedUserTurn({
  messageId,
  content,
  children,
  extrasSlot,
  position,
  total,
}: {
  messageId: string;
  content: string;
  children: ReactNode;
  /** Attachments / capture context rows — rendered with the bubble, above the
   *  queued meta footer (artboard "Queued + attachment"). */
  extrasSlot?: ReactNode;
  /** 1-based position of this item in the FIFO queue. Default 1. */
  position?: number;
  /** Total number of items in the queue. Default 1. */
  total?: number;
}) {
  const extras = useChatExtras();
  const { startEdit } = useComposerEdit();

  const handleCancel = useCallback(() => {
    if (!extras) return;
    extras.cancelQueued(messageId).catch((err: unknown) => {
      console.warn('[queued] cancel failed', { messageId, err });
    });
  }, [extras, messageId]);

  const handleEdit = useCallback(() => startEdit({ messageId, content }), [startEdit, messageId, content]);

  return (
    <div
      data-testid="chat-queued-message"
      data-queued-id={messageId}
      className="group/queued flex w-full flex-col items-end gap-1.5"
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'flex items-center gap-0.5 opacity-0',
            'translate-x-[6px] group-hover/queued:translate-x-0 group-focus-within/queued:translate-x-0',
            'transition-[opacity,transform] duration-150',
            'group-hover/queued:opacity-100 group-focus-within/queued:opacity-100',
          )}
        >
          {/* Edit loads the content into the composer; for capture-only messages
              it opens the composer so the user can add text while keeping the capture. */}
          <QueuedAction icon={PencilIcon} label="Edit" onClick={handleEdit} testid="chat-queued-edit" />
          <QueuedAction icon={XIcon} label="Cancel" onClick={handleCancel} danger testid="chat-queued-cancel" />
        </div>
        {/* Skip the dashed bubble entirely for an attachment/image/capture-only
            queued message — otherwise it renders as an empty box. */}
        {children && (
          <Bubble variant="tinted" align="end" className="max-w-[470px]">
            <BubbleContent
              data-testid="chat-queued-bubble"
              className="border-dashed border-border opacity-80 transition-[opacity,border-color] duration-200 ease-in-out"
            >
              {children}
            </BubbleContent>
          </Bubble>
        )}
      </div>
      {extrasSlot && <div className="flex flex-col items-end gap-2 opacity-90">{extrasSlot}</div>}
      <QueuedMeta position={position} total={total} />
    </div>
  );
}
