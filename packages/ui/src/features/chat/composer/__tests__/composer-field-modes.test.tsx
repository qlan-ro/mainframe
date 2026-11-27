/**
 * The composer's field behaviour, run against both fields: the textarea (the
 * chip setting off, today's default) and the Lexical chip field (setting on).
 * Every case mounts the real `Composer` and `ComposerTriggers` on a real
 * external-store runtime and drives the field through `composer-field-driver`,
 * so nothing here depends on which element the field is.
 *
 * Only the card's other children and our data hooks are mocked.
 *
 * Moved here from the textarea-only suites: the Escape cases (#324 S8: an idle
 * Escape must never call the runtime's cancel; #353 S4: Escape on an armed but
 * unmatched token stays in the field) and the thread-switch focus case (#627).
 * And from `focus-composer.test.tsx`, AC 13: Escape is never prevented by
 * the field (the panels' document-level listeners still see it), and an Escape
 * the trigger menu already prevented leaves focus in the field. That second
 * case pins the S4 fix, which reads `defaultPrevented` off the event rather
 * than a render-timed "armed" flag.
 */
import { useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessage,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiPrefs } from '@/store/ui-prefs';
import { ComposerEditProvider } from '../edit/composer-edit-context';
import { useComposerSegments } from '../segments/segment-store';
import {
  FIELD_MODES,
  fieldText,
  findField,
  placeholderOf,
  pressKey,
  setFieldMode,
  typeInto,
} from './composer-field-driver';

const cyclePermission = vi.fn();
vi.mock('../config-toolbar/ComposerToolbar', () => ({
  ComposerToolbar: ({ ref }: { ref?: React.Ref<{ cyclePermission: () => void }> }) => {
    useImperativeHandle(ref, () => ({ cyclePermission }));
    return null;
  },
}));
vi.mock('../attachments/ComposerAttachmentStrip', () => ({ ComposerAttachments: () => null }));
vi.mock('../strips/TopStrip', () => ({ TopStrip: () => null }));
vi.mock('../queue/QueuedRows', () => ({ QueuedRows: () => null }));
vi.mock('../config-toolbar/ContextRing', () => ({ ContextRing: () => null }));
vi.mock('../send/SendControls', () => ({ SendControls: () => null }));
vi.mock('../attachments/ComposerAddMenu', () => ({ ComposerAddMenu: () => null }));
vi.mock('../segments/ComposerSegments', () => ({ ComposerSegments: () => null }));
vi.mock('../send/use-enter-mode', async () => {
  const { useUiPrefs: prefs } = await import('@/store/ui-prefs');
  return { useCanSteer: () => true, useEnterMode: () => prefs((state) => state.enterWhileRunning) };
});
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtrasSelector: () => undefined,
  useChatExtras: () => ({
    port: 31415,
    state: { chatId: 'chat-1', chatConfig: { projectId: 'proj-1', adapterId: 'claude' }, runState: { type: 'idle' } },
  }),
}));
vi.mock('@/features/sessions/runtime/draft-config', () => ({
  useDraftConfig: () => undefined,
  getDraftConfig: () => undefined,
}));
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

const THREADS = [
  { id: 'thread-1', status: 'regular' as const, title: 'One' },
  { id: 'thread-2', status: 'regular' as const, title: 'Two' },
];

interface HarnessProps {
  threadId?: string;
  running?: boolean;
  started?: boolean;
  onNew?: (message: AppendMessage) => void;
  onCancel?: () => void;
}

const STARTED: ThreadMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: [{ type: 'text', text: 'hi' }],
    createdAt: new Date(0),
    attachments: [],
    metadata: { custom: {} },
  } as unknown as ThreadMessage,
];

function Harness({ threadId = 'thread-1', running = false, started = false, onNew, onCancel }: HarnessProps) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: running,
    messages: started ? STARTED : [],
    onNew: async (message) => onNew?.(message),
    onCancel: async () => onCancel?.(),
    adapters: { threadList: { threadId, threads: THREADS, onSwitchToThread: () => {} } },
  });
  return (
    <TooltipProvider>
      <button data-testid="sidebar-row">Two</button>
      <div data-mf-chat-thread tabIndex={-1} data-testid="transcript">
        <AssistantRuntimeProvider runtime={runtime}>
          <ComposerEditProvider>
            <Composer />
          </ComposerEditProvider>
        </AssistantRuntimeProvider>
      </div>
    </TooltipProvider>
  );
}

/** Lets any follow-up send land: a `waitFor` on the first call alone would pass with a second one queued behind it. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const steerFlag = (message: AppendMessage) =>
  (message.runConfig as { custom?: Record<string, unknown> } | undefined)?.custom?.mainframeSteer;

describe.each(FIELD_MODES)('composer field (%s)', (mode) => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useUiPrefs.setState({ enterWhileRunning: 'queue' });
    useComposerSegments.setState({ byThread: {} });
    setFieldMode(mode);
  });
  afterEach(() => setFieldMode('textarea'));

  it('mounts the field this mode names', async () => {
    render(<Harness />);
    const field = await findField();

    if (mode === 'chips') expect(field).toHaveAttribute('contenteditable', 'true');
    else expect(field.tagName).toBe('TEXTAREA');
    expect(screen.queryByTestId('composer-prompt-highlight') !== null).toBe(mode === 'textarea');
  });

  it('is enabled and carries the collapsed combobox ARIA', async () => {
    render(<Harness />);
    const field = await findField();

    expect(field).not.toHaveAttribute('disabled');
    expect(field).toHaveAttribute('role', 'combobox');
    expect(field).toHaveAttribute('aria-expanded', 'false');
    expect(field).toHaveAttribute('aria-haspopup', 'listbox');
  });

  describe('placeholder', () => {
    it('invites a first message before the thread has started', async () => {
      render(<Harness />);
      expect(placeholderOf(await findField())).toBe('Ask anything, @ to mention, / for actions');
    });

    it('says "Reply to the agent…" once the thread has messages', async () => {
      render(<Harness started />);
      expect(placeholderOf(await findField())).toBe('Reply to the agent…');
    });

    it('says what Enter will do while a turn runs: queue by default', async () => {
      render(<Harness started running />);
      expect(placeholderOf(await findField())).toBe('Queue a message for when the agent finishes…');
    });

    it('says steer when steer is preferred', async () => {
      useUiPrefs.setState({ enterWhileRunning: 'steer' });
      render(<Harness running />);
      expect(placeholderOf(await findField())).toBe('Steer the agent, ⌥↵ to queue…');
    });

    it('a pending quote wins', async () => {
      useComposerSegments.setState({ byThread: { 'thread-1': { committed: [], liveQuote: { id: 'q', text: 'q' } } } });
      render(<Harness running />);
      expect(placeholderOf(await findField())).toBe('Add a message…');
    });
  });

  describe('Enter', () => {
    it('sends the text when idle, and the field clears', async () => {
      const onNew = vi.fn();
      render(<Harness onNew={onNew} />);
      const field = await findField();
      typeInto(field, 'hello');

      pressKey(field, 'Enter');

      await waitFor(() => expect(onNew).toHaveBeenCalled());
      await settle();
      expect(onNew).toHaveBeenCalledTimes(1);
      expect(onNew.mock.calls[0]![0].content).toEqual([{ type: 'text', text: 'hello' }]);
      await waitFor(() => expect(fieldText(field)).toBe(''));
    });

    it('queues mid-run by default, and ⌥↵ steers', async () => {
      const onNew = vi.fn();
      render(<Harness running onNew={onNew} />);
      const field = await findField();

      typeInto(field, 'one');
      const event = pressKey(field, 'Enter');
      await waitFor(() => expect(onNew).toHaveBeenCalled());
      await settle();
      expect(onNew).toHaveBeenCalledTimes(1);
      typeInto(field, 'two');
      pressKey(field, 'Enter', { altKey: true });
      await waitFor(() => expect(onNew).toHaveBeenCalledTimes(2));
      await settle();
      expect(onNew).toHaveBeenCalledTimes(2);

      expect(event.defaultPrevented).toBe(true);
      expect(steerFlag(onNew.mock.calls[0]![0])).toBeUndefined();
      expect(steerFlag(onNew.mock.calls[1]![0])).toBe(true);
    });

    it('with Steer preferred, Enter steers mid-run', async () => {
      useUiPrefs.setState({ enterWhileRunning: 'steer' });
      const onNew = vi.fn();
      render(<Harness running onNew={onNew} />);
      const field = await findField();
      typeInto(field, 'now');

      pressKey(field, 'Enter');

      await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
      expect(steerFlag(onNew.mock.calls[0]![0])).toBe(true);
    });

    it('⇧↵ does not send', async () => {
      const onNew = vi.fn();
      render(<Harness running onNew={onNew} />);
      const field = await findField();
      typeInto(field, 'a');

      pressKey(field, 'Enter', { shiftKey: true });

      expect(onNew).not.toHaveBeenCalled();
    });

    it('does not send while an input method is composing', async () => {
      const onNew = vi.fn();
      render(<Harness running onNew={onNew} />);
      const field = await findField();
      typeInto(field, 'ni');

      pressKey(field, 'Enter', { isComposing: true, keyCode: 229 } as KeyboardEventInit);

      expect(onNew).not.toHaveBeenCalled();
    });
  });

  it('⇧⇥ cycles the permission mode and keeps the key from leaving the field; plain ⇥ does not', async () => {
    render(<Harness />);
    const field = await findField();

    const event = pressKey(field, 'Tab', { shiftKey: true });
    pressKey(field, 'Tab');

    expect(event.defaultPrevented).toBe(true);
    expect(cyclePermission).toHaveBeenCalledTimes(1);
  });

  describe('Escape', () => {
    it('parks focus on the transcript and never cancels an idle thread', async () => {
      const onCancel = vi.fn();
      render(<Harness onCancel={onCancel} />);
      const field = await findField();
      act(() => field.focus());

      pressKey(field, 'Escape');

      expect(document.activeElement).toBe(screen.getByTestId('transcript'));
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('is not prevented or stopped, so a document-level Escape listener still sees it', async () => {
      render(<Harness />);
      const field = await findField();
      act(() => field.focus());
      const seen = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
      document.addEventListener('keydown', seen);

      pressKey(field, 'Escape');

      document.removeEventListener('keydown', seen);
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen.mock.results[0]!.value).toBe(false);
    });

    it('leaves focus in the field when the trigger menu already prevented the Escape', async () => {
      render(<Harness />);
      const field = await findField();
      act(() => field.focus());
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      event.preventDefault();

      act(() => {
        field.dispatchEvent(event);
      });

      expect(field.contains(document.activeElement) || document.activeElement === field).toBe(true);
    });

    it('closes an armed trigger first and leaves focus in the field, so a following Enter is not swallowed', async () => {
      const onNew = vi.fn();
      render(<Harness onNew={onNew} />);
      const field = await findField();
      act(() => field.focus());
      typeInto(field, '/zzz');

      pressKey(field, 'Escape');
      expect(field.contains(document.activeElement) || document.activeElement === field).toBe(true);

      const enter = pressKey(field, 'Enter');
      await waitFor(() => expect(onNew).toHaveBeenCalled());
      await settle();
      expect(enter.defaultPrevented).toBe(true);
      expect(onNew).toHaveBeenCalledTimes(1);
      expect(onNew.mock.calls[0]![0].content).toEqual([{ type: 'text', text: '/zzz' }]);
    });
  });

  it('a thread switch leaves focus where the user put it', async () => {
    const { rerender } = render(<Harness threadId="thread-1" />);
    await findField();
    const row = screen.getByTestId('sidebar-row');
    act(() => row.focus());

    await act(async () => {
      rerender(<Harness threadId="thread-2" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.activeElement).toBe(row);
  });
});
