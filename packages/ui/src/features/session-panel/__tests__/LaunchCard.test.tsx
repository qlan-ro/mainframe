/**
 * LaunchCard — unit tests.
 *
 * Behaviors covered:
 *  - one row per launch configuration, with the preview-vs-console glyph and a
 *    spinner while `starting`
 *  - the live row is marked and offers STOP; a stopped row offers START
 *  - a row click starts or stops THAT config, always passing the chatId — the
 *    daemon derives the effective worktree path from it
 *  - the card's count badge is the number of live configs
 *  - the header X closes the panel
 *  - no configs renders the empty row, and no rows
 *  - rows are inert without a chatId
 *
 * Ported from `features/run/__tests__/ToolbarLaunchControls.test.tsx` (deleted
 * in T5.2), whose per-row start/stop coverage this replaces:
 *  - :190 — starting a non-preview config opens a `kind: 'console'` Run tab with
 *    a space-free tabId (the Tauri child-webview label restriction)
 *  - :202 — starting a preview config opens a `kind: 'preview'` tab
 *
 * Those two need the REAL `useLaunchActions` (the tab is opened inside it), so
 * this suite mocks the layer below — the launch API and the two stores — rather
 * than the hook. That also makes the daemon calls themselves assertable.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

// ── launch API ───────────────────────────────────────────────────────────────
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

// ── stores ───────────────────────────────────────────────────────────────────
const addRunTab = vi.fn();
vi.mock('@/store/layout', () => ({
  useLayoutStore: (selector: (s: { addRunTab: typeof addRunTab }) => unknown) => selector({ addRunTab }),
}));

const setSelectedConfig = vi.fn();
let mockProcessStatuses: Record<string, Record<string, string>> = {};
let mockSelectedByScope: Record<string, string> = {};
vi.mock('@/store/sandbox', () => ({
  useSandboxStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      processStatuses: mockProcessStatuses,
      selectedConfigByScope: mockSelectedByScope,
      setSelectedConfig,
    }),
}));

const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({
  mfToast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

let mockChatId: string | undefined = 'chat-9';
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectName: 'repo', projectId: 'proj-1', chatId: mockChatId, isWorktree: false }),
}));

const { LaunchCard } = await import('../LaunchCard');

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

/** buildLaunchScope('proj-1', '/repo'); '/repo' comes from the statuses mock. */
const SCOPE_KEY = 'proj-1:/repo';

const onClose = vi.fn();
const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: TooltipProvider });
const badge = () => screen.getByTestId('session-panel-card-launch').querySelector('[data-slot="badge"]');

async function renderCard() {
  render(<LaunchCard port={31415} onClose={onClose} />);
  await waitFor(() => screen.getByTestId('session-panel-launch-row-dev server'));
}

beforeEach(() => {
  startLaunchConfig.mockReset().mockResolvedValue(undefined);
  stopLaunchConfig.mockReset().mockResolvedValue(undefined);
  fetchLaunchConfigs.mockResolvedValue(configs);
  fetchLaunchStatuses.mockResolvedValue({ statuses: {}, tunnelUrls: {}, effectivePath: '/repo' });
  addRunTab.mockReset().mockReturnValue(true);
  setSelectedConfig.mockReset();
  toastError.mockReset();
  onClose.mockReset();
  mockProcessStatuses = {};
  mockSelectedByScope = {};
  mockChatId = 'chat-9';
});

describe('LaunchCard — card chrome', () => {
  it('titles the card Launch and closes from the header X', async () => {
    await renderCard();
    expect(screen.getByTestId('session-panel-card-launch')).toHaveTextContent('Launch');
    fireEvent.click(screen.getByTestId('session-panel-card-close-launch'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('LaunchCard — rows', () => {
  it('renders one row per configuration', async () => {
    await renderCard();
    expect(screen.getByTestId('session-panel-launch-row-dev server')).toHaveTextContent('dev server');
    expect(screen.getByTestId('session-panel-launch-row-preview-app')).toHaveTextContent('preview-app');
  });

  it('distinguishes a preview config from a console one by glyph', async () => {
    await renderCard();
    expect(screen.getByTestId('session-panel-launch-row-preview-app').querySelector('.lucide-eye')).toBeTruthy();
    expect(screen.getByTestId('session-panel-launch-row-dev server').querySelector('.lucide-terminal')).toBeTruthy();
  });

  it('offers START on a stopped row and STOP on a live one, and marks the live row', async () => {
    mockProcessStatuses = { [SCOPE_KEY]: { 'dev server': 'running' } };
    await renderCard();
    expect(screen.getByTestId('session-panel-launch-stop-dev server')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-launch-row-dev server')).toHaveAttribute('data-live', 'true');
    expect(screen.getByTestId('session-panel-launch-start-preview-app')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-launch-row-preview-app')).toHaveAttribute('data-live', 'false');
  });

  it('spins while a config is starting', async () => {
    mockProcessStatuses = { [SCOPE_KEY]: { 'dev server': 'starting' } };
    await renderCard();
    expect(screen.getByTestId('session-panel-launch-spinner-dev server')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-launch-spinner-preview-app')).toBeNull();
  });

  it('counts the live configs in the card badge', async () => {
    mockProcessStatuses = { [SCOPE_KEY]: { 'dev server': 'running' } };
    await renderCard();
    expect(badge()).toHaveTextContent('1');
  });

  it('shows no count badge when nothing is live', async () => {
    await renderCard();
    expect(badge()).toBeNull();
  });
});

describe('LaunchCard — start and stop', () => {
  it('starts the config the row belongs to, passing the chatId', async () => {
    await renderCard();
    fireEvent.click(screen.getByTestId('session-panel-launch-row-preview-app'));
    await waitFor(() => expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'preview-app', 'chat-9'));
    expect(stopLaunchConfig).not.toHaveBeenCalled();
    // Starting stamps the selection — there is no select-without-starting.
    expect(setSelectedConfig).toHaveBeenCalledWith(SCOPE_KEY, 'preview-app');
  });

  it('stops a live config rather than restarting it', async () => {
    mockProcessStatuses = { [SCOPE_KEY]: { 'dev server': 'running' } };
    await renderCard();
    fireEvent.click(screen.getByTestId('session-panel-launch-row-dev server'));
    await waitFor(() => expect(stopLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'));
    expect(startLaunchConfig).not.toHaveBeenCalled();
  });

  it('acts from the trailing affordance too — it is part of the row', async () => {
    await renderCard();
    fireEvent.click(screen.getByTestId('session-panel-launch-start-dev server'));
    await waitFor(() => expect(startLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'dev server', 'chat-9'));
  });

  it('is inert without a chatId — the daemon resolves the worktree from it', async () => {
    mockChatId = undefined;
    await renderCard();
    const row = screen.getByTestId('session-panel-launch-row-dev server');
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(startLaunchConfig).not.toHaveBeenCalled();
  });

  it('stops a running NON-selected config rather than the selected one (#206)', async () => {
    mockSelectedByScope = { [SCOPE_KEY]: 'dev server' };
    mockProcessStatuses = { [SCOPE_KEY]: { 'preview-app': 'running' } };
    await renderCard();
    fireEvent.click(screen.getByTestId('session-panel-launch-row-preview-app'));
    await waitFor(() => expect(stopLaunchConfig).toHaveBeenCalledWith(31415, 'proj-1', 'preview-app', 'chat-9'));
    expect(startLaunchConfig).not.toHaveBeenCalled();
  });
});

// ── ported from ToolbarLaunchControls.test.tsx (:190, :202) ───────────────────

describe('LaunchCard — the Run tab a start opens', () => {
  it('opens a console tab with a space-free tabId for a non-preview config', async () => {
    await renderCard();
    fireEvent.click(screen.getByTestId('session-panel-launch-row-dev server'));

    await waitFor(() => expect(startLaunchConfig).toHaveBeenCalled());
    expect(addRunTab).toHaveBeenCalledWith(expect.objectContaining({ kind: 'console', config: 'dev server' }));
    // The tabId must not contain spaces (Tauri child-webview label restriction).
    const calls = addRunTab.mock.calls;
    const tabId = (calls[calls.length - 1]?.[0] as { id: string }).id;
    expect(tabId).not.toMatch(/\s/);
    expect(tabId.startsWith('console-dev_server-')).toBe(true);
  });

  it('opens a preview tab for a preview config', async () => {
    await renderCard();
    fireEvent.click(screen.getByTestId('session-panel-launch-row-preview-app'));

    await waitFor(() => expect(startLaunchConfig).toHaveBeenCalled());
    expect(addRunTab).toHaveBeenCalledWith(expect.objectContaining({ kind: 'preview', config: 'preview-app' }));
  });
});

describe('LaunchCard — no configurations', () => {
  it('shows the empty row and no config rows', async () => {
    fetchLaunchConfigs.mockResolvedValue([]);
    render(<LaunchCard port={31415} onClose={onClose} />);
    await waitFor(() => screen.getByTestId('session-panel-launch-empty'));
    expect(screen.getByTestId('session-panel-launch-empty')).toHaveTextContent('No Launch Configurations');
    expect(screen.queryByTestId('session-panel-launch-row-dev server')).toBeNull();
  });
});
