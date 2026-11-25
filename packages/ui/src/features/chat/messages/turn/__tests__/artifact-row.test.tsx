import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, assistant, failed, running, text, tool, user } from './fixtures';

const artifact = vi.hoisted(() => ({ open: vi.fn(async () => {}), opening: false }));
const openExternal = vi.hoisted(() => vi.fn());
vi.mock('@/features/artifacts/use-open-artifact', () => ({ useOpenArtifact: () => artifact }));
vi.mock('../../../links/use-open-link', async (original) => ({
  ...(await original<object>()),
  useOpenExternal: () => openExternal,
}));
vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));

const ARTIFACT = 'https://claude.ai/artifact/V1LAdjrXoKC7jVLpHnV1D2';
let roots = 0;
beforeEach(() => {
  roots++;
  artifact.open.mockClear();
  artifact.opening = false;
  openExternal.mockClear();
  useUiPrefs.setState({ finishedWork: 'open' });
});

function show(over: object = {}) {
  const part = tool({
    toolCallId: 'art',
    toolName: 'Artifact',
    args: { url: ARTIFACT },
    result: `Updated the Artifact at ${ARTIFACT} (Version 2)`,
    ...over,
  });
  render(<TurnFixture rootId={`art-${roots}`} messages={[user('Hi'), assistant([part, text('Done')])]} />);
}

it('opens the artifact, and claude.ai from its own action', () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Open the artifact' }));
  expect(artifact.open).toHaveBeenCalledWith(ARTIFACT);
  fireEvent.click(screen.getByRole('button', { name: 'Open on claude.ai' }));
  expect(openExternal).toHaveBeenCalledWith(ARTIFACT);
  expect(artifact.open).toHaveBeenCalledOnce();
});

it('shows the download in progress and takes no second click', () => {
  artifact.opening = true;
  show();
  const action = screen.getByRole('button', { name: 'Opening the artifact…' });
  expect(action).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(action);
  expect(artifact.open).not.toHaveBeenCalled();
});

it.each([
  ['is in flight', running],
  ['failed', failed],
  ['names no artifact', { args: { action: 'list', scope: 'mine' }, result: 'rows' }],
])('offers no actions for a call that %s', (_what, over) => {
  show(over);
  expect(screen.queryByTestId('artifact-card-open')).toBeNull();
});
