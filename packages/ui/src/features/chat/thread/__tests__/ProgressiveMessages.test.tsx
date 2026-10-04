/**
 * `ProgressiveMessages` — a long transcript mounts its tail first and reveals
 * the rest in deferred batches; short transcripts and live appends mount at
 * once. jsdom has no `requestIdleCallback`, so reveals run on the (faked)
 * `setTimeout` fallback and are stepped explicitly; the assistant-ui store
 * still flushes on a real `setImmediate` tick.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  useAuiState,
  useExternalStoreRuntime,
  type ExportedMessageRepository as Repository,
  type ThreadMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { INITIAL_WINDOW, ProgressiveMessages, REVEAL_STEP } from '../ProgressiveMessages';

function Message() {
  const id = useAuiState((s) => s.message.id);
  return <div data-testid="msg" data-id={id} />;
}

const components = { AssistantMessage: Message, UserMessage: Message };

function Harness({ repository }: { repository: Repository }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messageRepository: repository,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ProgressiveMessages components={components} />
    </AssistantRuntimeProvider>
  );
}

function transcript(count: number): Repository {
  const likes: ThreadMessageLike[] = Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: [{ type: 'text', text: `message ${index}` }],
  }));
  return ExportedMessageRepository.fromArray(likes);
}

const flush = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));
const revealNext = async () => {
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  await flush();
};

function renderedIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-testid="msg"]')].map((node) => node.getAttribute('data-id')!);
}

describe('ProgressiveMessages', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts a short transcript in full at once', async () => {
    const view = render(<Harness repository={transcript(INITIAL_WINDOW)} />);
    await flush();
    expect(renderedIds(view.container)).toHaveLength(INITIAL_WINDOW);
  });

  it('mounts the newest window first, then reveals older messages in batches until all are mounted', async () => {
    const total = INITIAL_WINDOW + REVEAL_STEP + 5;
    const view = render(<Harness repository={transcript(total)} />);
    await flush();
    const first = renderedIds(view.container);
    expect(first).toHaveLength(INITIAL_WINDOW);
    expect(first[0]).toBe(`m${total - INITIAL_WINDOW}`);
    expect(first[first.length - 1]).toBe(`m${total - 1}`);

    await revealNext();
    expect(renderedIds(view.container)).toHaveLength(INITIAL_WINDOW + REVEAL_STEP);
    await revealNext();
    const all = renderedIds(view.container);
    expect(all).toHaveLength(total);
    expect(all[0]).toBe('m0');
  });

  it('re-engages the window when a bulk publish lands on an empty thread', async () => {
    const total = INITIAL_WINDOW * 3;
    const view = render(<Harness repository={transcript(0)} />);
    await flush();
    expect(renderedIds(view.container)).toHaveLength(0);

    view.rerender(<Harness repository={transcript(total)} />);
    await flush();
    expect(renderedIds(view.container)).toHaveLength(INITIAL_WINDOW);
    await revealNext();
    expect(renderedIds(view.container)).toHaveLength(total);
  });

  it('appends live messages immediately once the transcript is fully mounted', async () => {
    const view = render(<Harness repository={transcript(INITIAL_WINDOW)} />);
    await flush();
    view.rerender(<Harness repository={transcript(INITIAL_WINDOW + 3)} />);
    await flush();
    expect(renderedIds(view.container)).toHaveLength(INITIAL_WINDOW + 3);
  });
});
