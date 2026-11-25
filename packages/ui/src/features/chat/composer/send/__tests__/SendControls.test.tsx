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
    }),
}));

let mockCanSubmit = false;
vi.mock('../../segments/use-submit-composition', () => ({ useCanSubmit: () => mockCanSubmit }));

const stop = vi.fn();
let mockStop = { available: false, stopping: false, target: 'the turn', stop };
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
  mockStop = { available: false, stopping: false, target: 'the turn', stop };
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
    mockStop = { available: true, stopping: false, target: 'the turn and 2 sub-agents', stop };
  });

  it('names what it will stop, and stops on click', () => {
    renderControls();

    const button = screen.getByTestId('chat-composer-cancel');
    expect(button).toHaveAttribute('aria-label', 'Stop the turn and 2 sub-agents');
    fireEvent.click(button);
    expect(stop).toHaveBeenCalledTimes(1);
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
    const stops = { column: vi.fn(), beside: vi.fn(), hidden: vi.fn() };
    const composer = (name: keyof typeof stops) => {
      mockStop = { ...mockStop, stop: stops[name] };
      return { name, controls: render(<StopControl />, { wrapper: TooltipProvider }).container };
    };
    /** The chat column, a chat tab in front, a chat tab behind it, an agent tab, and a file. */
    function layout(...names: (keyof typeof stops)[]) {
      for (const { name, controls } of names.map(composer)) {
        const field = controls.appendChild(document.createElement('textarea'));
        field.id = name;
        if (name !== 'column') controls.dataset.conversationTab = name === 'hidden' ? 'hidden' : 'active';
      }
      const { container: agent } = render(<button>Agent steps</button>);
      agent.dataset.conversationTab = 'active';
      render(<button>File</button>);
    }
    const press = () => (shortcut.mock.lastCall![1] as () => void)();
    const stopped = () => Object.entries(stops).flatMap(([name, fn]) => (fn.mock.calls.length ? [name] : []));
    const at = (id: string) => document.getElementById(id)!.focus();

    it.each([['column'], ['beside'], ['hidden']] as const)('stops the conversation the keyboard is in: %s', (name) => {
      layout('hidden', 'column', 'beside');
      expect(shortcut).toHaveBeenLastCalledWith('chat.stop', expect.any(Function));
      at(name);
      press();
      expect(stopped()).toEqual([name]);
      expect(stops[name]).toHaveBeenCalledTimes(1);
    });

    it('stops the chat column’s from anywhere else', () => {
      layout('beside', 'column');
      screen.getByText('File').focus();
      press();
      expect(stopped()).toEqual(['column']);
    });

    it('stops nothing from an agent tab, which has no composer', () => {
      layout('beside', 'column');
      screen.getByText('Agent steps').focus();
      press();
      expect(stopped()).toEqual([]);
    });

    it('stops nothing once its composer is gone', () => {
      composer('column');
      cleanup();
      press();
      expect(stopped()).toEqual([]);
    });
  });

  it('with sub-agents running but no turn, Stop sits beside plain Send', () => {
    mockRunning = false;
    mockCanSubmit = true;
    mockStop = { available: true, stopping: false, target: '2 sub-agents', stop };
    renderControls();

    expect(screen.getByTestId('chat-composer-cancel')).toHaveAttribute('aria-label', 'Stop 2 sub-agents');
    expect(screen.getByTestId('chat-composer-send')).toBeEnabled();
    expect(screen.queryByTestId('chat-composer-send-running')).toBeNull();
  });

  it('with sub-agents running, no turn and an empty draft, only Stop shows', () => {
    mockRunning = false;
    mockStop = { available: true, stopping: false, target: '2 sub-agents', stop };
    renderControls();

    expect(screen.getByTestId('chat-composer-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-composer-send')).toBeNull();
  });
});

describe('SendControls — the Queue / Steer split while a turn runs', () => {
  beforeEach(() => {
    mockRunning = true;
    mockCanSubmit = true;
    mockStop = { available: true, stopping: false, target: 'the turn', stop };
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
