/**
 * StopPopover — unit tests.
 *
 * Behaviors covered:
 *  - Renders the trigger with data-testid="run-stop-trigger"
 *  - When opened, renders rows only for running/starting processes
 *  - Each running row has data-testid="run-stop-process-<name>"
 *  - Clicking a process row calls stopLaunchConfig(port, projectId, name, chatId)
 *  - Renders a "Stop All" button that stops every running process
 *  - Shows a toast on stop failure
 *  - Does not show stopped processes in the list
 */
import { it, expect, vi, beforeEach, describe } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── mock daemon port + identity ──────────────────────────────────────────────
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-1', chatId: 'chat-9' }),
}));

// ── mock launch API ──────────────────────────────────────────────────────────
const stopLaunchConfig = vi.fn();

vi.mock('@/lib/api/launch', () => ({
  stopLaunchConfig: (...a: unknown[]) => stopLaunchConfig(...a),
  fetchLaunchConfigs: vi.fn().mockResolvedValue([]),
  fetchLaunchStatuses: vi.fn().mockResolvedValue({ statuses: {}, tunnelUrls: {}, effectivePath: '/repo' }),
}));

// ── mock sandbox store ───────────────────────────────────────────────────────
const processStatuses = {
  'proj-1:/repo': {
    'dev server': 'running',
    'api': 'starting',
    'idle-worker': 'stopped',
  },
};

vi.mock('@/store/sandbox', () => ({
  useSandboxStore: (selector: (s: { processStatuses: typeof processStatuses }) => unknown) =>
    selector({ processStatuses }),
}));

// ── mock toast ───────────────────────────────────────────────────────────────
const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({ mfToast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

describe('StopPopover', () => {
  beforeEach(() => {
    stopLaunchConfig.mockReset().mockResolvedValue(undefined);
    toastError.mockReset();
  });

  async function openPopover() {
    const { StopPopover } = await import('../StopPopover');
    render(<StopPopover scopeKey="proj-1:/repo" />);
    fireEvent.click(screen.getByTestId('run-stop-trigger'));
    await waitFor(() => screen.getByTestId('run-stop-process-dev server'));
  }

  it('renders the trigger with data-testid="run-stop-trigger"', async () => {
    const { StopPopover } = await import('../StopPopover');
    render(<StopPopover scopeKey="proj-1:/repo" />);
    expect(screen.getByTestId('run-stop-trigger')).toBeInTheDocument();
  });

  it('shows running and starting processes, hides stopped ones', async () => {
    await openPopover();
    expect(screen.getByTestId('run-stop-process-dev server')).toBeInTheDocument();
    expect(screen.getByTestId('run-stop-process-api')).toBeInTheDocument();
    expect(screen.queryByTestId('run-stop-process-idle-worker')).not.toBeInTheDocument();
  });

  it('clicking a process row calls stopLaunchConfig with correct args', async () => {
    await openPopover();
    fireEvent.click(screen.getByTestId('run-stop-process-dev server'));
    await waitFor(() =>
      expect(stopLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'),
    );
  });

  it('renders the Stop All button', async () => {
    await openPopover();
    expect(screen.getByTestId('run-stop-all')).toBeInTheDocument();
  });

  it('Stop All stops every running/starting process', async () => {
    await openPopover();
    fireEvent.click(screen.getByTestId('run-stop-all'));
    await waitFor(() => expect(stopLaunchConfig).toHaveBeenCalledTimes(2));
    expect(stopLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9');
    expect(stopLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'api', 'chat-9');
  });

  it('shows a toast when stopLaunchConfig throws', async () => {
    stopLaunchConfig.mockRejectedValue(new Error('network error'));
    await openPopover();
    fireEvent.click(screen.getByTestId('run-stop-process-dev server'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
