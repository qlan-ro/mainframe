/**
 * Todo #353, QA finding S4 — Escape after an unmatched trigger token (e.g.
 * `/zzz`) must leave focus in the composer, not park it on the transcript.
 *
 * This is an end-to-end wiring smoke test, not the regression pin: it mounts
 * the real `ComposerTriggers` + `ComposerPrimitive.Input` (the plugin
 * registry, `TriggerFieldAriaProvider`, and Composer.tsx's own Escape guard
 * all wired for real), so it would catch a wiring break in any of those
 * seams. It can NOT reproduce the actual S4 race: that bug needs a genuine
 * browser event, where the JS stack empties between the document-level
 * CAPTURE listener (`@radix-ui/react-use-escape-keydown`, which runs the
 * trigger's `close()`) and React's bubble-phase dispatch, letting a
 * microtask-queued re-render land in between and hand the bubble handler a
 * stale "armed" value. `fireEvent`/`dispatchEvent` run the whole capture-to-
 * bubble chain in one synchronous stack, so that checkpoint never happens
 * here. `focus-composer.test.tsx`'s `pressEscape(input, { prevented: true })`
 * cases pin the actual fix by asserting on `e.defaultPrevented` directly,
 * independent of that timing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
vi.mock('../highlight/ComposerHighlight', () => ({ ComposerHighlight: () => null }));
vi.mock('../segments/ComposerSegments', () => ({ ComposerSegments: () => null }));

vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({
    port: 31415,
    state: { chatId: 'chat-1', chatConfig: { projectId: 'proj-1', adapterId: 'claude' } },
  }),
}));
vi.mock('@/features/sessions/runtime/draft-config', () => ({ useDraftConfig: () => undefined }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  useChatSkills: () => ({ skills: [], agents: [], commands: [], loading: false }),
  useChatAgents: () => [],
}));
vi.mock('@/lib/api/files', () => ({
  searchFiles: vi.fn().mockResolvedValue([]),
  getFileTree: vi.fn().mockResolvedValue([]),
  browseFilesystem: vi.fn().mockResolvedValue([]),
}));
vi.mock('../sessions/use-session-mention-source', () => ({
  useSessionMentionSource: () => ({ items: [], pathByChatId: new Map(), refresh: vi.fn() }),
}));

import { Composer } from '../Composer';

function Harness() {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerEditProvider>
        <Composer />
      </ComposerEditProvider>
    </AssistantRuntimeProvider>
  );
}

function renderComposerInTranscript() {
  return render(
    <TooltipProvider>
      <div data-mf-chat-thread tabIndex={-1}>
        <Harness />
      </div>
    </TooltipProvider>,
  );
}

describe('Escape after an unmatched trigger token — real assistant-ui plugin registry (todo #353, S4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves focus in the composer, not the transcript viewport', async () => {
    renderComposerInTranscript();
    const input = screen.getByTestId('chat-composer-input');
    input.focus();

    fireEvent.change(input, { target: { value: '/zzz', selectionStart: 4, selectionEnd: 4 } });
    await waitFor(() => expect(screen.queryByTestId('composer-trigger-popover')).not.toBeInTheDocument());

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', cancelable: true, bubbles: true });

    expect(document.activeElement).toBe(input);
  });
});
