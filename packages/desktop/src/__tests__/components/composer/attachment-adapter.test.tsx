import { describe, it, expect, vi } from 'vitest';
import React, { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  useComposerRuntime,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { createAttachmentAdapter } from '../../../renderer/components/chat/assistant-ui/composer/attachment-adapter';

// Regression: assistant-ui 0.14 gates addAttachment through fileMatchesAccept,
// which only treats the literal '*' as a universal wildcard. The previous
// adapter declared the star-slash-star accept string, so every image/file was
// rejected and nothing appeared in the composer (both paperclip and paste).
// This drives the REAL library composer runtime: addAttachment must surface a
// rendered attachment.

const PNG_FILE = new File([Uint8Array.from([1, 2, 3])], 'shot.png', { type: 'image/png' });

function AddOnMount() {
  const composer = useComposerRuntime();
  useEffect(() => {
    void composer.addAttachment(PNG_FILE);
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
      <AddOnMount />
      <ComposerPrimitive.Attachments
        components={{
          Image: () => <div data-testid="attachment-thumb" />,
          Attachment: () => <div data-testid="attachment-thumb" />,
        }}
      />
    </AssistantRuntimeProvider>
  );
}

describe('createAttachmentAdapter', () => {
  it('accepts an image so it renders in the composer', async () => {
    render(<Harness />);
    await waitFor(() => {
      expect(screen.getByTestId('attachment-thumb')).toBeInTheDocument();
    });
  });
});
