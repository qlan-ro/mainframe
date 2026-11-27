// @vitest-environment jsdom
/**
 * Composer submit to transcript re-pin, end to end: a real `Composer` hands
 * its message to the real `AcpChatController` (as the runtime's `onNew` does),
 * which announces the send; the real bottom pin of a reader who scrolled up
 * jumps back to the end. A prompt the daemon or another agent delivers into
 * the same chat leaves that reader where they are.
 */
import { useEffect, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AssistantRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createAttachmentAdapter } from '../attachment-adapter';
import { useComposerSegments } from '../segments/segment-store';
import { ComposerEditProvider } from '../edit/composer-edit-context';
import { useThreadBottomPin } from '../../thread/use-thread-bottom-pin';
import { createViewport, installPinDoubles } from '../../thread/__tests__/pin-viewport-fixture';
import { CHAT_ID, makeController, userMessageUpdate } from '../../controller/__tests__/acp-test-kit';
import { findField, pressKey, typeInto } from './composer-field-driver';

vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: vi.fn() }));
vi.mock('../../../../lib/api/chats', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  getChatWorkflowRuns: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../lib/api/git', () => ({
  acceptWorktreeOffer: vi.fn().mockResolvedValue(undefined),
  dismissWorktreeOffer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));
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
    state: { chatId: 'chat-abc', chatConfig: { projectId: 'proj-1', adapterId: 'claude' }, runState: { type: 'idle' } },
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

installPinDoubles();

type Rig = ReturnType<typeof makeController>;

function Harness({ ctrl }: { ctrl: Rig['ctrl'] }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew: (message) => ctrl.sendMessage(message),
    adapters: {
      attachments: createAttachmentAdapter(),
      threadList: {
        threadId: 'thread-1',
        threads: [{ id: 'thread-1', status: 'regular', title: 'One' }],
        onSwitchToThread: () => {},
      },
    },
  });
  useEffect(() => void (runtime satisfies AssistantRuntime), [runtime]);
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

/** A transcript viewport the reader has scrolled up in, with the real pin on it. */
function mountScrolledUpPin() {
  const viewport = createViewport();
  const hook = renderHook(() => useThreadBottomPin(CHAT_ID));
  act(() => {
    hook.result.current.viewportRef(viewport.element);
    hook.result.current.contentRef(document.createElement('div'));
  });
  act(() => viewport.scrollTo(250));
  expect(hook.result.current.isPinned()).toBe(false);
  return { viewport, pin: () => hook.result.current };
}

beforeEach(() => {
  localStorage.clear();
  useComposerSegments.setState({ byThread: {} });
});
afterEach(() => vi.clearAllMocks());

describe('composer submit re-pins the transcript', () => {
  it('jumps a reader who scrolled up to the end when they send from the composer', async () => {
    const rig = makeController();
    const { viewport, pin } = mountScrolledUpPin();
    render(<Harness ctrl={rig.ctrl} />);
    const field = await findField();

    typeInto(field, 'hello there');
    pressKey(field, 'Enter');

    await waitFor(() => expect(rig.acpClient.promptCalls).toHaveLength(1));
    expect(viewport.element.scrollTop).toBe(900);
    expect(pin().isPinned()).toBe(true);
  });

  it('leaves the reader where they are when an agent-sent prompt arrives', async () => {
    const rig = makeController();
    await rig.ctrl.load();
    const { viewport, pin } = mountScrolledUpPin();

    // Another agent's prompt, or one the daemon dispatches itself, is a transcript update, not a user send.
    act(() => rig.acpClient.emitUpdate(CHAT_ID, userMessageUpdate('m1', 'prompt from another agent')));
    await act(async () => {
      await Promise.resolve();
    });

    expect(viewport.element.scrollTop).toBe(250);
    expect(pin().isPinned()).toBe(false);
  });
});
