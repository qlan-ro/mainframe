/**
 * The mobile contract: the message the daemon receives is the same text
 * whichever field typed it. Each draft (a quote segment, a `/` pick, a session
 * pick, paths typed by hand, several lines typed or restored, emoji, an
 * attachment) goes through the real `Composer`, `ComposerTriggers` and send
 * path in both modes, and both must append the same message, character for
 * character. The chip field must also have shown the expected chips, or the
 * comparison proves nothing.
 */
import { useEffect, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type AssistantRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createAttachmentAdapter } from '../attachment-adapter';
import { useComposerSegments } from '../segments/segment-store';
import type { Composition } from '../segments/segment-model';
import { useSessionReferences } from '../sessions/session-reference-store';
import { ComposerEditProvider } from '../edit/composer-edit-context';
import { chipsIn, findField, pressKey, setFieldMode, typeInto, type FieldMode } from './composer-field-driver';

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
  useChatSkills: () => ({
    skills: [],
    agents: [],
    commands: [{ name: 'review', description: 'Review the diff', source: 'builtin' }],
    loading: false,
  }),
  useChatAgents: () => [],
}));
vi.mock('@/lib/api/files', () => ({
  searchFiles: vi.fn().mockResolvedValue([]),
  getFileTree: vi.fn().mockResolvedValue([]),
  browseFilesystem: vi.fn().mockResolvedValue([]),
}));
vi.mock('../sessions/use-session-mention-source', () => ({
  useSessionMentionSource: () => ({
    items: [{ id: 'chat-9', type: 'session', label: 'Fix login bug' }],
    pathByChatId: new Map([['chat-9', '/transcripts/chat-9.jsonl']]),
    refresh: vi.fn(),
  }),
}));

import { Composer } from '../Composer';

function Harness({
  onNew,
  onRuntime,
}: {
  onNew(message: AppendMessage): void;
  onRuntime(runtime: AssistantRuntime): void;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew: async (message) => onNew(message),
    adapters: {
      attachments: createAttachmentAdapter(),
      threadList: {
        threadId: 'thread-1',
        threads: [{ id: 'thread-1', status: 'regular', title: 'One' }],
        onSwitchToThread: () => {},
      },
    },
  });
  useEffect(() => {
    onRuntime(runtime);
  }, [runtime, onRuntime]);
  return (
    <TooltipProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <ComposerEditProvider>
          <Composer />
        </ComposerEditProvider>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}

async function pick(field: HTMLElement, query: string) {
  typeInto(field, query);
  await screen.findByTestId('composer-trigger-popover');
  pressKey(field, 'Enter');
}

interface Draft {
  segments?: Composition;
  write(field: HTMLElement, runtime: AssistantRuntime): Promise<void> | void;
}

interface Sent {
  text: string;
  chips: string[];
  attachments: { name: string; contentType: string | undefined }[];
}

/** Writes the draft in one mode, sends it, and returns what was sent plus the chips the field showed. */
async function send(mode: FieldMode, draft: Draft): Promise<Sent> {
  setFieldMode(mode);
  useSessionReferences.setState({ byThread: {} });
  useComposerSegments.setState({ byThread: { 'thread-1': draft.segments ?? { committed: [], liveQuote: null } } });
  const onNew = vi.fn();
  let runtime: AssistantRuntime | null = null;
  const { unmount, container } = render(<Harness onNew={onNew} onRuntime={(r) => (runtime = r)} />);
  const field = await findField();
  await waitFor(() => expect(runtime).not.toBeNull());

  await draft.write(field, runtime!);
  await waitFor(() => expect(screen.queryByTestId('composer-trigger-popover')).toBeNull());
  const chips = chipsIn(container);
  pressKey(field, 'Enter');

  await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
  const message = onNew.mock.calls[0]![0] as AppendMessage;
  unmount();
  const [part] = message.content;
  return {
    text: part?.type === 'text' ? part.text : '',
    chips,
    attachments: (message.attachments ?? []).map(({ name, contentType }) => ({ name, contentType })),
  };
}

/** Sends the draft from both fields; they must agree, and the textarea shows no chips. */
async function sendBoth(draft: Draft): Promise<Sent> {
  const textarea = await send('textarea', draft);
  const chips = await send('chips', draft);
  expect(chips.text).toBe(textarea.text);
  expect(chips.attachments).toEqual(textarea.attachments);
  expect(textarea.chips).toEqual([]);
  return chips;
}

/** Puts `text` in the composer from outside the field, as a thread switch or a restored message does. */
const restore = (text: string) => (_field: HTMLElement, runtime: AssistantRuntime) =>
  act(() => runtime.thread.composer.setText(text));

const EXPECTED_WIRE_TEXT = [
  'Referenced session @session[Fix login bug]: /transcripts/chat-9.jsonl',
  '',
  '> the old line',
  '',
  'compare with @lib/old.ts',
  '',
  '/review look at @session[Fix login bug] and @src/app.ts now',
].join('\n');

describe('the text sent to the daemon is the same in both fields (mobile contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => setFieldMode('textarea'));

  it('sends the scripted draft character for character the same, chips or not', async () => {
    const sent = await sendBoth({
      segments: { committed: [{ id: 's1', quote: 'the old line', text: 'compare with @lib/old.ts' }], liveQuote: null },
      async write(field) {
        await pick(field, '/rev');
        typeInto(field, 'look at ');
        await pick(field, '@Fix');
        typeInto(field, 'and @src/app.ts now');
      },
    });

    expect(sent.text).toBe(EXPECTED_WIRE_TEXT);
    expect(sent.chips).toEqual(['@lib/old.ts', '/review', '@Fix login bug', '@src/app.ts']);
  });

  it('a live quote', async () => {
    const sent = await sendBoth({
      segments: { committed: [], liveQuote: { id: 'q', text: 'the new line' } },
      write: (field) => typeInto(field, 'why @src/a.ts here'),
    });

    expect(sent.text).toBe('> the new line\n\nwhy @src/a.ts here');
    expect(sent.chips).toEqual(['@src/a.ts']);
  });

  it('a quoted path with spaces', async () => {
    const sent = await sendBoth({ write: (field) => typeInto(field, 'open @"my dir/a b.ts" now') });

    expect(sent.text).toBe('open @"my dir/a b.ts" now');
    expect(sent.chips).toEqual(['@"my dir/a b.ts"']);
  });

  const MULTI_LINE = '/review first\nsee @a.ts\nlast';

  it('a multi-line draft, typed', async () => {
    const sent = await sendBoth({ write: (field) => typeInto(field, MULTI_LINE) });

    expect(sent.text).toBe(MULTI_LINE);
    expect(sent.chips).toEqual(['/review', '@a.ts']);
  });

  it('a multi-line draft, restored', async () => {
    const sent = await sendBoth({ write: restore(MULTI_LINE) });

    expect(sent.text).toBe(MULTI_LINE);
    expect(sent.chips).toEqual(['/review', '@a.ts']);
  });

  it('a /command on line 2 stays text, typed or restored', async () => {
    const typed = await sendBoth({ write: (field) => typeInto(field, 'hi\n/review now') });
    const restored = await sendBoth({ write: restore('hi\n/review now') });

    expect(typed).toEqual({ text: 'hi\n/review now', chips: [], attachments: [] });
    expect(restored).toEqual(typed);
  });

  it('emoji and multi-byte text around a token', async () => {
    const text = '🚀 naïve 你好 @src/a.ts 👍🏽 done';
    const sent = await sendBoth({ write: (field) => typeInto(field, text) });

    expect(sent.text).toBe(text);
    expect(sent.chips).toEqual(['@src/a.ts']);
  });

  it('an attachment', async () => {
    const sent = await sendBoth({
      async write(field, runtime) {
        await act(() => runtime.thread.composer.addAttachment(new File(['hi'], 'note.txt', { type: 'text/plain' })));
        typeInto(field, 'see @note.txt ');
      },
    });

    expect(sent.text).toBe('see @note.txt');
    expect(sent.attachments).toEqual([{ name: 'note.txt', contentType: 'text/plain' }]);
    expect(sent.chips).toEqual(['@note.txt']);
  });
});
