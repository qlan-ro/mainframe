/**
 * SendControls (C8, C9) — Send when idle; Stop while anything runs; Stop plus
 * the Queue / Steer split once there is something to send into a running turn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiPrefs } from '@/store/ui-prefs';
import { resetAdapters, seedAdapters } from '@/store/adapters';

let mockRunning = false;
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (s: unknown) => unknown) =>
    select({
      thread: { isRunning: mockRunning },
      threadListItem: { id: 't1' },
    }),
}));

let mockCanSubmit = false;
vi.mock('../../segments/use-submit-composition', () => ({ useCanSubmit: () => mockCanSubmit }));

const stop = vi.fn();
let mockStop = { available: false, running: false, stopping: false, target: 'the turn', stop };
vi.mock('../use-stop', () => ({ useComposerStop: () => mockStop }));

const shortcut = vi.fn();
vi.mock('@/features/shortcuts/action-store', () => ({
  useShortcutAction: (id: string, fn: () => void) => shortcut(id, fn),
}));

let mockAdapterId = 'claude';
vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtrasSelector: (select: (extras: unknown) => unknown) =>
    select({ state: { chatConfig: { adapterId: mockAdapterId } } }),
}));

import { useDraftContent, type NewDraftItem } from '../../draft-content/draft-content-store';
import { SendControls, StopControl } from '../SendControls';

const submit = vi.fn();
const renderControls = () =>
  render(
    <TooltipProvider>
      <SendControls submit={submit} />
    </TooltipProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useUiPrefs.setState({ enterWhileRunning: 'queue' });
  mockRunning = false;
  mockCanSubmit = false;
  mockStop = { available: false, running: false, stopping: false, target: 'the turn', stop };
  mockAdapterId = 'claude';
  resetAdapters();
  seedAdapters([
    {
      id: 'claude',
      name: 'Claude',
      description: '',
      installed: true,
      models: [],
      capabilities: { planMode: false, steer: true },
    },
    { id: 'codex', name: 'Codex', description: '', installed: true, models: [], capabilities: { planMode: false } },
  ]);
});

describe('SendControls — idle', () => {
  it('shows a disabled Send with an empty draft, and no Stop', () => {
    renderControls();

    expect(screen.getByTestId('chat-composer-send')).toBeDisabled();
    expect(screen.queryByTestId('chat-composer-cancel')).toBeNull();
  });

  it('enables Send once there is something to send', () => {
    mockCanSubmit = true;
    renderControls();

    const send = screen.getByTestId('chat-composer-send');
    expect(send).toBeEnabled();
    expect(send).toHaveAttribute('type', 'submit');
    expect(send).toHaveAttribute('aria-label', 'Send');
  });

  it('shows no split while idle, even with text', () => {
    mockCanSubmit = true;
    renderControls();

    expect(screen.queryByTestId('chat-composer-send-running')).toBeNull();
  });
});

describe('SendControls — Stop', () => {
  beforeEach(() => {
    mockRunning = true;
    mockStop = { available: true, running: true, stopping: false, target: 'the turn and 2 sub-agents', stop };
  });

  it('names what it will stop, and stops on click', () => {
    renderControls();

    const button = screen.getByTestId('chat-composer-cancel');
    expect(button).toHaveAttribute('aria-label', 'Stop the turn and 2 sub-agents');
    fireEvent.click(button);
    expect(stop).toHaveBeenCalledExactlyOnceWith(button);
  });

  it('shows no Send while the turn runs and nothing is typed', () => {
    renderControls();

    expect(screen.queryByTestId('chat-composer-send')).toBeNull();
    expect(screen.queryByTestId('chat-composer-send-running')).toBeNull();
  });

  it('shows a disabled "Stopping" state once the run is cancelling', () => {
    mockStop = { ...mockStop, stopping: true };
    renderControls();

    const button = screen.getByTestId('chat-composer-cancel');
    expect(button).toHaveAttribute('aria-label', 'Stopping');
    expect(button).toHaveAttribute('data-stopping', 'true');
    expect(button).toBeDisabled();
  });

  describe('⌘. (chat.stop)', () => {
    const press = () => (shortcut.mock.lastCall![1] as () => void)();

    it('stops what runs now, not what ran when the composer opened, and leaves the keyboard here', () => {
      const view = render(<StopControl />, { wrapper: TooltipProvider });
      const now = vi.fn();
      mockStop = { ...mockStop, stop: now };
      view.rerender(<StopControl />);
      press();
      expect(stop).not.toHaveBeenCalled();
      expect(now).toHaveBeenCalledExactlyOnceWith(expect.any(HTMLSpanElement));
      expect(view.container).toContainElement(now.mock.lastCall![0] as HTMLElement);
    });

    it('is not for sub-agents alone, unless the conversation has had the focus', () => {
      mockStop = { ...mockStop, running: false };
      renderControls();
      press();
      expect(stop).not.toHaveBeenCalled();
    });

    it('stops nothing once its composer is gone', () => {
      renderControls();
      cleanup();
      press();
      expect(stop).not.toHaveBeenCalled();
    });
  });

  it('with sub-agents running but no turn, Stop sits beside plain Send', () => {
    mockRunning = false;
    mockCanSubmit = true;
    mockStop = { available: true, running: false, stopping: false, target: '2 sub-agents', stop };
    renderControls();

    expect(screen.getByTestId('chat-composer-cancel')).toHaveAttribute('aria-label', 'Stop 2 sub-agents');
    expect(screen.getByTestId('chat-composer-send')).toBeEnabled();
    expect(screen.queryByTestId('chat-composer-send-running')).toBeNull();
  });

  it('with sub-agents running, no turn and an empty draft, only Stop shows', () => {
    mockRunning = false;
    mockStop = { available: true, running: false, stopping: false, target: '2 sub-agents', stop };
    renderControls();

    expect(screen.getByTestId('chat-composer-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-composer-send')).toBeNull();
  });
});

describe('SendControls — the Queue / Steer split while a turn runs', () => {
  beforeEach(() => {
    mockRunning = true;
    mockCanSubmit = true;
    mockStop = { available: true, running: true, stopping: false, target: 'the turn', stop };
  });

  it('appears beside Stop once there is text', () => {
    renderControls();

    expect(screen.getByTestId('chat-composer-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('chat-composer-send-running')).toBeInTheDocument();
    expect(screen.getByTestId('chat-composer-send-options')).toBeInTheDocument();
  });

  it('is not shown while stopping', () => {
    mockStop = { ...mockStop, stopping: true };
    renderControls();

    expect(screen.queryByTestId('chat-composer-send-running')).toBeNull();
  });

  it('defaults to Queue: the main half queues', () => {
    renderControls();

    const main = screen.getByTestId('chat-composer-send-running');
    expect(main).toHaveAttribute('aria-label', 'Queue message');
    expect(main).toHaveTextContent('Queue');
    fireEvent.click(main);
    expect(submit).toHaveBeenCalledExactlyOnceWith('queue');
  });

  it('follows the Enter preference: with Steer chosen the main half steers', () => {
    useUiPrefs.setState({ enterWhileRunning: 'steer' });
    renderControls();

    const main = screen.getByTestId('chat-composer-send-running');
    expect(main).toHaveAttribute('aria-label', 'Steer: add to the running turn');
    expect(main).toHaveTextContent('Steer');
    fireEvent.click(main);
    expect(submit).toHaveBeenCalledExactlyOnceWith('steer');
  });

  it('its menu offers Queue and Steer, with ↵ on the preferred one and ⌥↵ on the other', async () => {
    renderControls();

    fireEvent.pointerDown(screen.getByTestId('chat-composer-send-options'), { button: 0 });
    const queue = await screen.findByTestId('chat-composer-send-queue');
    const steer = screen.getByTestId('chat-composer-send-steer');

    expect(queue).toHaveTextContent('Queue');
    expect(queue).toHaveTextContent('Send when the agent finishes');
    expect(queue).toHaveTextContent('↵');
    expect(steer).toHaveTextContent('Add to the running turn without stopping it');
    expect(steer).toHaveTextContent('⌥↵');
  });

  it('choosing Steer in the menu steers, whatever the preference', async () => {
    renderControls();

    fireEvent.pointerDown(screen.getByTestId('chat-composer-send-options'), { button: 0 });
    fireEvent.click(await screen.findByTestId('chat-composer-send-steer'));

    expect(submit).toHaveBeenCalledExactlyOnceWith('steer');
  });

  it('choosing Queue in the menu queues, whatever the preference', async () => {
    useUiPrefs.setState({ enterWhileRunning: 'steer' });
    renderControls();

    fireEvent.pointerDown(screen.getByTestId('chat-composer-send-options'), { button: 0 });
    fireEvent.click(await screen.findByTestId('chat-composer-send-queue'));

    expect(submit).toHaveBeenCalledExactlyOnceWith('queue');
  });

  it('says Steer will queue when the agent cannot take messages mid-turn', async () => {
    mockAdapterId = 'codex';
    renderControls();

    fireEvent.pointerDown(screen.getByTestId('chat-composer-send-options'), { button: 0 });
    const steer = await screen.findByTestId('chat-composer-send-steer');

    expect(steer).toHaveTextContent('This agent can’t take messages mid-turn, so it will queue');
    expect(steer).not.toHaveTextContent('Add to the running turn without stopping it');
  });

  it('keeps the plain Steer copy for an agent that can steer', async () => {
    renderControls();

    fireEvent.pointerDown(screen.getByTestId('chat-composer-send-options'), { button: 0 });

    expect(await screen.findByTestId('chat-composer-send-steer')).not.toHaveTextContent('can’t take messages');
  });
});

describe('SendControls — what Steer says about captures', () => {
  const capture: NewDraftItem = {
    kind: 'capture',
    type: 'screenshot',
    imageDataUrl: 'data:image/png;base64,A',
    note: '',
  };
  const code: NewDraftItem = { kind: 'code', filePath: 'a.ts', startLine: 1, endLine: 1, lineContent: 'x', note: '' };
  const steerRow = async (item: NewDraftItem) => {
    useDraftContent.setState({ byThread: {} });
    useDraftContent.getState().add('t1', [item]);
    mockRunning = true;
    mockCanSubmit = true;
    renderControls();
    fireEvent.pointerDown(screen.getByTestId('chat-composer-send-options'), { button: 0, ctrlKey: false });
    return screen.findByTestId('chat-composer-send-steer');
  };

  it('queues with a capture, which is sent as a file', async () => {
    expect(await steerRow(capture)).toHaveTextContent('A message with files queues');
  });

  it('steers with a code annotation, which is text', async () => {
    expect(await steerRow(code)).toHaveTextContent('Add to the running turn without stopping it');
  });
});
