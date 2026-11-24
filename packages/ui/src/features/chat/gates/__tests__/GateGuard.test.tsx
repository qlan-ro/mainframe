/**
 * One press never answers two requests. The queue moves on the moment a gate is
 * answered, so the next one, which may belong to another chat, appears under
 * the same pointer: the second press of a double-click must not reach it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';

vi.mock('../use-gate-queue', () => ({ useGateQueue: vi.fn() }));
vi.mock('../DelegatedGateProbes', () => ({ DelegatedGateProbes: () => null }));
import { useGateQueue, type PendingGate } from '../use-gate-queue';
import { ChatGateMount } from '../ChatGateMount';

const ownReply = vi.fn().mockResolvedValue(undefined);
const taskReply = vi.fn().mockResolvedValue(undefined);

function gate(chatId: string, requestId: string, reply: typeof ownReply): PendingGate {
  const entry: ChatPermissionEntry = {
    requestId,
    askedAt: 1,
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
    ],
    request: { requestId, toolName: 'Bash', toolUseId: requestId, input: { command: requestId }, suggestions: [] },
  };
  return { key: `${chatId}:${requestId}`, chatId, entry, reply, adapterId: 'claude', mode: undefined, from: null };
}

const OWN = gate('chat-1', 'own', ownReply);
const DELEGATED = gate('task-chat', 'task', taskReply);

function show(front: PendingGate) {
  vi.mocked(useGateQueue).mockReturnValue({ front, more: 0, waitingCalls: new Set() });
}

/** A new element each time: the same one would let React skip the render. */
const ui = () => (
  <TooltipProvider>
    <ChatGateMount />
  </TooltipProvider>
);

const allow = () => screen.getByTestId('chat-permission-option-allow-once');
const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/** A pointer click as a browser sends it. */
function press(element: HTMLElement, detail = 1) {
  fireEvent.pointerDown(element);
  fireEvent.mouseDown(element, { detail });
  fireEvent.pointerUp(element);
  fireEvent.mouseUp(element, { detail });
  fireEvent.click(element, { detail });
}

/** Enter on a button: it clicks on keydown, with no pointer. */
function enter(element: HTMLElement, { repeat = false } = {}) {
  if (fireEvent.keyDown(element, { key: 'Enter', repeat })) fireEvent.click(element, { detail: 0 });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  ownReply.mockResolvedValue(undefined);
  taskReply.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

/** The session's own gate, armed, answered; the task's is up in its place. */
function answerOwnThenShowTask(answer: () => void) {
  show(OWN);
  const { rerender } = render(ui());
  pass(500);
  answer();
  expect(ownReply).toHaveBeenCalledTimes(1);
  show(DELEGATED);
  rerender(ui());
  expect(screen.getByTestId('chat-permission-command')).toHaveTextContent('task');
}

describe('a double-click', () => {
  it('answers the first request only: the second press lands on a gate that is not armed', () => {
    answerOwnThenShowTask(() => press(allow()));

    press(allow(), 2);

    expect(taskReply).not.toHaveBeenCalled();
  });

  it('still does nothing just before the gate arms', () => {
    answerOwnThenShowTask(() => press(allow()));
    pass(499);

    press(allow());

    expect(taskReply).not.toHaveBeenCalled();
  });

  it('a fresh press after that answers it', () => {
    answerOwnThenShowTask(() => press(allow()));
    pass(500);

    press(allow());

    expect(taskReply).toHaveBeenCalledTimes(1);
  });

  it('sends one answer when both presses land on the same gate', () => {
    show(OWN);
    render(ui());
    pass(500);

    press(allow());
    press(allow(), 2);

    expect(ownReply).toHaveBeenCalledTimes(1);
  });
});

describe('a press that began on the previous gate', () => {
  it('cannot finish on this one, however long it is held', () => {
    answerOwnThenShowTask(() => press(allow()));
    pass(5_000);

    // Only the release and its click: the pointer went down before this gate was up.
    fireEvent.pointerUp(allow());
    fireEvent.click(allow(), { detail: 1 });

    expect(taskReply).not.toHaveBeenCalled();
  });

  it('a held Enter cannot either', () => {
    answerOwnThenShowTask(() => enter(allow()));
    pass(5_000);

    enter(allow(), { repeat: true });

    expect(taskReply).not.toHaveBeenCalled();
  });
});

describe('the keyboard', () => {
  it('a second Enter right after the first answers nothing', () => {
    answerOwnThenShowTask(() => enter(allow()));

    enter(allow());

    expect(taskReply).not.toHaveBeenCalled();
  });

  it('a fresh Enter once armed answers it', () => {
    answerOwnThenShowTask(() => enter(allow()));
    fireEvent.keyUp(window, { key: 'Enter' });
    pass(500);

    enter(allow());

    expect(taskReply).toHaveBeenCalledTimes(1);
  });

  it('Enter typed in the composer does not lock the gate', () => {
    answerOwnThenShowTask(() => press(allow()));
    pass(500);
    fireEvent.keyDown(document.body, { key: 'Enter' });

    enter(allow());

    expect(taskReply).toHaveBeenCalledTimes(1);
  });

  it('is out of the gate altogether while it arms', () => {
    show(OWN);
    render(ui());

    expect(screen.getByTestId('chat-gate-guard')).toHaveAttribute('inert');
    pass(500);
    expect(screen.getByTestId('chat-gate-guard')).not.toHaveAttribute('inert');
  });
});

it('the same request id in another chat is another gate', () => {
  show(gate('chat-1', 'same', ownReply));
  const { rerender } = render(ui());
  pass(500);
  show(gate('task-chat', 'same', taskReply));
  rerender(ui());

  press(allow());

  expect(taskReply).not.toHaveBeenCalled();
});

it('an answer that failed gives the gate back', async () => {
  ownReply.mockRejectedValueOnce(new Error('offline'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  show(OWN);
  render(ui());
  pass(500);

  press(allow());
  await act(async () => {});
  press(allow());

  expect(ownReply).toHaveBeenCalledTimes(2);
});
