/**
 * DraftKeeper — an unsent message survives its tab. Run against the real
 * assistant-ui composer: the tab's own `ExternalThread`, inside a root runtime,
 * the way `use-conversation-thread` builds it.
 */
import { useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  AuiConfig,
  AuiProvider,
  ComposerPrimitive,
  ExternalThread,
  useAui,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { handoffDraft, takeStash } from '@/features/chat/runtime/draft-stash';
import { CHAT_ATTACHMENT_ADAPTER } from '@/features/chat/runtime/use-chat-thread-runtime';
import { DraftKeeper } from '../DraftKeeper';

const NO_MESSAGES: ThreadMessage[] = [];
let addFile: (file: File) => Promise<void> = async () => undefined;

function Grab() {
  const aui = useAui();
  addFile = async (file) => {
    await aui.thread.composer().addAttachment(file);
  };
  return null;
}

function Tab({ chatId }: { chatId: string }) {
  const aui = useAui();
  const config = useMemo(
    () =>
      AuiConfig({
        thread: ExternalThread({
          messages: NO_MESSAGES,
          isRunning: false,
          onNew: () => undefined,
          attachmentAdapter: CHAT_ATTACHMENT_ADAPTER,
        }),
      }),
    [],
  );
  return (
    <AuiProvider extends={aui} config={config}>
      <DraftKeeper chatId={chatId} />
      <Grab />
      <ComposerPrimitive.Root>
        <ComposerPrimitive.Input aria-label="Message" />
      </ComposerPrimitive.Root>
    </AuiProvider>
  );
}

function App({ chatId }: { chatId: string | null }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ messages: NO_MESSAGES, onNew: async () => undefined });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {chatId && <Tab key={chatId} chatId={chatId} />}
    </AssistantRuntimeProvider>
  );
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>('Message');
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

afterEach(() => {
  cleanup(); // the unmount stashes what was typed
  takeStash('chat-1');
  takeStash('chat-2');
});

describe('DraftKeeper', () => {
  it('brings an unsent message back when the tab is opened again', async () => {
    const { rerender } = render(<App chatId="chat-1" />);
    type('half a thought');
    rerender(<App chatId={null} />);
    expect(screen.queryByLabelText('Message')).toBeNull();

    rerender(<App chatId="chat-1" />);

    await waitFor(() => expect(field().value).toBe('half a thought'));
  });

  it('leaves it for the chat column, with its files', async () => {
    const { rerender } = render(<App chatId="chat-1" />);
    type('see the log');
    const file = new File(['line'], 'build.log', { type: 'text/plain' });
    await act(() => addFile(file));

    rerender(<App chatId={null} />);

    const draft = takeStash('chat-1');
    expect(draft?.text).toBe('see the log');
    expect(draft?.attachments.map((f) => f.name)).toEqual(['build.log']);
  });

  it('keeps each chat’s own', async () => {
    const { rerender } = render(<App chatId="chat-1" />);
    type('for the first');
    rerender(<App chatId="chat-2" />);
    expect(field().value).toBe('');
    type('for the second');

    rerender(<App chatId="chat-1" />);

    await waitFor(() => expect(field().value).toBe('for the first'));
    expect(takeStash('chat-2')?.text).toBe('for the second');
  });

  it('takes a draft the chat column hands over after the tab opened', async () => {
    render(<App chatId="chat-1" />);
    expect(field().value).toBe('');

    act(() => handoffDraft('chat-1', { text: 'typed in the column', attachments: [] }));

    await waitFor(() => expect(field().value).toBe('typed in the column'));
  });

  it('keeps both when the user typed before it arrived', async () => {
    render(<App chatId="chat-1" />);
    type('typed here');

    act(() => handoffDraft('chat-1', { text: 'typed in the column', attachments: [] }));

    await waitFor(() => expect(field().value).toBe('typed here\n\ntyped in the column'));
  });

  it('takes one that arrives after another was restored', async () => {
    handoffDraft('chat-1', { text: 'first', attachments: [] });
    render(<App chatId="chat-1" />);
    await waitFor(() => expect(field().value).toBe('first'));

    act(() => handoffDraft('chat-1', { text: 'second', attachments: [] }));

    await waitFor(() => expect(field().value).toBe('first\n\nsecond'));
  });

  it('leaves nothing behind for a message that was cleared', () => {
    const { rerender } = render(<App chatId="chat-1" />);
    type('never mind');
    type('');
    rerender(<App chatId={null} />);
    expect(takeStash('chat-1')).toBeUndefined();
  });
});
