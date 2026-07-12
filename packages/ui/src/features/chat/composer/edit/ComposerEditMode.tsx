'use client';

/**
 * Composer edit mode — editing a QUEUED message reuses the one composer.
 *
 * Amber header marks the mode ("Editing queued message · stays queued until the
 * run finishes" + esc-to-cancel). The text is loaded + editable; the config
 * toolbar is shown MUTED (the queue-edit contract is content-only — `PATCH
 * /queue/:id { content }`). Save updates the queued item; Cancel-edit discards
 * and leaves it queued.
 *
 * On save failure the editor stays open and an inline error line is shown —
 * the edit is NOT silently discarded.
 */
import { useState, useCallback } from 'react';
import { PencilIcon, CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { ComposerToolbar } from '../config-toolbar/ComposerToolbar';
import type { QueuedEdit } from './composer-edit-context';

export function ComposerEditMode({ edit, onDone }: { edit: QueuedEdit; onDone: () => void }) {
  const extras = useChatExtras();
  const [text, setText] = useState(edit.content);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    const trimmed = text.trim();
    if (!extras || !trimmed || trimmed === edit.content) {
      onDone();
      return;
    }
    setSaving(true);
    setSaveError(null);
    extras
      .editQueued(edit.messageId, trimmed)
      .then(() => {
        onDone();
      })
      .catch((err: unknown) => {
        console.warn('[queued] edit save failed', { messageId: edit.messageId, err });
        setSaving(false);
        setSaveError('Save failed — please try again.');
      });
  }, [text, extras, edit, onDone]);

  return (
    <div
      data-testid="chat-composer-edit"
      className="overflow-hidden rounded-xl [border-width:0.5px] border-mf-warning bg-card shadow-[var(--mf-shadow-edit-ring)]"
    >
      <div className="flex items-center gap-2 bg-mf-warning-tint pl-[9px] pr-[11px] py-[7px]">
        <span className="flex size-[19px] items-center justify-center rounded-md bg-mf-warning-tint text-mf-warning">
          <PencilIcon size={12} />
        </span>
        <span className="text-label font-semibold text-foreground">Editing queued message</span>
        {saveError ? (
          <span className="text-label text-destructive">{saveError}</span>
        ) : (
          <span className="text-label text-muted-foreground">· stays queued until the run finishes</span>
        )}
        <span className="ml-auto font-mono text-caption text-muted-foreground">esc to cancel</span>
      </div>

      <textarea
        data-testid="chat-composer-edit-input"
        data-noring
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
        }}
        autoFocus
        rows={2}
        className="max-h-48 w-full resize-none bg-transparent px-4 pt-3 pb-1.5 text-body leading-relaxed text-foreground outline-none"
      />

      <div className="flex items-center justify-between gap-2 px-2.5 pt-[4px] pb-[6px]">
        {/* Config shown muted — content-only edit per the daemon queue contract.
            opacity-40 + saturate-[0.6] (not just opacity-50) so colored/active
            chips (amber Plan toggle, accent-tinted Features/Worktree dots)
            visibly desaturate as well as dim, matching the design's
            `filter: saturate(0.6)` treatment. */}
        <div
          data-testid="chat-composer-edit-toolbar"
          className="pointer-events-none flex min-h-8 items-center gap-1 opacity-40 saturate-[0.6]"
          aria-hidden
        >
          <ComposerToolbar />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="chat-composer-edit-cancel"
            onClick={onDone}
            className="rounded-md px-[12px] py-1.5 text-label font-medium text-foreground transition-colors hover:bg-accent [border-width:0.5px] border-border"
          >
            Cancel edit
          </button>
          <button
            type="button"
            data-testid="chat-composer-edit-save"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-primary pl-[11px] pr-[13px] py-1.5 text-label font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50',
            )}
          >
            <CheckIcon size={14} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
