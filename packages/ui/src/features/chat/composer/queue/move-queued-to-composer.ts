import { getAttachment } from '@/lib/api/attachments';
import { mfToast } from '@/lib/toast';
import { readLiveComposerState } from '../read-live-composer-state';
import type { DraftComposer } from '../unsent/restore-draft';
import { focusVisibleComposer } from '../focus-composer';

export async function moveQueuedToComposer(
  composer: DraftComposer,
  port: number,
  chatId: string,
  content: string,
  attachmentIds?: readonly string[],
) {
  const draft = readLiveComposerState(composer).text;
  composer.setText([draft, content].filter((part) => part !== '').join('\n\n'));
  focusVisibleComposer();

  const failures = await Promise.all(
    (attachmentIds ?? []).map(async (id) => {
      let name = id;
      try {
        const attachment = await getAttachment(port, chatId, id);
        name = attachment.name;
        const bytes = Uint8Array.from(atob(attachment.data), (byte) => byte.charCodeAt(0));
        await composer.addAttachment(new File([bytes], name, { type: attachment.mediaType }));
        return undefined;
      } catch {
        return name;
      }
    }),
  );
  const names = failures.filter((name) => name !== undefined);
  if (names.length) mfToast.error('Could not copy some queued attachments', { description: names.join(', ') });
}
