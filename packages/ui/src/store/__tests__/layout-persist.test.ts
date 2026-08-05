import { beforeEach, describe, it, expect } from 'vitest';
import { setActiveDaemon } from '@/lib/daemon/active-daemon';
import { layoutPersistOptions, sanitizeRun, serializeSessions, reviveSessions } from '../layout-persist';
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

  it('keeps a url tab with its url and title intact, while still dropping preview/console/terminal', () => {
    const r = {
      dir: 'v' as const,
      flex: [1, 1],
      panes: [
        {
          id: 'p1',
          active: 'u1',
          tabs: [
            { id: 't1', kind: 'terminal', title: 'bash' },
            { id: 'pv', kind: 'preview', title: 'web', config: 'dev' },
            { id: 'cs', kind: 'console', title: 'proc', config: 'dev' },
            { id: 'u1', kind: 'url', title: 'localhost:5173', url: 'http://localhost:5173/' },
          ],
        },
      ],
    } as unknown as RunState;
    const out = sanitizeRun(r)!;
    expect(out.panes[0]!.tabs).toEqual([
      { id: 'u1', kind: 'url', title: 'localhost:5173', url: 'http://localhost:5173/' },
    ]);
  });

  it('keeps a pane containing only a url tab, instead of dropping it', () => {
    const r = {
      dir: 'v' as const,
      flex: [1, 1],
      panes: [{ id: 'p1', active: 'u1', tabs: [{ id: 'u1', kind: 'url', title: 'x', url: 'http://x/' }] }],
    } as unknown as RunState;
    const out = sanitizeRun(r);
    expect(out).not.toBeNull();
    expect(out!.panes).toHaveLength(1);
    expect(out!.panes[0]!.tabs[0]!.kind).toBe('url');
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

// ── v1 → v2: the files/run surfaces folded into one `workspace` ───────────────

describe('layout-persist migrate (v1 → v2)', () => {
  const migrate = layoutPersistOptions.migrate!;
  const v1 = (l: unknown) => ({ sessions: { 'chat-1': { layout: l, run: null } } });
  const migrated = (l: unknown) =>
    (migrate(v1(l), 1) as { sessions: Record<string, SessionWorkspace> }).sessions['chat-1']!.layout;

  it('renames a persisted `run` surface to `workspace`', () => {
    const out = migrated({ top: ['chat', 'run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } });
    expect(out.top).toEqual(['chat', 'workspace']);
  });

  it('renames a persisted `files` surface to `workspace`', () => {
    const out = migrated({ top: ['chat', 'files'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } });
    expect(out.top).toEqual(['chat', 'workspace']);
  });

  it('dedupes files+run in the same row into one workspace', () => {
    const out = migrated({ top: ['files', 'run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } });
    expect(out.top).toEqual(['workspace']);
  });

  it('drops a bottom strip that the top row now duplicates', () => {
    const out = migrated({ top: ['chat', 'files'], bottom: 'run', topFlex: {}, vFlex: { top: 1, bottom: 0.4 } });
    expect(out.top).toEqual(['chat', 'workspace']);
    expect(out.bottom).toBeNull();
  });

  it('keeps a bottom strip the top row does not hold', () => {
    const out = migrated({ top: ['chat'], bottom: 'run', topFlex: {}, vFlex: { top: 1, bottom: 0.4 } });
    expect(out.bottom).toBe('workspace');
  });

  it('carries flex weights over, run winning a files/run tie', () => {
    const out = migrated({
      top: ['chat', 'run'],
      bottom: null,
      topFlex: { chat: 0.6, files: 0.3, run: 0.4 },
      vFlex: { top: 0.8, bottom: 0.2 },
    });
    expect(out.topFlex).toEqual({ chat: 0.6, workspace: 0.4 });
    expect(out.vFlex).toEqual({ top: 0.8, bottom: 0.2 });
  });

  it('leaves persisted tabs alone — they already carry the merged RunTab shape', () => {
    const persisted = {
      sessions: {
        'chat-1': {
          layout: { top: ['run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
          run: run([{ id: 'c1', kind: 'code', title: 'a.ts', path: 'a.ts' }]),
        },
      },
    };
    const out = migrate(persisted, 1) as { sessions: Record<string, SessionWorkspace> };
    expect(out.sessions['chat-1']!.run!.panes[0]!.tabs.map((t) => t.id)).toEqual(['c1']);
  });

  it('survives an empty / absent persisted payload', () => {
    expect(migrate(undefined, 1)).toEqual({ sessions: {} });
  });
});

const LAYOUT_SCOPED_KEY = 'mf:session-layout::local';

describe('layout store persistence', () => {
  beforeEach(() => {
    setActiveDaemon({ id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:0', token: null });
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

  it('persists sessions to the daemon-scoped key and sanitizes on write', () => {
    useLayoutStore.getState().setActiveSession('chat-x');
    // mutates active session layout → triggers persist
    useLayoutStore.getState().setTopFrac(0.7);
    const raw = JSON.parse(localStorage.getItem(LAYOUT_SCOPED_KEY)!);
    expect(raw.state.sessions['chat-x']).toBeTruthy();
  });

  it('store actions still work after a simulated reload (rehydrate)', () => {
    // Prime the store with a session
    useLayoutStore.getState().setActiveSession('chat-r');
    useLayoutStore.getState().setTopFrac(0.65);

    // Simulate rehydrate: push a serialized state into localStorage under the scoped key
    const persisted = {
      state: { sessions: { 'chat-r': { layout, run: null } } },
      version: 1,
    };
    localStorage.setItem(LAYOUT_SCOPED_KEY, JSON.stringify(persisted));

    // Reset store (as if the app restarted) — merge will revive from localStorage
    useLayoutStore.setState({ sessions: new Map(), activeSessionId: null });

    // After reset, calling setActiveSession should work (Map methods usable)
    useLayoutStore.getState().setActiveSession('chat-r');
    expect(useLayoutStore.getState().activeSessionId).toBe('chat-r');
  });
});
