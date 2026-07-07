/**
 * RunSurface — empty-state header (todo #195): when the Run surface has no
 * tabs, a RunEmptyHeader (with a close button) renders above the SurfacePicker.
 */
import { render, screen } from '@testing-library/react';
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

import { useLayoutStore } from '@/store/layout';
import { RunSurface } from '../RunSurface';

const FRESH = {
  top: ['chat' as const],
  bottom: null as null,
  topFlex: {} as Record<string, number>,
  vFlex: { top: 1, bottom: 0.4 },
};

describe('RunSurface — empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayoutStore.setState({
      layout: { ...FRESH },
      run: null,
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  it('renders both the empty-state header close button and the surface picker', () => {
    render(<RunSurface />);
    expect(screen.getByTestId('run-surface-picker')).toBeInTheDocument();
    expect(screen.getByTestId('run-surface-close')).toBeInTheDocument();
  });
});
