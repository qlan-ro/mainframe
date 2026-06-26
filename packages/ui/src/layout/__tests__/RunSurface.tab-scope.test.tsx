/**
 * RunSurface — a run tab's OWN scope wins over the active-chat-derived scope.
 *
 * Regression: run tabs are GLOBAL (layout store), decoupled from the active
 * chat, but the console filter used to derive ONE scopeKey from the active chat
 * (`Object.keys(processStatuses).find(startsWith projectId)`) and apply it to
 * every tab. When the active chat didn't resolve to the tab's launch scope
 * (unresolved/draft chat → projectId undefined, or a different project), that
 * derivation yielded null/'' → ConsolePane filtered by '' → "No console output
 * yet" even though logs existed under the tab's real scope (the preview still
 * showed running via PreviewInstance's projectId-agnostic status fallback).
 *
 * Fix: each launch tab carries its own `scopeKey` (captured at launch from the
 * same effectivePath the daemon/logs use); RunSurface passes `tab.scopeKey`
 * (falling back to the active-chat scope only when the tab has none).
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TAB_SCOPE = 'proj-A:/Users/me/.worktrees/feat-x';

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

// The active chat is UNRESOLVED (draft / not yet projected) → no projectId, so
// the old active-chat scope derivation produces null. The tab must still work.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: undefined, chatId: undefined }),
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

function seedRunTabs(tabs: { id: string; kind: 'preview' | 'console'; config: string; scopeKey?: string }[]) {
  useLayoutStore.setState({
    layout: { ...FRESH_LAYOUT },
    run: {
      dir: 'v',
      flex: [1],
      panes: [{ id: 'pane-1', active: tabs[0]!.id, tabs: tabs.map((t) => ({ title: t.config, ...t })) }],
    },
    sessions: new Map(),
    activeSessionId: null,
  });
  // Logs/status live under the tab's real scope — NOT discoverable from the
  // (unresolved) active chat.
  useSandboxStore.setState({
    captures: [],
    logsOutput: [],
    selectedConfigByScope: {},
    lastStartedProcess: null,
    processStatuses: { [TAB_SCOPE]: { dev: 'running' } },
  });
}

describe('RunSurface — per-tab scope (decoupled from the active chat)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewProps.length = 0;
    consoleProps.length = 0;
  });

  it('passes the preview tab’s own scopeKey even when the active chat is unresolved', () => {
    seedRunTabs([{ id: 'tab-1', kind: 'preview', config: 'dev', scopeKey: TAB_SCOPE }]);
    render(<RunSurface />);
    expect(previewProps[0]).toBeDefined();
    expect(previewProps[0]!['scopeKey']).toBe(TAB_SCOPE);
  });

  it('passes the console tab’s own scopeKey to ConsolePane', () => {
    seedRunTabs([{ id: 'tab-c', kind: 'console', config: 'dev', scopeKey: TAB_SCOPE }]);
    render(<RunSurface />);
    expect(consoleProps[0]).toBeDefined();
    expect(consoleProps[0]!['scopeKey']).toBe(TAB_SCOPE);
  });
});
