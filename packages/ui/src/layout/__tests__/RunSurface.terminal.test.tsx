import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub TerminalInstance so we don't pull xterm into this layout test.
vi.mock('@/features/terminal/TerminalInstance', () => ({
  TerminalInstance: ({ terminalId }: { terminalId: string }) => <div data-testid={`stub-terminal-${terminalId}`} />,
}));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

// Stub features that require assistant-ui runtime context (not needed in this layout test).
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
    handleSelect: vi.fn(),
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

import { emitSurfaceIntent } from '@/store/surface-intents';
import { useLayoutStore } from '@/store/layout';
import { RunSurface } from '../surfaces/RunSurface';

const FRESH = {
  top: ['chat' as const],
  bottom: null as null,
  topFlex: {} as Record<string, number>,
  vFlex: { top: 1, bottom: 0.4 },
};

describe('RunSurface terminal rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayoutStore.setState({
      layout: { ...FRESH },
      run: {
        dir: 'v',
        flex: [1, 1],
        panes: [{ id: 'pane-1', tabs: [{ id: 'term-9', kind: 'terminal', title: 'Terminal' }], active: 'term-9' }],
      },
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  it('renders TerminalInstance for a kind:terminal tab', () => {
    render(<RunSurface />);
    expect(screen.getByTestId('stub-terminal-term-9')).toBeInTheDocument();
  });

  it('the + opens a popover whose "New terminal" row emits new-terminal with the paneId', async () => {
    const user = userEvent.setup();
    render(<RunSurface />);
    // The + is a popover trigger, not a direct action.
    await user.click(screen.getByTestId('run-tab-strip-add-pane-1'));
    await user.click(screen.getByTestId('run-pane-new-terminal-pane-1'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'new-terminal', paneId: 'pane-1' });
  });
});
