/**
 * RunSurface — PreviewInstance prop threading.
 * Asserts that scopeKey and projectId are threaded from RunSurface
 * down into PreviewInstance render.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProjectId = 'proj-123';
const mockScopeKey = `${mockProjectId}:/workspace`;

// Capture props passed to PreviewInstance
const capturedProps: Record<string, unknown>[] = [];
vi.mock('@/features/preview/PreviewInstance', () => ({
  PreviewInstance: (props: Record<string, unknown>) => {
    capturedProps.push({ ...props });
    return <div data-testid={`stub-preview-${props['tabId'] as string}`} />;
  },
}));

vi.mock('@/features/terminal/TerminalInstance', () => ({
  TerminalInstance: ({ terminalId }: { terminalId: string }) => <div data-testid={`stub-terminal-${terminalId}`} />,
}));

vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: mockProjectId, chatId: 'chat-1' }),
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

import { useLayoutStore } from '@/store/layout';
import { useSandboxStore } from '@/store/sandbox';
import { RunSurface } from '../surfaces/RunSurface';

const FRESH_LAYOUT = {
  top: ['chat' as const],
  bottom: null as null,
  topFlex: {} as Record<string, number>,
  vFlex: { top: 1, bottom: 0.4 },
};

describe('RunSurface — PreviewInstance prop threading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProps.length = 0;

    useLayoutStore.setState({
      layout: { ...FRESH_LAYOUT },
      run: {
        dir: 'v',
        flex: [1],
        panes: [
          {
            id: 'pane-1',
            active: 'tab-1',
            tabs: [{ id: 'tab-1', kind: 'preview', title: 'Preview', config: 'dev' }],
          },
        ],
      },
      sessions: new Map(),
      activeSessionId: null,
    });

    useSandboxStore.setState({
      captures: [],
      logsOutput: [],
      selectedConfigByScope: { [mockScopeKey]: 'dev' },
      lastStartedProcess: null,
      processStatuses: {
        [mockScopeKey]: { dev: 'running' },
      },
    });
  });

  it('passes scopeKey to PreviewInstance', () => {
    render(<RunSurface />);
    expect(capturedProps[0]).toBeDefined();
    expect(capturedProps[0]!['scopeKey']).toBe(mockScopeKey);
  });

  it('passes projectId to PreviewInstance', () => {
    render(<RunSurface />);
    expect(capturedProps[0]!['projectId']).toBe(mockProjectId);
  });
});
