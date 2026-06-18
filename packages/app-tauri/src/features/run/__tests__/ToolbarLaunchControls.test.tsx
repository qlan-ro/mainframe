/**
 * ToolbarLaunchControls — unit tests.
 *
 * Behaviors covered:
 *  - Renders the launch trigger with label "Preview" when no config is selected
 *  - The run button is disabled when fetchLaunchConfigs resolves to []
 *  - Opening the dropdown renders both config rows
 *  - Clicking a non-preview config calls startLaunchConfig only (no addRunTab)
 *  - Clicking a preview config calls startLaunchConfig AND addRunTab with kind:'preview'
 *  - Clicking the run button starts the first config when none is running
 *  - Clicking the run button stops the config when its status is 'running'
 *
 * Mocked dependencies:
 *  - @/lib/api/launch — startLaunchConfig, stopLaunchConfig, fetchLaunchConfigs, fetchLaunchStatuses
 *  - @/store/layout — useLayoutStore.addRunTab
 *  - @/store/sandbox — useSandboxStore (processStatuses, selectedConfigName, setSelectedConfigName)
 *  - sonner — toast.error
 */
import { it, expect, vi, beforeEach, describe } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';

// ── mock launch API ──────────────────────────────────────────────────────────
const startLaunchConfig = vi.fn();
const stopLaunchConfig = vi.fn();
const fetchLaunchConfigs = vi.fn();
const fetchLaunchStatuses = vi.fn();

vi.mock('@/lib/api/launch', () => ({
  startLaunchConfig: (...a: unknown[]) => startLaunchConfig(...a),
  stopLaunchConfig: (...a: unknown[]) => stopLaunchConfig(...a),
  fetchLaunchConfigs: (...a: unknown[]) => fetchLaunchConfigs(...a),
  fetchLaunchStatuses: (...a: unknown[]) => fetchLaunchStatuses(...a),
}));

// ── mock layout store ────────────────────────────────────────────────────────
const addRunTab = vi.fn();

vi.mock('@/store/layout', () => ({
  useLayoutStore: (selector: (s: { addRunTab: typeof addRunTab }) => unknown) =>
    selector({ addRunTab }),
}));

// ── mock sandbox store ───────────────────────────────────────────────────────
const setSelectedConfigName = vi.fn();

// processStatuses is mutable so individual tests can override it
let mockProcessStatuses: Record<string, Record<string, string>> = {};
let mockSelectedConfigName: string | null = null;

vi.mock('@/store/sandbox', () => ({
  useSandboxStore: (
    selector: (s: {
      processStatuses: Record<string, Record<string, string>>;
      selectedConfigName: string | null;
      setSelectedConfigName: typeof setSelectedConfigName;
    }) => unknown,
  ) =>
    selector({
      processStatuses: mockProcessStatuses,
      selectedConfigName: mockSelectedConfigName,
      setSelectedConfigName,
    }),
}));

// ── mock toast ───────────────────────────────────────────────────────────────
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

// ── fixtures ─────────────────────────────────────────────────────────────────
const configs: LaunchConfiguration[] = [
  { name: 'dev server', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: null, url: null },
  {
    name: 'preview-app',
    runtimeExecutable: 'npm',
    runtimeArgs: ['run', 'preview'],
    port: 3000,
    url: 'http://localhost:3000',
    preview: true,
  },
];

// Scope key: buildLaunchScope('proj-1', '/repo') = 'proj-1:/repo'
const SCOPE_KEY = 'proj-1:/repo';

describe('ToolbarLaunchControls', () => {
  beforeEach(() => {
    startLaunchConfig.mockReset().mockResolvedValue(undefined);
    stopLaunchConfig.mockReset().mockResolvedValue(undefined);
    fetchLaunchConfigs.mockResolvedValue(configs);
    fetchLaunchStatuses.mockResolvedValue({ statuses: {}, tunnelUrls: {}, effectivePath: '/repo' });
    addRunTab.mockReset().mockReturnValue(true);
    toastError.mockReset();
    setSelectedConfigName.mockReset();
    mockProcessStatuses = {};
    mockSelectedConfigName = null;
  });

  async function renderAndOpen() {
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    fireEvent.click(screen.getByTestId('main-toolbar-launch'));
    await waitFor(() => screen.getByTestId('main-toolbar-launch-config-dev server'));
  }

  it('renders the launch trigger with label "Preview" when no config is selected', async () => {
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    const trigger = screen.getByTestId('main-toolbar-launch');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Preview');
  });

  it('the run button is disabled when fetchLaunchConfigs resolves to []', async () => {
    fetchLaunchConfigs.mockResolvedValue([]);
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    // Wait for the empty fetch to settle so disabled state is applied
    await waitFor(() => {
      expect(screen.getByTestId('main-toolbar-play')).toBeDisabled();
    });
  });

  it('opening the dropdown renders both config rows', async () => {
    await renderAndOpen();
    expect(screen.getByTestId('main-toolbar-launch-config-dev server')).toBeInTheDocument();
    expect(screen.getByTestId('main-toolbar-launch-config-preview-app')).toBeInTheDocument();
  });

  it('clicking a non-preview config row calls startLaunchConfig and does NOT call addRunTab', async () => {
    await renderAndOpen();
    fireEvent.click(screen.getByTestId('main-toolbar-launch-config-dev server'));
    await waitFor(() =>
      expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'),
    );
    expect(addRunTab).not.toHaveBeenCalled();
  });

  it('clicking a preview config row calls startLaunchConfig AND addRunTab with kind:preview', async () => {
    await renderAndOpen();
    fireEvent.click(screen.getByTestId('main-toolbar-launch-config-preview-app'));
    await waitFor(() =>
      expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'preview-app', 'chat-9'),
    );
    expect(addRunTab).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'preview', config: 'preview-app' }),
    );
  });

  it('clicking the run button starts the first config when none is running', async () => {
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    await waitFor(() => expect(screen.getByTestId('main-toolbar-play')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('main-toolbar-play'));
    await waitFor(() =>
      expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'),
    );
    expect(stopLaunchConfig).not.toHaveBeenCalled();
  });

  it('clicking the run button stops the config when its status is running', async () => {
    // Set processStatuses so 'dev server' (the run target / first config) is 'running'
    mockProcessStatuses = { [SCOPE_KEY]: { 'dev server': 'running' } };
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    await waitFor(() => expect(screen.getByTestId('main-toolbar-play')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('main-toolbar-play'));
    await waitFor(() =>
      expect(stopLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'),
    );
    expect(startLaunchConfig).not.toHaveBeenCalled();
  });
});
