import { beforeEach, describe, it, expect } from 'vitest';
import { sanitizeRun, serializeSessions, reviveSessions } from '../layout-persist';
import { useLayoutStore } from '../layout';
import type { RunState } from '../run-pane';
import type { SessionWorkspace } from '../layout';

const layout = {
  top: ['chat', 'run'],
  bottom: null,
  topFlex: { chat: 0.6, run: 0.4 },
  vFlex: { top: 1, bottom: 0.4 },
} as SessionWorkspace['layout'];

const run = (tabs: Array<{ id: string; kind: string; title: string; path?: string; config?: string }>): RunState =>
  ({ dir: 'v', flex: [1, 1], panes: [{ id: 'p1', active: tabs[0]?.id ?? null, tabs }] }) as RunState;

describe('layout-persist', () => {
  it('drops terminal/preview/console tabs and keeps file-backed tabs', () => {
    const r = run([
      { id: 't1', kind: 'terminal', title: 'bash' },
      { id: 'c1', kind: 'code', title: 'a.ts', path: 'a.ts' },
    ]);
    const out = sanitizeRun(r)!;
    expect(out.panes[0]!.tabs.map((t) => t.kind)).toEqual(['code']);
    // active repointed off the dropped terminal
    expect(out.panes[0]!.active).toBe('c1');
  });

  it('nulls run when every tab is process-backed', () => {
    expect(
      sanitizeRun(
        run([
          { id: 't1', kind: 'terminal', title: 'bash' },
          { id: 'pv', kind: 'preview', title: 'web', config: 'dev' },
        ]),
      ),
    ).toBeNull();
  });

  it('serializeSessions sanitizes run and skips __LOCALID_ drafts', () => {
    const sessions = new Map<string, SessionWorkspace>([
      ['chat-1', { layout, run: run([{ id: 't1', kind: 'terminal', title: 'bash' }]) }],
      ['__LOCALID_9', { layout, run: null }],
    ]);
    const out = serializeSessions(sessions);
    expect(Object.keys(out)).toEqual(['chat-1']);
    // terminal-only run sanitized away
    expect(out['chat-1']!.run).toBeNull();
    // layout kept fully
    expect(out['chat-1']!.layout.topFlex).toEqual({ chat: 0.6, run: 0.4 });
  });

  it('reviveSessions returns a real Map', () => {
    const m = reviveSessions({ 'chat-1': { layout, run: null } });
    expect(m).toBeInstanceOf(Map);
    expect(m.get('chat-1')?.layout.top).toEqual(['chat', 'run']);
  });
});

describe('layout store persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  it('pruneSessions removes entries not in the valid set', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('chat-a');
    s.setActiveSession('chat-b');
    expect(useLayoutStore.getState().sessions.has('chat-a')).toBe(true);
    useLayoutStore.getState().pruneSessions(new Set(['chat-b']));
    expect(useLayoutStore.getState().sessions.has('chat-a')).toBe(false);
    expect(useLayoutStore.getState().sessions.has('chat-b')).toBe(true);
  });

  it('persists sessions to mf:session-layout and sanitizes on write', () => {
    useLayoutStore.getState().setActiveSession('chat-x');
    // mutates active session layout → triggers persist
    useLayoutStore.getState().setTopFrac(0.7);
    const raw = JSON.parse(localStorage.getItem('mf:session-layout')!);
    expect(raw.state.sessions['chat-x']).toBeTruthy();
  });

  it('store actions still work after a simulated reload (rehydrate)', () => {
    // Prime the store with a session
    useLayoutStore.getState().setActiveSession('chat-r');
    useLayoutStore.getState().setTopFrac(0.65);

    // Simulate rehydrate: push a serialized state into localStorage
    const persisted = {
      state: { sessions: { 'chat-r': { layout, run: null } } },
      version: 1,
    };
    localStorage.setItem('mf:session-layout', JSON.stringify(persisted));

    // Reset store (as if the app restarted) — merge will revive from localStorage
    useLayoutStore.setState({ sessions: new Map(), activeSessionId: null });

    // After reset, calling setActiveSession should work (Map methods usable)
    useLayoutStore.getState().setActiveSession('chat-r');
    expect(useLayoutStore.getState().activeSessionId).toBe('chat-r');
  });
});
