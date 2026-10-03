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
  expect(screen.getByRole('button', { name: 'Worked for 2.00s' })).toBeVisible();
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
it('keeps failed native cards visible even with stale closed turn state', async () => {
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
  expect(await screen.findByLabelText('failed')).toBeVisible();
});
it('updates a supplied header clock without rebuilding transcript rows or remounting final text', async () => {
  const model = await import('../../../view-model/compact/build-turn-disclosures');
  const build = vi.spyOn(model, 'buildTurnDisclosures');
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
  const count = build.mock.calls.length;
  expect(screen.getByRole('button', { name: 'Working for 2.00s' })).toBeVisible();
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByRole('button', { name: 'Working for 3.00s' })).toBeVisible();
  expect(build).toHaveBeenCalledTimes(count);
  expect(view.container.querySelector('[data-message-id="final"] [data-text-part]')).toBe(node);
  view.unmount();
  build.mockRestore();
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
  expect(screen.getByRole('button', { name: 'Worked for 1.90s' })).toBeVisible();
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
