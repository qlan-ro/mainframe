import { getAttachment } from '@/lib/api/attachments';
import { readLiveComposerState } from '../read-live-composer-state';
import type { DraftComposer } from '../unsent/restore-draft';
import { cancelQueuedMessage } from '@/lib/api/chats';
import { focusVisibleComposer } from '../focus-composer';

export async function moveQueuedToComposer(
  composer: DraftComposer,
  port: number,
  chatId: string,
  messageId: string,
  content: string,
  attachmentIds?: readonly string[],
) {
  const files = await Promise.all(
    (attachmentIds ?? []).map(async (id) => {
      const attachment = await getAttachment(port, chatId, id);
      const bytes = Uint8Array.from(atob(attachment.data), (byte) => byte.charCodeAt(0));
      return new File([bytes], attachment.name, { type: attachment.mediaType });
    }),
  );
  if (!(await cancelQueuedMessage(port, chatId, messageId))) return;
  const draft = readLiveComposerState(composer).text;
  composer.setText([draft, content].filter((part) => part !== '').join('\n\n'));
  await Promise.all(files.map((file) => composer.addAttachment(file)));
  focusVisibleComposer();
}
