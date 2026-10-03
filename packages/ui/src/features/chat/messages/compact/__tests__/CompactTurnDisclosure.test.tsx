import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, finalMessage, turnMessage } from './turn-fixtures';
import { clearSelection, expectControlsResolve, selectText, turnTool } from './turn-test-support';

beforeEach(() => useUiPrefs.getState().setTranscriptMode('compact'));
afterEach(() => {
  clearSelection();
  vi.useRealTimers();
});
it('keeps explicit choices across remount and scopes them by root and ancestor', async () => {
  const messages = [turnMessage('work', 'Work text'), finalMessage()];
  const view = render(<TurnFixture rootId="remember" messages={messages} />);
  const toggle = screen.getByRole('button', { name: 'Work details' });
  expectControlsResolve(toggle);
  fireEvent.click(toggle);
  view.unmount();
  const remount = render(<TurnFixture rootId="remember" messages={messages} />);
  expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'true');
  remount.rerender(<TurnFixture rootId="remember" ancestors={['child']} messages={messages} />);
  expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'false');
});
it('invalidates a stale closed choice permanently and forces cancelled/failed turns open', async () => {
  const work = turnMessage('work', 'Work text');
  const view = render(<TurnFixture rootId="invalid" messages={[work, finalMessage()]} />);
  const toggle = screen.getByRole('button', { name: 'Work details' });
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  for (const state of ['cancelled', 'failed', 'invalid', 'completed'] as const) {
    view.rerender(<TurnFixture rootId="invalid" messages={[work, finalMessage({ state })]} />);
    await waitFor(() => expect(screen.getByText('Work text')).toBeVisible());
  }
});
it('defers automatic folding while focus is inside mapped work', async () => {
  const work = turnMessage('work', '[Work link](https://example.test)');
  const view = render(<TurnFixture rootId="focus" messages={[work]} />);
  act(() => screen.getByRole('link', { name: 'Work link' }).focus());
  view.rerender(<TurnFixture rootId="focus" messages={[work, finalMessage()]} />);
  expect(await screen.findByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'true');
  act(() => (document.activeElement as HTMLElement).blur());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'false'),
  );
});
it('defers automatic folding for selection and resumes after it clears', async () => {
  const work = turnMessage('work', 'Selected work');
  const view = render(<TurnFixture rootId="selection" messages={[work]} />);
  selectText(screen.getByText('Selected work'));
  view.rerender(<TurnFixture rootId="selection" messages={[work, finalMessage()]} />);
  expect(screen.getByText('Selected work')).toBeVisible();
  clearSelection();
  await waitFor(() => expect(screen.queryByText('Selected work')).toBeNull());
});
it('defers folding for explicitly expanded activity and collapses after that activity closes', async () => {
  const work = turnTool();
  const view = render(<TurnFixture rootId="inner-open" messages={[work]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Read files' }));
  view.rerender(<TurnFixture rootId="inner-open" messages={[work, finalMessage()]} />);
  expect(await screen.findByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Read files' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'false'),
  );
});
it('defers folding while a native scoped agent is active', async () => {
  const agent = turnTool('agent', {
    toolName: 'Task',
    result: undefined,
    providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
    args: { subagent_type: 'explorer' },
  });
  const view = render(
    <TurnFixture rootId="agent-active" messages={[turnMessage('work', 'Working'), agent, finalMessage()]} />,
  );
  expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'true');
  view.rerender(
    <TurnFixture
      rootId="agent-active"
      messages={[
        turnMessage('work', 'Working'),
        turnTool('agent', { toolName: 'Task', args: { subagent_type: 'explorer' } }),
        finalMessage(),
      ]}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Work details' })).toHaveAttribute('aria-expanded', 'false'),
  );
  expect(screen.getByRole('button', { name: /explorer/ })).toBeVisible();
});
it('coordinates native disclosure scroll locking with the viewport bottom-pin controller', async () => {
  const release = vi.fn();
  const beginInteraction = vi.fn(() => release);
  const viewportElement = { current: null as HTMLDivElement | null };
  render(
    <TurnFixture
      rootId="scroll-outer"
      scroll={{ viewportElement, beginInteraction }}
      messages={[turnMessage('work', 'Work'), finalMessage()]}
    />,
  );
  viewportElement.current = screen.getByTestId('turn-viewport');
  const viewport = viewportElement.current;
  Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 1000 } });
  viewport.scrollTop = 300;
  fireEvent.click(screen.getByRole('button', { name: 'Work details' }));
  expect(beginInteraction).toHaveBeenCalledTimes(1);
  expect(viewport.scrollTop).toBe(300);
  await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
});
