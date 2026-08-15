/**
 * Reproduces the QA-reported "phantom Working…" defect (todo #324, S8):
 * pressing Escape on an idle (never-run) composer must not call the
 * runtime's cancel handler.
 *
 * `Composer.test.tsx` mocks `@assistant-ui/react` entirely, so it never
 * exercises aui's real `ComposerPrimitive.Input`, which wires
 * `@radix-ui/react-use-escape-keydown` — a document-level (capture-phase)
 * listener outside React's synthetic event system — to call the runtime's
 * `onCancel`. This suite mounts the real `Composer` against a real
 * `useExternalStoreRuntime`, the same recipe `ComposerTriggers.test.tsx`
 * uses, so that listener actually runs.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AssistantRuntimeProvider, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessage } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ComposerEditProvider } from '../edit/composer-edit-context';

vi.mock('../config-toolbar/ComposerToolbar', () => ({ ComposerToolbar: () => null }));
vi.mock('../attachments/ComposerAttachmentStrip', () => ({
  ComposerAttachments: () => null,
  ComposerAddAttachment: () => null,
  ComposerAddMention: () => null,
}));
vi.mock('../triggers/ComposerTriggers', () => ({
  ComposerTriggers: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../highlight/ComposerHighlight', () => ({ ComposerHighlight: () => null }));
vi.mock('../segments/ComposerSegments', () => ({ ComposerSegments: () => null }));

import { Composer } from '../Composer';

function renderComposer(onCancel: () => void) {
  function Harness() {
    const runtime = useExternalStoreRuntime<ThreadMessage>({
      isRunning: false,
      messages: [],
      onNew: async () => {},
      onCancel: async () => onCancel(),
    });
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <ComposerEditProvider>
          <Composer />
        </ComposerEditProvider>
      </AssistantRuntimeProvider>
    );
  }
  return render(
    <TooltipProvider>
      <Harness />
    </TooltipProvider>,
  );
}

describe('Escape on an idle Composer (real assistant-ui runtime)', () => {
  it('does not call the runtime onCancel — the thread was never running', () => {
    const onCancel = vi.fn();
    renderComposer(onCancel);
    const input = screen.getByTestId('chat-composer-input');
    input.focus();

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', cancelable: true, bubbles: true });

    expect(onCancel).not.toHaveBeenCalled();
  });
});
