import type { AppendMessage } from '@assistant-ui/react';
import { mfToast } from '@/lib/toast';
import { forgetSentCaptures } from '../composer/draft-content/draft-content-store';
import { settleSubmittedDraft } from '../composer/segments/submitted-draft';
import type { AcpChatController } from '../controller/acp-chat-controller';

export function recoverComposerSubmission(
  controller: AcpChatController,
  message: AppendMessage,
  error: unknown,
): boolean {
  if (!settleSubmittedDraft(message, 'failed')) return false;
  forgetSentCaptures((message.attachments ?? []).map(({ id }) => id));
  controller.markAttachmentsRestoredForFailure(error);
  mfToast.error('Could not send message', { description: error instanceof Error ? error.message : undefined });
  return true;
}

export async function sendFromComposer(controller: AcpChatController, message: AppendMessage): Promise<void> {
  try {
    await controller.sendMessage(message);
    settleSubmittedDraft(message);
  } catch (error) {
    if (!recoverComposerSubmission(controller, message, error)) {
      mfToast.error('Could not send message', { description: error instanceof Error ? error.message : undefined });
    }
  }
}
