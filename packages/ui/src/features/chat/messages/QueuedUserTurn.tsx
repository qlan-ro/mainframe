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
 * Position / total props power the FIFO label:
 *   position=1, total=1  → "Queued · sends after the current run"
 *   position=1, total>1  → "Queued · sends next, after the current run"
 *   position>1           → "Queued · {ordinal(position)} to send"
 *
 * sending=true → solid border, opacity 1, "Sending now…" label.
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
        'inline-flex items-center gap-1 rounded-md border border-transparent h-[24px] px-[9px]',
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

function QueuedMeta({
  position = 1,
  total = 1,
  sending = false,
}: {
  position?: number;
  total?: number;
  sending?: boolean;
}) {
  const isHead = position <= 1;
  const isMulti = total > 1;

  let label: string;
  if (sending) {
    label = 'Sending now…';
  } else if (!isMulti) {
    label = 'Queued · sends after the current run';
  } else if (isHead) {
    label = 'Queued · sends next, after the current run';
  } else {
    label = `Queued · ${ordinal(position)} to send`;
  }

  // Non-head items use a steady amber dot (no spin); head/single uses the spinner.
  const showSpinner = isHead || !isMulti || sending;
  const dimmed = isMulti && !isHead && !sending;

  return (
    <span
      className={cn(
        'mr-1 inline-flex items-center gap-1.5 font-mono text-micro tracking-[-0.1px]',
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
  sending,
}: {
  messageId: string;
  content: string;
  children: ReactNode;
  /** Attachments / capture context rows — rendered with the bubble, above the
   *  "Queued · sends after…" meta footer (artboard "Queued + attachment"). */
  extrasSlot?: ReactNode;
  /** 1-based position of this item in the FIFO queue. Default 1. */
  position?: number;
  /** Total number of items in the queue. Default 1. */
  total?: number;
  /** True while the item is actively being transmitted (transient). */
  sending?: boolean;
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
    <div data-testid="chat-queued-message" className="group/queued flex w-full flex-col items-end gap-[5px]">
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
          <div
            style={PENDING_CARD}
            className={cn(
              'max-w-[470px] rounded-xl border px-[15px] py-[10px] text-body leading-[1.58] tracking-[-0.1px] text-mf-um-ink',
              'transition-[opacity,border-color] duration-200 ease-in-out',
              sending ? 'border-solid border-mf-um-edge' : 'border-dashed border-mf-um-dash opacity-[0.82]',
            )}
          >
            {children}
          </div>
        )}
      </div>
      {extrasSlot && <div className="flex flex-col items-end gap-2 opacity-[0.9]">{extrasSlot}</div>}
      <QueuedMeta position={position} total={total} sending={sending} />
    </div>
  );
}
