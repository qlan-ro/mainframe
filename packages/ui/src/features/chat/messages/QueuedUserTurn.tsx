'use client';

/**
 * Queued user message — a PENDING variant of the cool-card that lands in narrative
 * order at the thread tail (NOT a banner over the composer). Same gradient/ink as a
 * sent turn, but a dashed `--mf-um-dash` hairline + slight ghost. Per-item Edit /
 * Cancel are hover/focus-revealed; the amber-spinner meta sits under the bubble.
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
import { cn } from '@/lib/utils';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useComposerEdit } from '../composer/edit/composer-edit-context';

const PENDING_CARD = { background: 'var(--mf-um-card)' } as const;

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
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className={cn(
        // Design 7.10: icon/label gap 4 (gap-1 was 2px), radius 7 (rounded-md
        // is 8px) — both arbitrary, no exact compressed-scale token.
        'inline-flex items-center gap-[4px] rounded-[7px] border border-transparent h-[24px] px-[9px]',
        'text-caption text-mf-text-3 transition-colors',
        'hover:bg-mf-content2 hover:border-border',
        danger && 'hover:text-destructive hover:border-destructive/35',
      )}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

// ── QueuedMeta ────────────────────────────────────────────────────────────────

function QueuedMeta({ position = 1, total = 1 }: { position?: number; total?: number }) {
  const isHead = position <= 1;
  const isMulti = total > 1;

  const label = isHead ? 'Queued · Claude will pick this up shortly' : `Queued · ${ordinal(position)} in line`;

  // Non-head items use a steady amber dot (no spin); head/single uses the spinner.
  const showSpinner = isHead || !isMulti;
  const dimmed = isMulti && !isHead;

  return (
    <span
      className={cn(
        'mr-1 inline-flex items-center gap-1.5 font-mono text-micro tracking-tight',
        dimmed ? 'text-mf-text-4' : 'text-mf-text-3',
      )}
    >
      {showSpinner ? (
        <span
          className="inline-block h-[7px] w-[7px] shrink-0 animate-spin rounded-full border-[1.5px] border-mf-warning"
          style={{ borderTopColor: 'transparent' }}
        />
      ) : (
        <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-mf-warning" />
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
      className="group/queued flex w-full flex-col items-end gap-[5px]"
    >
      {/* Design 7.6: gap 8 between the Edit/Cancel action group and the bubble. */}
      <div className="flex items-center gap-4">
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
          <div
            style={PENDING_CARD}
            className={cn(
              'max-w-[470px] rounded-xl border px-[15px] py-[10px] text-body leading-loose tracking-tight text-mf-um-ink',
              'transition-[opacity,border-color] duration-200 ease-in-out',
              'border-dashed border-mf-um-dash opacity-[0.82]',
            )}
          >
            {children}
          </div>
        )}
      </div>
      {extrasSlot && <div className="flex flex-col items-end gap-2 opacity-[0.9]">{extrasSlot}</div>}
      <QueuedMeta position={position} total={total} />
    </div>
  );
}
