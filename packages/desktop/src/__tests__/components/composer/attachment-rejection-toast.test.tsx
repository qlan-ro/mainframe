import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { AssistantRuntimeProvider, useComposerRuntime, useExternalStoreRuntime } from '@assistant-ui/react';
import { createAttachmentAdapter } from '../../../renderer/components/chat/assistant-ui/composer/attachment-adapter';
import { AttachmentRejectionToaster } from '../../../renderer/components/chat/assistant-ui/composer/AttachmentRejectionToaster';
import { useToastStore } from '../../../renderer/store/toasts';

// An oversized file (> 5 MB) is rejected by the adapter; the rejection must
// surface as an error toast via assistant-ui's attachmentAddError event.
const HUGE_FILE = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });

function AddOnMount() {
  const composer = useComposerRuntime();
  useEffect(() => {
    void composer.addAttachment(HUGE_FILE).catch(() => {});
  }, [composer]);
  return null;
}

function Harness() {
  const runtime = useExternalStoreRuntime({
    isRunning: false,
    messages: [],
    onNew: vi.fn(),
    adapters: { attachments: createAttachmentAdapter() },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AttachmentRejectionToaster />
      <AddOnMount />
    </AssistantRuntimeProvider>
  );
}

describe('AttachmentRejectionToaster', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('shows an error toast when an attachment is rejected', async () => {
    render(<Harness />);
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.type).toBe('error');
      expect(toasts[0]!.description).toMatch(/too large/i);
    });
  });
});
