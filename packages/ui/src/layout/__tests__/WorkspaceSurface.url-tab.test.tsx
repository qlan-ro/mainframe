/**
 * WorkspaceSurface — the `url` tab kind (#281, AC3, AC13).
 *
 * Mirrors WorkspaceSurface.tab-scope.test.tsx's mock set and scope-filtering model,
 * adding a stub for UrlTabInstance and proving two things that file doesn't
 * cover: the `url` kind renders through a real view (never the `${kind}:
 * ${title}` placeholder), and it obeys the same scope filter/release as every
 * other workspace tab.
 */
import { render as rtlRender } from '@testing-library/react';
import { TooltipProvider } from '@v2/components/ui/tooltip';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TAB_SCOPE = 'proj-A:/Users/me/.worktrees/feat-x';

const urlTabProps: Record<string, unknown>[] = [];
vi.mock('@/features/url-tab/UrlTabInstance', () => ({
  UrlTabInstance: (props: Record<string, unknown>) => {
    urlTabProps.push({ ...props });
    return <div data-testid={`stub-url-tab-${props['tabId'] as string}`} />;
  },
}));

vi.mock('@/features/preview/PreviewInstance', () => ({
  PreviewInstance: (props: Record<string, unknown>) => <div data-testid={`stub-preview-${props['tabId'] as string}`} />,
}));

vi.mock('@/features/editor/EditorTab', () => ({
  EditorTab: ({ path }: { path: string }) => <div data-testid={`stub-editor-${path}`} />,
}));
vi.mock('@/features/run/ConsolePane', () => ({
  ConsolePane: () => <div data-testid="stub-console-pane" />,
}));

vi.mock('@/features/terminal/TerminalInstance', () => ({
  TerminalInstance: ({ terminalId }: { terminalId: string }) => <div data-testid={`stub-terminal-${terminalId}`} />,
}));

vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

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
import { WorkspaceSurface } from '../surfaces/WorkspaceSurface';

// v2 `Hint` needs the v2 TooltipProvider — the v1 provider satisfies nothing.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

const FRESH_LAYOUT = {
  top: ['workspace' as const],
  bottom: null as null,
  topFlex: {} as Record<string, number>,
  vFlex: { top: 1, bottom: 0.4 },
};

function seedRunTabs(
  tabs: { id: string; kind: 'url' | 'code'; title: string; url?: string; path?: string; scopeKey?: string }[],
) {
  useLayoutStore.setState({
    layout: { ...FRESH_LAYOUT },
    run: {
      dir: 'v',
      flex: [1, 1],
      panes: [{ id: 'pane-1', active: tabs[0]!.id, tabs }],
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

describe('WorkspaceSurface — the url tab kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    urlTabProps.length = 0;
  });

  it('renders a url tab through UrlTabInstance, never the fallback placeholder', () => {
    seedRunTabs([
      { id: 'tab-1', kind: 'url', title: 'localhost:5173', url: 'http://localhost:5173/', scopeKey: TAB_SCOPE },
    ]);
    const { getByTestId, queryByText } = render(<WorkspaceSurface />);

    expect(getByTestId('stub-url-tab-tab-1')).toBeTruthy();
    expect(queryByText('url: localhost:5173')).toBeNull();
  });

  it('threads tabId, url, visible, scopeKey, and projectId from the tab and active identity', () => {
    seedRunTabs([
      { id: 'tab-1', kind: 'url', title: 'localhost:5173', url: 'http://localhost:5173/', scopeKey: TAB_SCOPE },
    ]);
    render(<WorkspaceSurface />);

    expect(urlTabProps[0]).toMatchObject({
      tabId: 'tab-1',
      url: 'http://localhost:5173/',
      visible: true,
      scopeKey: TAB_SCOPE,
      projectId: 'proj-A',
    });
  });

  it('a code tab renders the editor body instead — the assertion above is not vacuous', async () => {
    seedRunTabs([{ id: 'tab-code', kind: 'code', title: 'index.ts', path: 'src/index.ts', scopeKey: TAB_SCOPE }]);
    const { findByTestId } = render(<WorkspaceSurface />);

    // EditorTabBody lazy-loads its bodies, so the stub resolves a tick later.
    expect(await findByTestId('stub-editor-src/index.ts')).toBeTruthy();
    expect(urlTabProps).toHaveLength(0);
  });

  it('does not render a url tab whose scopeKey belongs to a different project/worktree', () => {
    seedRunTabs([
      {
        id: 'leak-tab',
        kind: 'url',
        title: 'localhost:5173',
        url: 'http://localhost:5173/',
        scopeKey: 'proj-B:/other',
      },
    ]);
    const { queryByTestId } = render(<WorkspaceSurface />);

    expect(urlTabProps).toHaveLength(0);
    expect(queryByTestId('stub-url-tab-leak-tab')).toBeNull();
  });

  it('renders a url tab stamped with the active scope alongside a hidden non-matching one', () => {
    seedRunTabs([
      { id: 'keep-1', kind: 'url', title: 'localhost:5173', url: 'http://localhost:5173/', scopeKey: TAB_SCOPE },
      { id: 'leak-1', kind: 'url', title: 'localhost:6000', url: 'http://localhost:6000/', scopeKey: 'proj-B:/other' },
    ]);
    const { getByTestId, queryByTestId } = render(<WorkspaceSurface />);

    expect(urlTabProps).toHaveLength(1);
    expect(urlTabProps[0]!['scopeKey']).toBe(TAB_SCOPE);
    expect(getByTestId('stub-url-tab-keep-1')).toBeTruthy();
    expect(queryByTestId('stub-url-tab-leak-1')).toBeNull();
  });

  it('removes a url tab from the DOM after its scope is released', () => {
    seedRunTabs([
      { id: 'tab-1', kind: 'url', title: 'localhost:5173', url: 'http://localhost:5173/', scopeKey: TAB_SCOPE },
    ]);
    const { queryByTestId, rerender } = render(<WorkspaceSurface />);
    expect(queryByTestId('stub-url-tab-tab-1')).toBeTruthy();

    useLayoutStore.getState().releaseRunScope(TAB_SCOPE);
    rerender(<WorkspaceSurface />);

    expect(queryByTestId('stub-url-tab-tab-1')).toBeNull();
  });
});
