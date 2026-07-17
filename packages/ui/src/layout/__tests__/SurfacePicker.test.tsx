import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SurfacePicker } from '../SurfacePicker';

// Mock emitSurfaceIntent so we can assert what was emitted.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

// The run picker resolves launch configs; stub the launch subsystem + its context deps.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-1', chatId: 'chat-1' }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));
vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => ({
    configs: [],
    scopeStatuses: {},
    selectedConfigName: null,
    handleSelect: vi.fn(),
    handleLaunch: vi.fn(),
    handleStop: vi.fn(),
    refetch: vi.fn(),
  }),
}));

const recentFiles = vi.fn<() => { path: string; status: string }[]>(() => []);
vi.mock('@/features/files/use-recent-files', () => ({ useRecentFiles: () => recentFiles() }));

import { emitSurfaceIntent } from '@/store/surface-intents';

describe('SurfacePicker (files surface)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recentFiles.mockReturnValue([]);
  });

  it('renders the files picker when surface="files"', () => {
    render(<SurfacePicker surface="files" />);
    expect(screen.getByTestId('files-surface-picker')).toBeInTheDocument();
  });

  it('files-picker-open-file emits open-file-picker intent on click', async () => {
    const user = userEvent.setup();
    render(<SurfacePicker surface="files" />);
    await user.click(screen.getByTestId('files-picker-open-file'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file-picker' });
  });

  it('files-picker-view-changes emits inspector-tab intent with tab="changes" on click', async () => {
    const user = userEvent.setup();
    render(<SurfacePicker surface="files" />);
    await user.click(screen.getByTestId('files-picker-view-changes'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'inspector-tab', tab: 'changes' });
  });

  it('omits the Recent section when there are no recently-changed files', () => {
    recentFiles.mockReturnValue([]);
    render(<SurfacePicker surface="files" />);
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
  });

  it('renders a Recent row per changed file and opens it on click', async () => {
    recentFiles.mockReturnValue([
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/b.ts', status: 'A' },
    ]);
    const user = userEvent.setup();
    render(<SurfacePicker surface="files" />);
    expect(screen.getByText('Recent')).toBeInTheDocument();
    await user.click(screen.getByTestId('files-picker-recent-src/a.ts'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'src/a.ts' });
  });
});

describe('SurfacePicker (run surface)', () => {
  it('renders the run picker when surface="run"', () => {
    render(<SurfacePicker surface="run" />);
    expect(screen.getByTestId('run-surface-picker')).toBeInTheDocument();
  });

  it('run-picker-new-terminal button is enabled', () => {
    render(<SurfacePicker surface="run" />);
    const btn = screen.getByTestId('run-picker-new-terminal');
    expect(btn).not.toBeDisabled();
  });

  it('clicking run-picker-new-terminal emits a new-terminal intent', async () => {
    const user = userEvent.setup();
    render(<SurfacePicker surface="run" />);
    await user.click(screen.getByTestId('run-picker-new-terminal'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'new-terminal' });
  });
});
