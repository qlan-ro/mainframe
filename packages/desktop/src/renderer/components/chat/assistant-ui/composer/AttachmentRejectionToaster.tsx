import { useEffect } from 'react';
import { useComposerRuntime } from '@assistant-ui/react';
import { useToastStore } from '../../../../store/toasts';

const REASON_TITLE: Record<string, string> = {
  'no-adapter': 'Attachments unavailable',
  'not-accepted': 'Unsupported file',
  'adapter-error': 'Attachment rejected',
};

/**
 * Surfaces assistant-ui attachment-add rejections (too large, unreadable,
 * unsupported type) as error toasts. Rendered inside AssistantRuntimeProvider.
 */
export function AttachmentRejectionToaster(): null {
  const composer = useComposerRuntime();

  useEffect(() => {
    return composer.unstable_on('attachmentAddError', (e) => {
      const title = REASON_TITLE[e.reason] ?? 'Attachment rejected';
      useToastStore.getState().add('error', title, e.message);
    });
  }, [composer]);

  return null;
}
