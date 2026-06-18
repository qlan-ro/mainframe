/**
 * LaunchPopover — unit tests.
 *
 * Behaviors covered:
 *  - Renders the trigger with data-testid="run-launch-trigger"
 *  - When opened, renders each config row with data-testid="run-launch-config-<name>"
 *  - Clicking a NON-preview config calls startLaunchConfig and does NOT add a run tab
 *  - Clicking a PREVIEW config calls startLaunchConfig AND addRunTab with kind:'preview'
 *  - Start failures show a toast error (does not throw)
 *
 * Mocked dependencies:
 *  - @/lib/api/launch — startLaunchConfig, fetchLaunchConfigs, fetchLaunchStatuses
 *  - @/store/layout — useLayoutStore.getState().addRunTab
 *  - @/features/sessions/runtime/daemon-port-context — useDaemonPort
 *  - @/features/sessions/use-active-identity — useActiveIdentity
 *  - sonner — toast
 */
import { it, expect, vi, beforeEach, describe } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';

// ── mock daemon port + identity ──────────────────────────────────────────────
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-1', chatId: 'chat-9' }),
}));

// ── mock launch API ──────────────────────────────────────────────────────────
const startLaunchConfig = vi.fn();
const fetchLaunchConfigs = vi.fn();
const fetchLaunchStatuses = vi.fn();

vi.mock('@/lib/api/launch', () => ({
  startLaunchConfig: (...a: unknown[]) => startLaunchConfig(...a),
  fetchLaunchConfigs: (...a: unknown[]) => fetchLaunchConfigs(...a),
  fetchLaunchStatuses: (...a: unknown[]) => fetchLaunchStatuses(...a),
}));

// ── mock layout store ────────────────────────────────────────────────────────
const addRunTab = vi.fn();

vi.mock('@/store/layout', () => ({
  useLayoutStore: (selector: (s: { addRunTab: typeof addRunTab }) => unknown) =>
    selector({ addRunTab }),
}));

// ── mock sandbox store — no running processes ────────────────────────────────
const setSelectedConfigName = vi.fn();
vi.mock('@/store/sandbox', () => ({
  useSandboxStore: (
    selector: (s: {
      processStatuses: Record<string, Record<string, string>>;
      selectedConfigName: string | null;
      setSelectedConfigName: typeof setSelectedConfigName;
    }) => unknown,
  ) => selector({ processStatuses: {}, selectedConfigName: null, setSelectedConfigName }),
}));

// ── mock toast ───────────────────────────────────────────────────────────────
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

const configs: LaunchConfiguration[] = [
  { name: 'dev server', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: null, url: null },
  {
    name: 'preview-app',
    runtimeExecutable: 'npm',
    runtimeArgs: ['run', 'dev'],
    port: 3000,
    url: 'http://localhost:3000',
    preview: true,
  },
];

describe('LaunchPopover', () => {
  beforeEach(() => {
    startLaunchConfig.mockReset().mockResolvedValue(undefined);
    fetchLaunchConfigs.mockResolvedValue(configs);
    fetchLaunchStatuses.mockResolvedValue({ statuses: {}, tunnelUrls: {}, effectivePath: '/repo' });
    addRunTab.mockReset().mockReturnValue(true);
    toastError.mockReset();
  });

  async function openPopover() {
    const { LaunchPopover } = await import('../LaunchPopover');
    render(<LaunchPopover />);
    fireEvent.click(screen.getByTestId('run-launch-trigger'));
    await waitFor(() => screen.getByTestId('run-launch-config-dev server'));
  }

  it('renders the trigger button with data-testid="run-launch-trigger"', async () => {
    const { LaunchPopover } = await import('../LaunchPopover');
    render(<LaunchPopover />);
    expect(screen.getByTestId('run-launch-trigger')).toBeInTheDocument();
  });

  it('renders config rows when the popover is opened', async () => {
    await openPopover();
    expect(screen.getByTestId('run-launch-config-dev server')).toBeInTheDocument();
    expect(screen.getByTestId('run-launch-config-preview-app')).toBeInTheDocument();
  });

  it('clicking a non-preview config calls startLaunchConfig only', async () => {
    await openPopover();
    fireEvent.click(screen.getByTestId('run-launch-config-dev server'));
    await waitFor(() => expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'));
    expect(addRunTab).not.toHaveBeenCalled();
  });

  it('clicking a preview config calls startLaunchConfig AND addRunTab with kind:preview', async () => {
    await openPopover();
    fireEvent.click(screen.getByTestId('run-launch-config-preview-app'));
    await waitFor(() => expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'preview-app', 'chat-9'));
    expect(addRunTab).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'preview', config: 'preview-app' }),
    );
  });

  it('shows a toast error when startLaunchConfig throws', async () => {
    startLaunchConfig.mockRejectedValue(new Error('network error'));
    await openPopover();
    fireEvent.click(screen.getByTestId('run-launch-config-dev server'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
