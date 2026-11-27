/**
 * The mobile contract: the message the daemon receives is the same text
 * whichever field typed it. One scripted draft (a quote segment, a `/` pick, a
 * session pick, a path typed by hand) goes through the real `Composer`,
 * `ComposerTriggers` and send path in both modes, and both must append the
 * same message, character for character. The chip field must also have shown
 * the tokens as chips, or the comparison proves nothing.
 */
import { useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessage,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useComposerSegments } from '../segments/segment-store';
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

function Harness({ onNew }: { onNew: (message: AppendMessage) => void }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew: async (message) => onNew(message),
    adapters: {
      threadList: {
        threadId: 'thread-1',
        threads: [{ id: 'thread-1', status: 'regular', title: 'One' }],
        onSwitchToThread: () => {},
      },
    },
  });
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

/** Types the scripted draft in one mode and returns what was sent, plus the chips the field showed. */
async function sendScriptedDraft(mode: FieldMode): Promise<{ text: string; chips: string[] }> {
  setFieldMode(mode);
  useComposerSegments.setState({
    byThread: {
      'thread-1': {
        committed: [{ id: 's1', quote: 'the old line', text: 'compare with @lib/old.ts' }],
        liveQuote: null,
      },
    },
  });
  const onNew = vi.fn();
  const { unmount, container } = render(<Harness onNew={onNew} />);
  const field = await findField();

  await pick(field, '/rev');
  typeInto(field, 'look at ');
  await pick(field, '@Fix');
  typeInto(field, 'and @src/app.ts now');
  await waitFor(() => expect(screen.queryByTestId('composer-trigger-popover')).toBeNull());
  const chips = chipsIn(container);
  pressKey(field, 'Enter');

  await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
  const [part] = (onNew.mock.calls[0]![0] as AppendMessage).content;
  unmount();
  return { text: part?.type === 'text' ? part.text : '', chips };
}

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
    useSessionReferences.setState({ byThread: {} });
  });
  afterEach(() => setFieldMode('textarea'));

  it('sends the scripted draft character for character the same, chips or not', async () => {
    const textarea = await sendScriptedDraft('textarea');
    useSessionReferences.setState({ byThread: {} });
    const chips = await sendScriptedDraft('chips');

    expect(textarea.text).toBe(EXPECTED_WIRE_TEXT);
    expect(chips.text).toBe(textarea.text);
    expect(textarea.chips).toEqual([]);
    expect(chips.chips).toEqual(['@lib/old.ts', '/review', '@Fix login bug', '@src/app.ts']);
  });
});
