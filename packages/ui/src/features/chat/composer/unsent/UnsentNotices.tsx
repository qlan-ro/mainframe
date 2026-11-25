'use client';

/** A first message that did not go out, above the field of every composer of its thread. */
import { useRef } from 'react';
import { useAui } from '@assistant-ui/react';
import { CircleAlert } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { sayRemoved } from '@/features/sessions/new-thread/move-draft';
import { samePlace } from '@/features/sessions/new-thread/draft-place';
import { getDraftConfig } from '@/features/sessions/runtime/draft-config';
import { writeToClipboard } from '@/lib/editor/copy-reference';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { mfToast } from '@/lib/toast';
import { useChatExtras } from '../../runtime/chat-extras';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { serializeComposition } from '../segments/serialize-composition';
import { unsentTitle } from './report-unsent';
import { restoreDraft } from './restore-draft';
import { dropUnsent, getUnsent, useUnsentMessages, type SubmittedDraft, type UnsentMessage } from './unsent-store';

function textOf({ text, composition }: SubmittedDraft): string {
  return serializeComposition(composition?.committed ?? [], { quote: composition?.liveQuote?.text ?? null, text });
}

function Notice({
  entry,
  onRestore,
  onDiscard,
}: {
  entry: UnsentMessage;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const failure = entry.failure!;
  const text = textOf(entry.draft);
  const copy = async () => {
    if (await writeToClipboard(text)) mfToast.success('Copied');
    else mfToast.error('Could not copy the text');
  };
  return (
    <div
      role="alert"
      data-testid="composer-unsent"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-fail/6 py-1.5 pr-1.5 pl-2.5 text-sm ring-1 ring-fail/28 ring-inset"
    >
      <CircleAlert className="size-4 shrink-0 text-fail" aria-hidden />
      <span className="flex min-w-40 flex-1 flex-col">
        <span className="font-medium">{unsentTitle(failure)}</span>
        <span data-testid="composer-unsent-reason" className="text-xs wrap-anywhere text-muted-foreground">
          {failure.reason}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="xs" data-testid="composer-unsent-restore" onClick={onRestore}>
          Restore
        </Button>
        {text !== '' && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="composer-unsent-copy"
            onClick={() => void copy()}
          >
            Copy text
          </Button>
        )}
        <Button type="button" variant="ghost" size="xs" data-testid="composer-unsent-discard" onClick={onDiscard}>
          Discard
        </Button>
      </span>
    </div>
  );
}

export function UnsentNotices() {
  const aui = useAui();
  const threadId = useActiveThreadId();
  const extras = useChatExtras();
  // The session's id once the draft became one, which the composer's item id may not be yet.
  const ownerId = extras?.state.chatId ?? threadId;
  const entries = useUnsentMessages(
    useShallow((s) =>
      s.entries.filter((e) => e.failure && e.threadId === ownerId && e.daemonId === getActiveDaemon().id),
    ),
  );
  const ref = useRef<HTMLDivElement>(null);
  if (threadId == null || entries.length === 0) return null;

  const settle = (entry: UnsentMessage): boolean => {
    // A press on a notice a Retry has just taken over, or another composer has settled.
    if (!getUnsent(entry.id)?.failure) return false;
    dropUnsent(entry.id);
    extras?.dropFailedMessage(entry.id);
    ref.current
      ?.closest('[data-testid="chat-composer"]')
      ?.querySelector<HTMLTextAreaElement>('[data-testid="chat-composer-input"]')
      ?.focus();
    return true;
  };

  const restore = (entry: UnsentMessage) => {
    if (!settle(entry)) return;
    const here = getDraftConfig(threadId);
    const { draft, setup } = entry;
    if (!setup || !here || samePlace(setup, here)) {
      restoreDraft(threadId, aui.composer, draft);
      return;
    }
    // The draft runs elsewhere now: what belongs to the old place stays there, as when it moved.
    restoreDraft(threadId, aui.composer, { ...draft, items: [], references: {} });
    sayRemoved(threadId, { items: draft.items, references: draft.references, waiting: [] }, setup);
  };

  return (
    <div ref={ref} className="mb-2 flex flex-col gap-1.5">
      {entries.map((entry) => (
        <Notice key={entry.id} entry={entry} onRestore={() => restore(entry)} onDiscard={() => settle(entry)} />
      ))}
    </div>
  );
}
