import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { WorkspaceEmptyState } from '../WorkspaceEmptyState';

// Mock emitSurfaceIntent so we can assert what was emitted.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-1', chatId: 'chat-1' }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

const launchConfigs = vi.fn<() => LaunchConfiguration[]>(() => []);
const handleLaunch = vi.fn();
vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => ({
    configs: launchConfigs(),
    scopeStatuses: {},
    selectedConfigName: null,
    handleLaunch,
    handleStop: vi.fn(),
    refetch: vi.fn(),
  }),
}));

const recentFiles = vi.fn<() => { path: string; status: string }[]>(() => []);
vi.mock('@/features/files/use-recent-files', () => ({ useRecentFiles: () => recentFiles() }));

import { emitSurfaceIntent } from '@/store/surface-intents';

const config = (name: string, preview: boolean): LaunchConfiguration =>
  ({ name, preview, type: 'node', request: 'launch' }) as unknown as LaunchConfiguration;

describe('WorkspaceEmptyState — one card for files, terminals and previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recentFiles.mockReturnValue([]);
    launchConfigs.mockReturnValue([]);
  });

  it('renders the merged card with both the file rows and the run rows', () => {
    render(<WorkspaceEmptyState />);
    expect(screen.getByTestId('workspace-empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-picker-open-file')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-picker-view-changes')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-picker-open-url')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-picker-new-terminal')).toBeInTheDocument();
  });

  it('open-file emits the open-file-picker intent', async () => {
    const user = userEvent.setup();
    render(<WorkspaceEmptyState />);
    await user.click(screen.getByTestId('workspace-picker-open-file'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file-picker' });
  });

  it('view-changes emits open-review — the same destination as the session panel Changes row', async () => {
    const user = userEvent.setup();
    render(<WorkspaceEmptyState />);
    await user.click(screen.getByTestId('workspace-picker-view-changes'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-review' });
  });

  it('new-terminal is enabled and emits a new-terminal intent', async () => {
    const user = userEvent.setup();
    render(<WorkspaceEmptyState />);
    const btn = screen.getByTestId('workspace-picker-new-terminal');
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'new-terminal' });
  });

  it('Open URL… swaps the row for the inline URL entry', async () => {
    const user = userEvent.setup();
    render(<WorkspaceEmptyState />);
    await user.click(screen.getByTestId('workspace-picker-open-url'));
    expect(screen.getByTestId('workspace-url-entry-input')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-picker-open-url')).not.toBeInTheDocument();
  });

  it('omits the Recent section when there are no recently-changed files', () => {
    render(<WorkspaceEmptyState />);
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
  });

  it('renders a Recent row per changed file and opens it on click', async () => {
    recentFiles.mockReturnValue([
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/b.ts', status: 'A' },
    ]);
    const user = userEvent.setup();
    render(<WorkspaceEmptyState />);
    expect(screen.getByText('Recent')).toBeInTheDocument();
    await user.click(screen.getByTestId('workspace-picker-recent-src/a.ts'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'src/a.ts' });
  });

  it('says so when the project has no launch configs', () => {
    render(<WorkspaceEmptyState />);
    expect(screen.getByText('No launch configs found.')).toBeInTheDocument();
  });

  it('renders a row per launch config and launches it on click', async () => {
    launchConfigs.mockReturnValue([config('dev', true), config('worker', false)]);
    const user = userEvent.setup();
    render(<WorkspaceEmptyState />);
    expect(screen.getByTestId('workspace-picker-launch-worker')).toBeInTheDocument();
    await user.click(screen.getByTestId('workspace-picker-launch-dev'));
    expect(handleLaunch).toHaveBeenCalledWith(expect.objectContaining({ name: 'dev' }));
  });
});
