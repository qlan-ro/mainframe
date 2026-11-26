/**
 * A session switch leaves focus where the user put it.
 *
 * assistant-ui 0.15.38's `ComposerPrimitive.Input` focuses itself on every
 * `threads.selectionChanged` unless `unstable_focusOnThreadSwitched` is off.
 * In 0.15.13 that event never reached Mainframe (#627), so focus stayed on the
 * clicked sidebar row and a workspace tab's composer kept its own focus. This
 * suite mounts the real `Composer` against a real runtime with a thread list,
 * switches the main thread, and checks focus does not move.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AssistantRuntimeProvider, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessage } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ComposerEditProvider } from '../edit/composer-edit-context';

vi.mock('../config-toolbar/ComposerToolbar', () => ({ ComposerToolbar: () => null }));
vi.mock('../attachments/ComposerAttachmentStrip', () => ({ ComposerAttachments: () => null }));
vi.mock('../strips/TopStrip', () => ({ TopStrip: () => null }));
vi.mock('../queue/QueuedRows', () => ({ QueuedRows: () => null }));
vi.mock('../config-toolbar/ContextRing', () => ({ ContextRing: () => null }));
vi.mock('../send/SendControls', () => ({ SendControls: () => null }));
vi.mock('../attachments/ComposerAddMenu', () => ({ ComposerAddMenu: () => null }));
vi.mock('../triggers/ComposerTriggers', () => ({
  ComposerTriggers: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../highlight/ComposerHighlight', () => ({ ComposerHighlight: () => null }));
vi.mock('../segments/ComposerSegments', () => ({ ComposerSegments: () => null }));

import { Composer } from '../Composer';

const THREADS = [
  { id: 'thread-a', status: 'regular' as const, title: 'A' },
  { id: 'thread-b', status: 'regular' as const, title: 'B' },
];

function Harness({ threadId }: { threadId: string }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew: async () => {},
    adapters: { threadList: { threadId, threads: THREADS, onSwitchToThread: () => {} } },
  });
  return (
    <TooltipProvider>
      <button data-testid="sidebar-row">B</button>
      <AssistantRuntimeProvider runtime={runtime}>
        <ComposerEditProvider>
          <Composer />
        </ComposerEditProvider>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}

describe('Composer on a thread switch (real assistant-ui runtime)', () => {
  it('leaves focus on the element the user chose', async () => {
    const { rerender } = render(<Harness threadId="thread-a" />);
    const row = screen.getByTestId('sidebar-row');
    act(() => row.focus());

    // aui emits the selection event after the commit, on a later task.
    await act(async () => {
      rerender(<Harness threadId="thread-b" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.activeElement).toBe(row);
    expect(document.activeElement).not.toBe(screen.getByTestId('chat-composer-input'));
  });
});
