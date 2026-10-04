import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, finalMessage, turnMessage, turnSource } from './turn-fixtures';
import { turnTool } from './turn-test-support';

beforeEach(() => useUiPrefs.getState().setTranscriptMode('compact'));
it('keeps one full native copy scope for mixed UTF16 work/final slices in both modes', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const prefix = 'Working 🛠️\n\n';
  const text = prefix + 'Answer 😀e\u0301';
  const messages = [
    turnMessage('mixed', text, {}, [
      turnSource('work', 0, prefix.length),
      turnSource('final', prefix.length, text.length, { phase: 'final_answer', finalEligible: true }),
    ]),
  ];
  render(<TurnFixture rootId="mixed-copy" messages={messages} />);
  expect(screen.getByText('Answer 😀e\u0301')).toBeVisible();
  expect(screen.queryByText('Working 🛠️')).toBeNull();
  expect(screen.getAllByTestId('chat-message-copy')).toHaveLength(1);
  fireEvent.click(screen.getByTestId('chat-message-copy'));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(text));
  act(() => useUiPrefs.getState().setTranscriptMode('verbose'));
  expect(await screen.findByText('Working 🛠️')).toBeVisible();
  expect(screen.getAllByTestId('chat-message-copy')).toHaveLength(1);
  fireEvent.click(screen.getByTestId('chat-message-copy'));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(text));
  act(() => useUiPrefs.getState().setTranscriptMode('compact'));
  expect(await screen.findByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'false');
});
it('suppresses duplicate duration only for a matching authoritative interval and keeps cost accessible', async () => {
  const timing = { startedAtMs: 1000, completedAtMs: 3000, durationMs: 2000 };
  const original = finalMessage({ timing });
  const final = {
    ...original,
    metadata: {
      ...original.metadata,
      timing: { totalStreamTime: 2000, streamStartTime: 1000, totalChunks: 1, toolCallCount: 0 },
      custom: { mainframe: { ...original.metadata.custom.mainframe, cost: 0.012 } },
    },
  };
  const view = render(<TurnFixture rootId="timing" messages={[turnMessage('work', 'Work', { timing }), final]} />);
  // D18: the disclosure's accessible name is the static "Work details" — the
  // elapsed text is visible content, not part of the name.
  expect(screen.getByRole('button', { name: 'Work details' })).toHaveTextContent('Worked for 2.00s');
  expect(screen.getByRole('button', { name: 'Message cost' })).toHaveTextContent('$0.012');
  expect(screen.queryByRole('button', { name: 'Message timing' })).toBeNull();
  view.rerender(
    <TurnFixture
      rootId="timing"
      messages={[
        turnMessage('work', 'Work'),
        { ...final, metadata: { ...final.metadata, timing: { ...final.metadata.timing, totalStreamTime: 2500 } } },
      ]}
    />,
  );
  expect(await screen.findByRole('button', { name: 'Message timing' })).toBeVisible();
});
it('preserves a manually collapsed work choice when a tool reports failure', async () => {
  const view = render(<TurnFixture rootId="failed-card" messages={[turnTool(), finalMessage()]} />);
  const toggle = screen.getByRole('button', { name: 'Work details' });
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  view.rerender(
    <TurnFixture
      rootId="failed-card"
      messages={[
        turnTool('tool', { isError: true, providerMetadata: { mainframe: { acpStatus: 'failed' } } }),
        finalMessage(),
      ]}
    />,
  );
  await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
  expect(toggle).toBeEnabled();
  expect(screen.queryByLabelText('failed')).toBeNull();
  fireEvent.click(toggle);
  fireEvent.click(await screen.findByRole('button', { name: 'Read files' }));
  expect(await screen.findByLabelText('failed')).toBeVisible();
});
it('D18: no live clock while running; shows "Worked for X" only once the turn settles', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const timing = { startedAtMs: 8000 };
  const view = render(
    <TurnFixture
      rootId="clock"
      messages={[turnMessage('work', 'Work', { state: 'running', timing }), finalMessage({ state: 'running', timing })]}
    />,
  );
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
  const node = view.container.querySelector('[data-message-id="final"] [data-text-part]');
  // While running: the disclosure's name is the static "Work details" and it
  // carries no elapsed text at all — the footer's status line is the one
  // live timer now, not this one.
  expect(screen.getByRole('button', { name: 'Work details' })).not.toHaveTextContent(/\d/);

  // The passage of time alone must not reveal a clock — there is no ticking
  // left here to drive one (D18 suppresses it explicitly).
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(screen.getByRole('button', { name: 'Work details' })).not.toHaveTextContent(/\d/);

  // Settling the turn (a real message change, not a tick) reveals the duration,
  // without remounting the final answer's text node.
  const settled = { startedAtMs: 8000, completedAtMs: 10000, durationMs: 2000 };
  view.rerender(
    <TurnFixture
      rootId="clock"
      messages={[turnMessage('work', 'Work', { timing: settled }), finalMessage({ timing: settled })]}
    />,
  );
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
  expect(screen.getByRole('button', { name: 'Work details' })).toHaveTextContent('Worked for 2.00s');
  expect(view.container.querySelector('[data-message-id="final"] [data-text-part]')).toBe(node);
  view.unmount();
  vi.useRealTimers();
});
it('waits for confirmed Claude completion while preserving its final node', async () => {
  const work = turnMessage('work', 'Claude work', { provider: 'claude' });
  const view = render(
    <TurnFixture rootId="claude-confirmed" messages={[work, finalMessage({ provider: 'claude', state: 'running' })]} />,
  );
  expect(screen.queryByRole('button', { name: 'Work details' })).toBeNull();
  expect(screen.getByText('Claude work')).toBeVisible();
  const node = view.container.querySelector('[data-message-id="final"] [data-text-part]');
  view.rerender(
    <TurnFixture
      rootId="claude-confirmed"
      messages={[work, finalMessage({ provider: 'claude', state: 'completed' })]}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'false'),
  );
  expect(view.container.querySelector('[data-message-id="final"] [data-text-part]')).toBe(node);
  expect(screen.queryByText('Claude work')).toBeNull();
});
it('shows precise Codex duration and suppresses only the matching native duration', async () => {
  const timing = { startedAtMs: 10000, completedAtMs: 12000, durationMs: 1900 };
  const original = finalMessage({ timing });
  const final = {
    ...original,
    metadata: {
      ...original.metadata,
      timing: { totalStreamTime: 1900, streamStartTime: 0, totalChunks: 1, toolCallCount: 0 },
      custom: { mainframe: { ...original.metadata.custom.mainframe, cost: 0.01 } },
    },
  };
  const view = render(
    <TurnFixture rootId="precise-duration" messages={[turnMessage('work', 'Work', { timing }), final]} />,
  );
  expect(screen.getByRole('button', { name: 'Work details' })).toHaveTextContent('Worked for 1.90s');
  expect(screen.getByRole('button', { name: 'Message cost' })).toBeVisible();
  view.rerender(
    <TurnFixture
      rootId="precise-duration"
      messages={[
        turnMessage('work', 'Work', { timing }),
        { ...final, metadata: { ...final.metadata, timing: { ...final.metadata.timing, totalStreamTime: 2000 } } },
      ]}
    />,
  );
  expect(await screen.findByRole('button', { name: 'Message timing' })).toHaveTextContent('2.00s');
});
