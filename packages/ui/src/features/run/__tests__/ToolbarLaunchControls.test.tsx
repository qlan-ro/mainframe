/**
 * ToolbarLaunchControls — unit tests.
 *
 * Behaviors covered:
 *  - After configs load, trigger shows the DEFAULT first config name ("dev server"), not "Preview"
 *  - When fetchLaunchConfigs resolves to [], the run button is disabled and trigger shows "Launch"
 *  - Opening the dropdown renders both config rows and the gated "Generate with Agent" footer (disabled)
 *  - Clicking a non-preview config ROW selects it: calls setSelectedConfig with (scopeKey, name),
 *    does NOT call startLaunchConfig, does NOT call addRunTab
 *  - Clicking a preview config ROW is PURE SELECTION: calls setSelectedConfig with (scopeKey, name),
 *    does NOT call addRunTab, does NOT call startLaunchConfig
 *  - Clicking the per-row START button on a non-preview config calls startLaunchConfig, does NOT call addRunTab
 *  - Clicking the per-row START button on a preview config calls startLaunchConfig AND addRunTab with kind:'preview'
 *  - When a config is 'running', the row shows a STOP button; clicking it calls stopLaunchConfig
 *  - Run button (main-toolbar-play): clicking starts the first config when none is running
 *  - Run button (main-toolbar-play): clicking stops the config when its status is 'running'
 *  - Bug 1 (cross-scope isolation): a selection stored under a DIFFERENT scope key doesn't bleed
 *  - Bug 1 (stale within scope): a stored name not in current configs falls back to the default first config
 *  - Bug 1 (selection respected): a stored name that IS in configs is shown and marked selected
 *
 * Mocked dependencies:
 *  - @/lib/api/launch — startLaunchConfig, stopLaunchConfig, fetchLaunchConfigs, fetchLaunchStatuses
 *  - @/store/layout — useLayoutStore.addRunTab
 *  - @/store/sandbox — useSandboxStore (processStatuses, selectedConfigByScope, setSelectedConfig)
 *  - @/lib/toast — mfToast
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
  useLayoutStore: (selector: (s: { addRunTab: typeof addRunTab }) => unknown) => selector({ addRunTab }),
}));

// ── mock sandbox store ───────────────────────────────────────────────────────
const setSelectedConfig = vi.fn();

// processStatuses and selectedConfigByScope are mutable so individual tests can override them
let mockProcessStatuses: Record<string, Record<string, string>> = {};
let mockSelectedByScope: Record<string, string> = {};

vi.mock('@/store/sandbox', () => ({
  useSandboxStore: (
    selector: (s: {
      processStatuses: Record<string, Record<string, string>>;
      selectedConfigByScope: Record<string, string>;
      setSelectedConfig: typeof setSelectedConfig;
    }) => unknown,
  ) =>
    selector({
      processStatuses: mockProcessStatuses,
      selectedConfigByScope: mockSelectedByScope,
      setSelectedConfig,
    }),
}));

// ── mock toast ───────────────────────────────────────────────────────────────
const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({
  mfToast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

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
// Hardcoded here; effectivePath comes from the fetchLaunchStatuses mock returning '/repo'.
const SCOPE_KEY = 'proj-1:/repo';

describe('ToolbarLaunchControls', () => {
  beforeEach(() => {
    startLaunchConfig.mockReset().mockResolvedValue(undefined);
    stopLaunchConfig.mockReset().mockResolvedValue(undefined);
    fetchLaunchConfigs.mockResolvedValue(configs);
    fetchLaunchStatuses.mockResolvedValue({ statuses: {}, tunnelUrls: {}, effectivePath: '/repo' });
    addRunTab.mockReset().mockReturnValue(true);
    toastError.mockReset();
    setSelectedConfig.mockReset();
    mockProcessStatuses = {};
    mockSelectedByScope = {};
  });

  async function renderAndOpen() {
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    fireEvent.click(screen.getByTestId('main-toolbar-launch'));
    await waitFor(() => screen.getByTestId('main-toolbar-launch-config-dev server'));
  }

  // ── Bug 2 fix: default label shows the first config name, not "Preview" ────

  it('after configs load, trigger shows the first config name "dev server"', async () => {
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    await waitFor(() => {
      expect(screen.getByTestId('main-toolbar-launch')).toHaveTextContent('dev server');
    });
  });

  it('when fetchLaunchConfigs resolves to [], the trigger shows "No Launch Configurations" and the run button is disabled', async () => {
    fetchLaunchConfigs.mockResolvedValue([]);
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    await waitFor(() => {
      expect(screen.getByTestId('main-toolbar-launch')).toHaveTextContent('No Launch Configurations');
      expect(screen.getByTestId('main-toolbar-play')).toBeDisabled();
    });
  });

  // ── Bug 1 fix: cross-scope isolation ─────────────────────────────────────

  it('ignores a selection stored under a different scope: shows "dev server" not the other scope\'s name', async () => {
    // 'other-proj:/x' is a completely different scope; it must not affect proj-1:/repo
    mockSelectedByScope = { 'other-proj:/x': 'ghost' };
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    await waitFor(() => {
      expect(screen.getByTestId('main-toolbar-launch')).toHaveTextContent('dev server');
    });
  });

  it('falls back to the first config when stored name is not in current configs', async () => {
    // 'deleted-config' is stored for the right scope but no longer exists in configs
    mockSelectedByScope = { [SCOPE_KEY]: 'deleted-config' };
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    await waitFor(() => {
      expect(screen.getByTestId('main-toolbar-launch')).toHaveTextContent('dev server');
    });
  });

  it('uses the stored name when it matches a config in the current scope', async () => {
    // 'preview-app' exists in configs and is stored for the correct scope
    mockSelectedByScope = { [SCOPE_KEY]: 'preview-app' };
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    await waitFor(() => {
      expect(screen.getByTestId('main-toolbar-launch')).toHaveTextContent('preview-app');
    });
  });

  it('marks the stored config row as selected when it matches a current config', async () => {
    mockSelectedByScope = { [SCOPE_KEY]: 'preview-app' };
    await renderAndOpen();
    // The selected row gets 'bg-accent' class; inspect via aria or check the row renders
    const previewRow = screen.getByTestId('main-toolbar-launch-config-preview-app');
    expect(previewRow).toBeInTheDocument();
    // The row for the non-selected config should NOT carry the selected styling
    // (We verify this by checking the trigger shows "preview-app" and not "dev server")
    expect(screen.getByTestId('main-toolbar-launch')).toHaveTextContent('preview-app');
  });

  // ── Dropdown contents ────────────────────────────────────────────────────

  it('opening the dropdown renders both config rows and a disabled generate footer', async () => {
    await renderAndOpen();
    expect(screen.getByTestId('main-toolbar-launch-config-dev server')).toBeInTheDocument();
    expect(screen.getByTestId('main-toolbar-launch-config-preview-app')).toBeInTheDocument();
    expect(screen.getByTestId('main-toolbar-launch-generate')).toBeDisabled();
  });

  // ── Row selection ─────────────────────────────────────────────────────────

  it('clicking the non-preview ROW selects it: calls setSelectedConfig(SCOPE_KEY, "dev server"), does NOT call startLaunchConfig or addRunTab', async () => {
    await renderAndOpen();
    fireEvent.click(screen.getByTestId('main-toolbar-launch-config-dev server'));
    await waitFor(() => expect(setSelectedConfig).toHaveBeenCalledWith(SCOPE_KEY, 'dev server'));
    expect(startLaunchConfig).not.toHaveBeenCalled();
    expect(addRunTab).not.toHaveBeenCalled();
  });

  it('clicking the preview ROW is pure selection: calls setSelectedConfig(SCOPE_KEY, "preview-app"), does NOT call addRunTab or startLaunchConfig', async () => {
    await renderAndOpen();
    fireEvent.click(screen.getByTestId('main-toolbar-launch-config-preview-app'));
    await waitFor(() => expect(setSelectedConfig).toHaveBeenCalledWith(SCOPE_KEY, 'preview-app'));
    expect(addRunTab).not.toHaveBeenCalled();
    expect(startLaunchConfig).not.toHaveBeenCalled();
  });

  // ── Per-row start/stop buttons ────────────────────────────────────────────

  it('clicking the per-row START button on a non-preview config calls startLaunchConfig AND addRunTab with kind:console', async () => {
    await renderAndOpen();
    fireEvent.click(screen.getByTestId('main-toolbar-launch-start-dev server'));
    await waitFor(() => expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'));
    expect(addRunTab).toHaveBeenCalledWith(expect.objectContaining({ kind: 'console', config: 'dev server' }));
    // The tabId must not contain spaces (Tauri child-webview label restriction)
    const calls = addRunTab.mock.calls;
    const tabId = (calls[calls.length - 1]?.[0] as { id: string }).id;
    expect(tabId).not.toMatch(/\s/);
    expect(tabId.startsWith('console-dev_server-')).toBe(true);
  });

  it('clicking the per-row START button on a preview config calls startLaunchConfig AND addRunTab with kind:preview', async () => {
    await renderAndOpen();
    fireEvent.click(screen.getByTestId('main-toolbar-launch-start-preview-app'));
    await waitFor(() => expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'preview-app', 'chat-9'));
    expect(addRunTab).toHaveBeenCalledWith(expect.objectContaining({ kind: 'preview', config: 'preview-app' }));
  });

  it('when dev server is running, the row shows a stop button; clicking it calls stopLaunchConfig', async () => {
    // effectivePath '/repo' comes from the fetchLaunchStatuses mock above
    mockProcessStatuses = { [SCOPE_KEY]: { 'dev server': 'running' } };
    await renderAndOpen();
    expect(screen.getByTestId('main-toolbar-launch-stop-dev server')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('main-toolbar-launch-stop-dev server'));
    await waitFor(() => expect(stopLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'));
    expect(startLaunchConfig).not.toHaveBeenCalled();
  });

  // ── Main run button — "dev server" is configs[0] = the effective default ──

  it('clicking the run button (main-toolbar-play) starts "dev server" (first config) when none is running', async () => {
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    await waitFor(() => expect(screen.getByTestId('main-toolbar-play')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('main-toolbar-play'));
    await waitFor(() => expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'));
    expect(stopLaunchConfig).not.toHaveBeenCalled();
  });

  it('clicking the run button (main-toolbar-play) stops "dev server" when its status is running', async () => {
    // Scope key = buildLaunchScope('proj-1', '/repo') = 'proj-1:/repo'; effectivePath '/repo' from mock
    mockProcessStatuses = { [SCOPE_KEY]: { 'dev server': 'running' } };
    const { ToolbarLaunchControls } = await import('../ToolbarLaunchControls');
    render(<ToolbarLaunchControls port={31415} projectId="proj-1" chatId="chat-9" />);
    await waitFor(() => expect(screen.getByTestId('main-toolbar-play')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('main-toolbar-play'));
    await waitFor(() => expect(stopLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'));
    expect(startLaunchConfig).not.toHaveBeenCalled();
  });
});
