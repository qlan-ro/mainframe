/**
 * WorkspaceSurface — with no tabs the panel is the empty-state card alone: its
 * controls are in the title bar.
 */
import { render as rtlRender, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/terminal/TerminalInstance', () => ({
  TerminalInstance: ({ terminalId }: { terminalId: string }) => <div data-testid={`stub-terminal-${terminalId}`} />,
}));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: undefined, chatId: undefined }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));
vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => ({
    configs: [],
    scopeStatuses: {},
    selectedConfigName: null,
    handleLaunch: vi.fn(),
    handleStop: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock('@/features/run/ConsolePane', () => ({
  ConsolePane: () => <div data-testid="stub-console-pane" />,
}));
vi.mock('@/features/preview/PreviewInstance', () => ({
  PreviewInstance: ({ tabId }: { tabId: string }) => <div data-testid={`stub-preview-${tabId}`} />,
}));

import { useLayoutStore } from '@/store/layout';
import { WorkspaceSurface } from '../WorkspaceSurface';

// v2 `Hint` needs the v2 TooltipProvider — the v1 provider satisfies nothing.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

const FRESH = {
  top: ['chat' as const],
  topFlex: {} as Record<string, number>,
};

describe('WorkspaceSurface — empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayoutStore.setState({
      layout: { ...FRESH },
      run: null,
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  it('renders the empty-state card and no tab strip', () => {
    render(<WorkspaceSurface />);
    expect(screen.getByTestId('workspace-empty-state')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
