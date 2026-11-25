import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  AuiConfig,
  AuiProvider,
  ExternalThread,
  useAui,
  useAuiState,
  useLocalRuntime,
} from '@assistant-ui/react';
import { expect, it, vi } from 'vitest';
import type { AcpChatController } from '../../controller/acp-chat-controller';
import { ComposerSurface } from '../../composer/segments/submitted-draft';
import { useSubmitComposition } from '../../composer/segments/use-submit-composition';
import { SideChatScopeProvider } from '@/features/side-chat/side-chat-scope';
import { sendFromComposer } from '../send-from-composer';

function DraftControls() {
  const aui = useAui();
  const submit = useSubmitComposition();
  const text = useAuiState((s) => s.composer.text);
  const files = useAuiState((s) => s.composer.attachments.map(({ name }) => name).join(','));
  return (
    <>
      <textarea aria-label="Draft" value={text} onChange={(ev) => aui.composer.setText(ev.currentTarget.value)} />
      <output>{files}</output>
      <button
        type="button"
        onClick={() => {
          void aui.composer.addAttachment({
            id: 'first-file',
            type: 'document',
            name: 'sample.txt',
            content: [{ type: 'text', text: 'sample' }],
          });
        }}
      >
        Attach
      </button>
      <button type="button" onClick={() => submit()}>
        Send
      </button>
    </>
  );
}

it.each(['tab', 'side'] as const)(
  'restores the submitted text and file in the %s composer after a refused send',
  async (surface) => {
    let refuse: (error: Error) => void = () => {};
    const sendMessage = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const controller = { sendMessage, markAttachmentsRestoredForFailure: vi.fn() } as unknown as AcpChatController;
    const config = AuiConfig({
      thread: ExternalThread({
        messages: [],
        onNew: (message) => {
          void sendFromComposer(controller, message);
        },
      }),
    });

    function ScopedDraft() {
      const aui = useAui();
      return (
        <AuiProvider config={config} extends={aui}>
          {surface === 'side' ? (
            <SideChatScopeProvider value={{ parentChatId: 'parent', sideChatId: 'side-chat' }}>
              <DraftControls />
            </SideChatScopeProvider>
          ) : (
            <ComposerSurface.Provider value="tab">
              <DraftControls />
            </ComposerSurface.Provider>
          )}
        </AuiProvider>
      );
    }

    function Fixture() {
      const runtime = useLocalRuntime({ run: async () => ({ content: [] }) });
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <ScopedDraft />
        </AssistantRuntimeProvider>
      );
    }

    render(<Fixture />);
    const input = screen.getByRole('textbox', { name: 'Draft' });
    await act(async () => {
      fireEvent.change(input, { target: { value: 'draft' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    });
    expect(await screen.findByText('sample.txt')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(input).toHaveValue('');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'newer' } });
    });
    await act(async () => refuse(new Error('Send failed')));
    expect(input).toHaveValue('draft\n\nnewer');
    expect(screen.getByText('sample.txt')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  },
);
