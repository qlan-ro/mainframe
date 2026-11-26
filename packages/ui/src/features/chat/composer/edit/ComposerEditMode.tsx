'use client';

/**
 * Composer edit mode — editing a QUEUED message reuses the one composer.
 *
 * Amber header marks the mode ("Editing queued message · stays queued until the
 * run finishes" + esc-to-cancel). The blocks a message carries for the agent
 * (captures, session references) are kept out of the field and put back. The text is loaded + editable; the config
 * toolbar is shown MUTED (the queue-edit contract is content-only — `PATCH
 * /queue/:id { content }`). Save updates the queued item; Cancel-edit discards
 * and leaves it queued.
 *
 * On save failure the editor stays open and an inline error line is shown —
 * the edit is NOT silently discarded.
 */
import { useState, useCallback } from 'react';
import { PencilIcon, CheckIcon } from 'lucide-react';
import { ApiRequestError } from '@/lib/api/http';
import { Button } from '@/components/ui/button';
import { splitHiddenPrefix } from '../../markers/message-markers';
import { useChatExtras } from '../../runtime/chat-extras';
import { ComposerToolbar } from '../config-toolbar/ComposerToolbar';
import { StopControl } from '../send/SendControls';
import type { QueuedEdit } from './composer-edit-context';

export function ComposerEditMode({ edit, onDone }: { edit: QueuedEdit; onDone: () => void }) {
  const extras = useChatExtras();
  const { hidden, visible } = splitHiddenPrefix(edit.content);
  const [text, setText] = useState(visible);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    const trimmed = text.trim();
    const save = edit.save ?? ((content: string) => extras?.editQueued(edit.messageId, content) ?? Promise.resolve());
    if (!trimmed || trimmed === visible) {
      onDone();
      return;
    }
    setSaving(true);
    setSaveError(null);
    save(hidden + trimmed)
      .then(() => {
        onDone();
      })
      .catch(async (err: unknown) => {
        if (err instanceof ApiRequestError && err.status === 409 && err.code === 'queued_message_gone') {
          if (edit.recover) {
            await edit.recover(trimmed);
            onDone();
            return;
          }
          setSaveError('This message was already sent. Your edit is still in the composer.');
        } else {
          setSaveError('Save failed — please try again.');
        }
        setSaving(false);
      });
  }, [text, extras, edit, onDone, hidden, visible]);

  return (
    <div
      data-testid="chat-composer-edit"
      // Caution amber and the edit-ring glow stay bridge-owned: v2's `warning`
      // means wrong-but-not-broken, and an edit in flight is neither.
      className="relative z-1 overflow-hidden rounded-2xl border border-warning bg-card shadow-[var(--mf-shadow-edit-ring)] has-[textarea:focus-visible]:focus-line-inset"
    >
      <div className="flex items-center gap-2 bg-warning-surface py-1.5 pr-3 pl-2.5">
        <PencilIcon size={12} className="shrink-0 text-warning" />
        <span className="text-xs font-semibold text-foreground">Editing queued message</span>
        {saveError ? (
          <span className="text-xs text-fail">{saveError}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {edit.save ? '· not sent until you send it' : '· stays queued until the run finishes'}
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-muted-foreground">esc to cancel</span>
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
        className="max-h-48 w-full resize-none bg-transparent px-4 pt-3 pb-1.5 text-sm leading-relaxed text-foreground outline-none"
      />

      <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-1.5">
        {/* Config shown muted — content-only edit per the daemon queue contract.
            opacity-40 + saturate-[0.6] (not just opacity-50) so colored/active
            chips (amber Plan toggle, worktree dot) visibly desaturate as well as
            dim, matching the design's `filter: saturate(0.6)` treatment. */}
        <div
          data-testid="chat-composer-edit-toolbar"
          className="pointer-events-none flex min-h-8 items-center gap-1 opacity-40 saturate-[0.6]"
          aria-hidden
        >
          <ComposerToolbar />
        </div>
        <div className="flex items-center gap-2">
          {/* The turn keeps running while a queued message is edited. */}
          <StopControl />
          <Button variant="outline" size="sm" data-testid="chat-composer-edit-cancel" onClick={onDone}>
            Cancel edit
          </Button>
          <Button size="sm" data-testid="chat-composer-edit-save" onClick={handleSave} disabled={saving}>
            <CheckIcon data-icon="inline-start" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
