'use client';

/**
 * Queued user message — a PENDING variant of the cool-card that lands in narrative
 * order at the thread tail (NOT a banner over the composer). Same gradient/ink as a
 * sent turn, but a dashed `--mf-um-dash` hairline + slight ghost. Per-item Edit /
 * Cancel are hover/focus-revealed; the amber-spinner meta sits under the bubble.
 *
 *  - Cancel → DELETE the queued message (it never sends).
 *  - Edit   → load it into the composer's edit mode (text stays editable there).
 */
import { useCallback, type ReactNode } from 'react';
import { PencilIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useComposerEdit } from '../composer/composer-edit-context';

const PENDING_CARD = { background: 'var(--mf-um-card)' } as const;

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
        'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-caption text-mf-text-3 transition-colors hover:bg-accent',
        danger && 'hover:text-destructive',
      )}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

function QueuedMeta() {
  return (
    <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-micro text-mf-text-3">
      <span
        className="inline-block h-[7px] w-[7px] shrink-0 animate-spin rounded-full border-[1.5px] border-mf-warning"
        style={{ borderTopColor: 'transparent' }}
      />
      Queued · sends after the current run
    </span>
  );
}

export function QueuedUserTurn({
  messageId,
  content,
  children,
}: {
  messageId: string;
  content: string;
  children: ReactNode;
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
    <div data-testid="chat-queued-message" className="group/queued flex w-full flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/queued:opacity-100 group-focus-within/queued:opacity-100">
          <QueuedAction icon={PencilIcon} label="Edit" onClick={handleEdit} testid="chat-queued-edit" />
          <QueuedAction icon={XIcon} label="Cancel" onClick={handleCancel} danger testid="chat-queued-cancel" />
        </div>
        <div
          style={PENDING_CARD}
          className="max-w-[470px] rounded-xl border border-dashed border-mf-um-dash px-[15px] py-[10px] text-body leading-relaxed tracking-[-0.1px] text-mf-um-ink opacity-[0.82]"
        >
          {children}
        </div>
      </div>
      <QueuedMeta />
    </div>
  );
}
