import type { MessageContent } from '@mainframe/types';
import type { AttachmentStore } from '../attachment/index.js';
import { buildAttachedFilePathTag } from '../attachment/index.js';

export interface AttachmentResult {
  images: { mediaType: string; data: string }[];
  messageContent: MessageContent[];
  textPrefix: string[];
  attachmentPreviews: Array<{
    name: string;
    mediaType: string;
    sizeBytes: number;
    kind: 'image' | 'file';
    originalPath?: string;
    materializedPath?: string;
  }>;
}

export async function processAttachments(
  chatId: string,
  attachmentIds: string[],
  store: AttachmentStore,
): Promise<AttachmentResult> {
  const images: AttachmentResult['images'] = [];
  const messageContent: MessageContent[] = [];
  const textPrefix: string[] = [];
  const attachmentPreviews: AttachmentResult['attachmentPreviews'] = [];

  for (const id of attachmentIds) {
    const attachment = await store.get(chatId, id);
    if (!attachment) continue;
    attachmentPreviews.push({
      name: attachment.name,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
      kind: attachment.kind,
      originalPath: attachment.originalPath,
      materializedPath: attachment.materializedPath,
    });
    if (attachment.kind === 'image') {
      images.push({ mediaType: attachment.mediaType, data: attachment.data });
      messageContent.push({ type: 'image', mediaType: attachment.mediaType, data: attachment.data });
      continue;
    }
    textPrefix.push(buildAttachedFilePathTag(attachment));
  }

  return { images, messageContent, textPrefix, attachmentPreviews };
}
