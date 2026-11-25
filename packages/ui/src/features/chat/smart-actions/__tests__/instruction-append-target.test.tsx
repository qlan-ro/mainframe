/**
 * "Add to composer" writes into the chat the chip is in. Real assistant-ui
 * composers: the conversation's, and a workspace tab's own `ExternalThread`,
 * built the way `use-conversation-thread` builds it.
 */
import { useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  AuiConfig,
  AuiProvider,
  ComposerPrimitive,
  ExternalThread,
  ReadonlyThreadProvider,
  useAui,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('../../runtime/chat-extras', () => ({ useChatExtras: () => undefined }));
vi.mock('@/features/sessions/new-thread/use-open-new-thread-draft', () => ({ useOpenNewThreadDraft: () => vi.fn() }));

import { TooltipProvider } from '@/components/ui/tooltip';
import { ThreadComposerProvider } from '../../composer/thread-composer';
import { InstructionChip } from '../InstructionChip';

const NO_MESSAGES: ThreadMessage[] = [];

function Chat({ name, nested }: { name: string; nested?: boolean }) {
  const chip = <InstructionChip target={{ token: '/review', insertText: `/review ${name}` }} />;
  return (
    <ThreadComposerProvider>
      <section aria-label={name}>
        {/* A sub-agent's transcript inside the chat's own has a thread, and no composer. */}
        {nested ? <ReadonlyThreadProvider messages={NO_MESSAGES}>{chip}</ReadonlyThreadProvider> : chip}
        <ComposerPrimitive.Root>
          <ComposerPrimitive.Input data-mf-composer-input="" aria-label={`Message ${name}`} />
        </ComposerPrimitive.Root>
      </section>
    </ThreadComposerProvider>
  );
}

function Tab({ name, nested }: { name: string; nested?: boolean }) {
  const aui = useAui();
  const config = useMemo(
    () => AuiConfig({ thread: ExternalThread({ messages: NO_MESSAGES, isRunning: false, onNew: () => undefined }) }),
    [],
  );
  return (
    <div data-conversation-tab="active">
      <AuiProvider extends={aui} config={config}>
        <Chat name={name} nested={nested} />
      </AuiProvider>
    </div>
  );
}

function App({ nested }: { nested?: boolean }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ messages: NO_MESSAGES, onNew: async () => undefined });
  return (
    <TooltipProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <Chat name="column" nested={nested} />
        <Tab name="fork" nested={nested} />
        <Tab name="task" nested={nested} />
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}

const field = (name: string) => screen.getByLabelText<HTMLTextAreaElement>(`Message ${name}`);
const press = (name: string) =>
  fireEvent.click(
    screen.getByRole('region', { name }).querySelector<HTMLElement>('[data-testid="smart-action-instruction-append"]')!,
  );

it.each([false, true])('writes into the chip’s own chat and moves the caret there (nested: %s)', async (nested) => {
  render(<App nested={nested} />);
  for (const name of ['fork', 'column', 'task']) {
    press(name);
    expect(document.activeElement).toBe(field(name));
  }
  for (const name of ['column', 'fork', 'task'])
    await vi.waitFor(() => expect(field(name).value).toBe(`/review ${name}`));
});
