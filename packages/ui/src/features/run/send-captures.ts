/**
 * Upload sandbox captures as attachments and send them as a user message with
 * the sentinel markdown block. The controller-resolution seam is handled by
 * injected deps so this module stays pure and unit-testable.
 *
 * Callers (e.g. CaptureAnnotationPopover submit) resolve {port, chatId} from
 * the active session and bind uploadAttachments + sendMessage from the active
 * chat controller before calling sendCaptures. If no active chat exists, the
 * caller must create/resume one first (see the new-thread-coordinator path).
 */
import { formatCaptures, type CaptureLike } from './format-captures';
import type { UploadAttachmentItem } from '@/lib/api/attachments';

export interface SendCapturesDeps {
  port: number;
  chatId: string;
  uploadAttachments: (port: number, chatId: string, items: UploadAttachmentItem[]) => Promise<string[]>;
  sendMessage: (input: { text: string; attachmentIds: string[] }) => Promise<void>;
}

export async function sendCaptures(captures: ReadonlyArray<CaptureLike>, deps: SendCapturesDeps): Promise<void> {
  if (captures.length === 0) return;
  const { markdown, attachments } = formatCaptures(captures);
  if (attachments.length === 0) return;
  const ids = await deps.uploadAttachments(deps.port, deps.chatId, attachments);
  await deps.sendMessage({ text: markdown, attachmentIds: ids });
}
