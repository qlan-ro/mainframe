import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, finalMessage, turnMessage } from './turn-fixtures';

beforeEach(() => useUiPrefs.getState().setTranscriptMode('compact'));
it.each([false, true])('folds mapped work in the actual native provider (split=%s)', async (split) => {
  const view = render(
    <TurnFixture
      rootId={`fold-${split}`}
      split={split}
      messages={[turnMessage('work', 'Private work'), finalMessage()]}
    />,
  );
  const toggle = await screen.findByRole('button', { name: 'Work details' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Private work')).toBeNull();
  expect(screen.getByText('Final answer')).toBeVisible();
  const work = view.container.querySelector('[data-message-id="work"]')!;
  expect(work.querySelector('[data-testid="chat-message-copy"]')).toBeNull();
  fireEvent.click(toggle);
  expect(await screen.findByText('Private work')).toBeVisible();
  fireEvent.mouseEnter(work);
  await waitFor(() => expect(work.querySelector('[data-testid="chat-message-copy"]')).not.toBeNull());
});
it('retains the exact native text DOM node when unknown phase becomes final, grows, settles and toggles', async () => {
  const rootId = 'late-final';
  const work = turnMessage('work', 'Private work');
  const initial = turnMessage('final', 'Visible answer', { phase: undefined });
  const view = render(<TurnFixture rootId={rootId} messages={[work, initial]} />);
  const text = await screen.findByText('Visible answer');
  const node = text.closest('[data-text-part]');
  view.rerender(
    <TurnFixture
      rootId={rootId}
      messages={[work, turnMessage('final', 'Visible answer grows', { phase: 'final_answer', finalEligible: true })]}
    />,
  );
  await waitFor(() => expect(screen.getByText('Visible answer grows').closest('[data-text-part]')).toBe(node));
  fireEvent.click(screen.getByRole('button', { name: 'Work details' }));
  expect(screen.getByText('Visible answer grows').closest('[data-text-part]')).toBe(node);
  fireEvent.click(screen.getByRole('button', { name: 'Work details' }));
  expect(screen.getAllByText('Visible answer grows')).toHaveLength(1);
});
it('hides fully consumed work-only frames and restores cross-message native details', async () => {
  const { turnTool } = await import('./turn-test-support');
  const view = render(<TurnFixture rootId="all-work" messages={[turnTool('a'), turnTool('b'), finalMessage()]} />);
  const second = view.container.querySelector('[data-message-id="b"]')!;
  expect(second).toHaveAttribute('hidden');
  expect(second.querySelector('[data-testid="chat-message-copy"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Work details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Read files' }));
  expect(await screen.findAllByTestId('read-card-root')).toHaveLength(2);
  for (const id of ['a', 'b']) {
    const detail = view.container.querySelector(`[data-source-message-id="${id}"]`)!;
    expect(detail.querySelectorAll('[data-slot="message-footer"]')).toHaveLength(1);
    fireEvent.mouseEnter(detail);
    await waitFor(() => expect(detail.querySelectorAll('[data-testid="chat-message-copy"]')).toHaveLength(1));
  }
  expect(view.container.querySelectorAll('[data-slot="message-footer"]')).toHaveLength(3);
  expect(screen.getByText('Final answer')).toBeVisible();
});
it('renders coalesced reasoning source ranges exactly once inside the original native scope', async () => {
  const { turnSource } = await import('./turn-fixtures');
  const text = 'First thought\nSecond thought';
  const message = turnMessage('thought', text, {}, [turnSource('a', 0, 14), turnSource('b', 14, text.length)]);
  const reasoning = { ...message, content: [{ type: 'reasoning' as const, text }] };
  render(<TurnFixture rootId="coalesced-thought" messages={[reasoning, finalMessage()]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Work details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Thought' }));
  expect(screen.getAllByText('First thought')).toHaveLength(1);
  expect(screen.getAllByText('Second thought')).toHaveLength(1);
  expect(screen.getByText('First thought').closest('[data-message-id]')).toHaveAttribute('data-message-id', 'thought');
});
it('keeps protected native agents outside hidden work and separates nested disclosure identity', async () => {
  const { turnTool } = await import('./turn-test-support');
  const nested = [turnMessage('work', 'Nested work'), finalMessage()];
  const task = turnTool('agent', { toolName: 'Task', args: { subagent_type: 'explorer' }, messages: nested });
  render(<TurnFixture rootId="nested-turns" messages={[turnMessage('work', 'Root work'), task, finalMessage()]} />);
  const outer = screen.getByRole('button', { name: 'Work details' });
  expect(outer).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: /explorer/ }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Work details' })).toHaveLength(2));
  const inner = screen.getAllByRole('button', { name: 'Work details' })[1]!;
  expect(inner.dataset.testid).not.toBe(outer.dataset.testid);
  fireEvent.click(inner);
  expect(await screen.findByText('Nested work')).toBeVisible();
  expect(screen.queryByText('Root work')).toBeNull();
});
it('folds on first eligible streamed final text and keeps its live native slot through terminal metadata', async () => {
  const work = turnMessage('work', 'Working');
  const live = (text: string, state: 'running' | 'completed') =>
    turnMessage('live', text, { phase: 'final_answer', finalEligible: true, state });
  const view = render(
    <TurnFixture rootId="streamed-final" split messages={[work, live('First final words', 'running')]} />,
  );
  expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'false');
  const slot = view.container.querySelector('[data-message-id="live"] [data-text-part]');
  await screen.findByText('First final words');
  view.rerender(
    <TurnFixture rootId="streamed-final" split messages={[work, live('First final words keep growing', 'running')]} />,
  );
  await screen.findByText('First final words keep growing');
  expect(view.container.querySelector('[data-message-id="live"] [data-text-part]')).toBe(slot);
  view.rerender(
    <TurnFixture
      rootId="streamed-final"
      split
      messages={[work, live('First final words keep growing', 'completed')]}
    />,
  );
  await waitFor(() => expect(screen.getAllByText('First final words keep growing')).toHaveLength(1));
  expect(view.container.querySelector('[data-message-id="live"] [data-text-part]')).toBe(slot);
  expect(screen.queryByText('Working')).toBeNull();
});
it('keeps pending native permissions and full question cards outside collapsed work', async () => {
  const { turnTool } = await import('./turn-test-support');
  const pending = turnTool('pending', {
    result: undefined,
    providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
  });
  const question = turnTool('question', {
    toolName: 'AskUserQuestion',
    args: {
      questions: [
        {
          question: 'Which route?',
          header: 'Route',
          options: [
            { label: 'A', description: 'First' },
            { label: 'B', description: 'Second' },
          ],
          multiSelect: false,
        },
      ],
    },
    result: undefined,
  });
  render(
    <TurnFixture
      rootId="protected"
      pending={['pending']}
      messages={[turnMessage('work', 'Hidden work'), pending, question, finalMessage()]}
    />,
  );
  expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: /Waiting for approval/ })).toBeVisible();
  expect(screen.getByTestId('chat-ask-card')).toBeVisible();
  fireEvent.click(screen.getByTestId('chat-ask-trigger'));
  expect(await screen.findByText('Which route?')).toBeVisible();
  expect(screen.queryByText('Hidden work')).toBeNull();
});
