/**
 * RunSurface — scope-coupled tab visibility (the leak fix).
 *
 * Run tabs are global (layout store), but they must only be RENDERED for the
 * session whose launch scope matches the tab's own `scopeKey`. Tabs from other
 * projects/worktrees must be hidden — not just pass through a wrong scope — so
 * they cannot leak into a different session's Run surface.
 *
 * NEW behavior (replaces the old "decoupled from the active chat" premise):
 *   - RunSurface computes an `activeScopeKey` from `useActiveIdentity()` via
 *     `buildLaunchScope(projectId, worktreePath ?? projectPath)`.
 *   - `filterRunByScope(run, activeScopeKey)` is applied before rendering; only
 *     tabs whose `scopeKey` matches (or tabs with no scopeKey at all) reach the DOM.
 *   - A tab with a non-matching scopeKey produces NO rendered element.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Active scope the mock identity will resolve to.
const TAB_SCOPE = 'proj-A:/Users/me/.worktrees/feat-x';

// ---------------------------------------------------------------------------
// Stubs — capture props so assertions can read what was rendered
// ---------------------------------------------------------------------------
const previewProps: Record<string, unknown>[] = [];
vi.mock('@/features/preview/PreviewInstance', () => ({
  PreviewInstance: (props: Record<string, unknown>) => {
    previewProps.push({ ...props });
    return <div data-testid={`stub-preview-${props['tabId'] as string}`} />;
  },
}));

const consoleProps: Record<string, unknown>[] = [];
vi.mock('@/features/run/ConsolePane', () => ({
  ConsolePane: (props: Record<string, unknown>) => {
    consoleProps.push({ ...props });
    return <div data-testid="stub-console-pane" />;
  },
}));

vi.mock('@/features/terminal/TerminalInstance', () => ({
  TerminalInstance: ({ terminalId }: { terminalId: string }) => <div data-testid={`stub-terminal-${terminalId}`} />,
}));

vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

// Active identity resolves to proj-A + the worktree path → activeScopeKey = TAB_SCOPE.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({
    projectId: 'proj-A',
    worktreePath: '/Users/me/.worktrees/feat-x',
    chatId: 'chat-1',
  }),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31500,
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

import { useLayoutStore } from '@/store/layout';
import { useSandboxStore } from '@/store/sandbox';
import { RunSurface } from '../surfaces/RunSurface';

const FRESH_LAYOUT = {
  top: ['run' as const],
  bottom: null as null,
  topFlex: {} as Record<string, number>,
  vFlex: { top: 1, bottom: 0.4 },
};

/**
 * Seed the layout store with a single-pane run whose tabs are provided by the
 * caller. The first tab in `tabs` becomes the active tab for the pane.
 */
function seedRunTabs(tabs: { id: string; kind: 'preview' | 'console'; config: string; scopeKey?: string }[]) {
  useLayoutStore.setState({
    layout: { ...FRESH_LAYOUT },
    run: {
      dir: 'v',
      flex: [1, 1],
      panes: [
        {
          id: 'pane-1',
          active: tabs[0]!.id,
          tabs: tabs.map((t) => ({ title: t.config, ...t })),
        },
      ],
    },
    sessions: new Map(),
    activeSessionId: null,
  });
  useSandboxStore.setState({
    captures: [],
    logsOutput: [],
    selectedConfigByScope: {},
    lastStartedProcess: null,
    processStatuses: { [TAB_SCOPE]: { dev: 'running' } },
  });
}

describe('RunSurface — scope-coupled tab visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewProps.length = 0;
    consoleProps.length = 0;
  });

  // Test 1 — matching preview tab is rendered and receives its scopeKey
  it('renders a preview tab whose scopeKey matches the active scope', () => {
    seedRunTabs([{ id: 'tab-match', kind: 'preview', config: 'dev', scopeKey: TAB_SCOPE }]);
    render(<RunSurface />);
    expect(previewProps[0]).toBeDefined();
    expect(previewProps[0]!['scopeKey']).toBe(TAB_SCOPE);
  });

  // Test 2 — matching console tab is rendered and receives its scopeKey
  it('renders a console tab whose scopeKey matches the active scope', () => {
    seedRunTabs([{ id: 'tab-c', kind: 'console', config: 'dev', scopeKey: TAB_SCOPE }]);
    render(<RunSurface />);
    expect(consoleProps[0]).toBeDefined();
    expect(consoleProps[0]!['scopeKey']).toBe(TAB_SCOPE);
  });

  // Test 3 — THE LEAK FIX: a tab from a different scope must NOT be rendered
  it('does not render a preview tab whose scopeKey belongs to a different project/worktree', () => {
    const { queryByTestId } = render(
      (() => {
        seedRunTabs([{ id: 'leak-tab', kind: 'preview', config: 'dev', scopeKey: 'proj-B:/other/worktree' }]);
        return <RunSurface />;
      })(),
    );
    // No preview body was mounted — prop-capture array is empty.
    expect(previewProps).toHaveLength(0);
    // The stub element for the leaking tab is absent from the DOM.
    expect(queryByTestId('stub-preview-leak-tab')).toBeNull();
  });

  // Test 4 — mixed pane: only the matching tab renders; the other is hidden
  it('in a mixed pane, renders only the tab matching the active scope and hides the other', () => {
    seedRunTabs([
      { id: 'keep-1', kind: 'preview', config: 'dev', scopeKey: TAB_SCOPE },
      { id: 'leak-1', kind: 'preview', config: 'dev', scopeKey: 'proj-B:/other' },
    ]);
    const { queryByTestId, getByTestId } = render(<RunSurface />);

    // Exactly one preview rendered, and it is the matching tab.
    expect(previewProps).toHaveLength(1);
    expect(previewProps[0]!['scopeKey']).toBe(TAB_SCOPE);

    // The matching tab's stub is present.
    expect(getByTestId('stub-preview-keep-1')).toBeTruthy();

    // The leaking tab's stub is absent.
    expect(queryByTestId('stub-preview-leak-1')).toBeNull();
  });
});
