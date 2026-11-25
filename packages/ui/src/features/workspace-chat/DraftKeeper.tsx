/**
 * DraftKeeper — carries a chat's unsent message in and out of a workspace tab.
 *
 * A tab's composer is its own (an `ExternalThread` built for the tab), and it
 * goes when the tab closes, the workspace hides or the session changes. So on
 * the way out the text and files go to `draft-stash` under the chat's id, and
 * whichever composer shows that chat next takes them: this tab again, or the
 * chat column (`use-chat-thread-runtime`). In the other direction, opening a tab
 * for a chat that was typed into in the chat column takes that draft, however
 * late its owner hands it over.
 *
 * The last composer state is mirrored in a ref: by the time an unmount cleanup
 * runs, the thread client behind `aui` may already be gone.
 *
 * Quoted segments need nothing: their store is keyed by the same id and
 * survives on its own.
 */
import { useEffect, useRef } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { handoffDraft, takeStash, waitForStash, type DraftStash } from '@/features/chat/runtime/draft-stash';

/** Both drafts, when the composer was typed into before the stashed one arrived. */
function joined(current: string, stashed: string): string {
  return [current, stashed].filter((text) => text !== '').join('\n\n');
}

export function DraftKeeper({ chatId }: { chatId: string }): null {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const attachments = useAuiState((s) => s.composer.attachments);
  const latest = useRef<DraftStash>({ text: '', attachments: [] });
  useEffect(() => {
    latest.current = {
      text,
      attachments: attachments.map((a) => a.file).filter((file): file is File => file != null),
    };
  }, [text, attachments]);

  useEffect(() => {
    const apply = (): void => {
      const draft = takeStash(chatId);
      if (draft == null) return;
      const composer = aui.thread.composer();
      composer.setText(joined(composer.getState().text, draft.text));
      for (const file of draft.attachments) {
        void composer.addAttachment(file).catch((error: unknown) => {
          console.warn('[workspace-chat] could not restore an attachment', error);
        });
      }
    };
    let stop: () => void;
    const listen = (): void => {
      stop = waitForStash(chatId, () => {
        apply();
        listen();
      });
    };
    apply();
    listen();
    return () => stop();
    // `aui` is a fresh client per render of its provider; a draft is taken per chat.
  }, [chatId]);

  useEffect(
    () => () => {
      const draft = latest.current;
      if (draft.text !== '' || draft.attachments.length > 0) handoffDraft(chatId, draft);
    },
    [chatId],
  );
  return null;
}
