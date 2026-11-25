import { beforeEach, describe, it, expect, vi } from 'vitest';
import { setActiveDaemon } from '@/lib/daemon/active-daemon';
import { layoutPersistOptions, sanitizeRun, serializeSessions, reviveSessions } from '../layout-persist';
import { useLayoutStore } from '../layout';
import type { RunState } from '../run-pane';
import type { SessionWorkspace } from '../layout';

const layout: SessionWorkspace['layout'] = {
  top: ['chat', 'workspace'],
  topFlex: { chat: 0.6, workspace: 0.4 },
};

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
    expect(out['chat-1']!.layout.topFlex).toEqual({ chat: 0.6, workspace: 0.4 });
  });

  it('reviveSessions returns a real Map', () => {
    const m = reviveSessions({ 'chat-1': { layout, run: null } });
    expect(m).toBeInstanceOf(Map);
    expect(m.get('chat-1')?.layout.top).toEqual(['chat', 'workspace']);
  });
});

// ── v1 → v2: the files/run surfaces folded into one `workspace` ───────────────

describe('a v1 layout', () => {
  const read = (persisted: unknown) =>
    (
      layoutPersistOptions.merge!(layoutPersistOptions.migrate!(persisted, 1), useLayoutStore.getState()) as {
        sessions: Map<string, SessionWorkspace>;
      }
    ).sessions;
  const migrated = (l: unknown) => read({ sessions: { 'chat-1': { layout: l, run: null } } }).get('chat-1')!.layout;

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

  it('carries flex weights over, run winning a files/run tie', () => {
    const out = migrated({
      top: ['chat', 'run'],
      bottom: null,
      topFlex: { chat: 0.6, files: 0.3, run: 0.4 },
      vFlex: { top: 0.8, bottom: 0.2 },
    });
    expect(out.topFlex).toEqual({ chat: 0.6, workspace: 0.4 });
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
    expect(
      read(persisted)
        .get('chat-1')!
        .run!.panes[0]!.tabs.map((t) => t.id),
    ).toEqual(['c1']);
  });

  it('survives an empty / absent persisted payload', () => {
    expect(read(undefined).size).toBe(0);
  });
});

describe('the bottom strip the chat split parked the workspace in', () => {
  const migrated = (layout: unknown, tabs: Parameters<typeof run>[0] = []) =>
    (
      layoutPersistOptions.merge!(
        { sessions: { 'chat-1': { layout, run: tabs.length > 0 ? run(tabs) : null } } },
        useLayoutStore.getState(),
      ) as { sessions: Map<string, SessionWorkspace> }
    ).sessions.get('chat-1')!;

  it('brings a parked workspace back beside the chat, still lit, with its tabs', () => {
    const out = migrated({ top: ['chat'], bottom: 'workspace', topFlex: {}, vFlex: { top: 1, bottom: 0.4 } }, [
      { id: 'c1', kind: 'code', title: 'a.ts', path: 'a.ts' },
    ]);
    expect(out.layout).toEqual({ top: ['chat', 'workspace'], topFlex: {} });
    expect(out.run!.panes[0]!.tabs.map((t) => t.id)).toEqual(['c1']);
  });

  it('keeps the dragged widths', () => {
    const out = migrated({
      top: ['chat', 'workspace'],
      bottom: null,
      topFlex: { chat: 0.35, workspace: 0.65 },
      vFlex: { top: 1, bottom: 0.4 },
    });
    expect(out.layout).toEqual({ top: ['chat', 'workspace'], topFlex: { chat: 0.35, workspace: 0.65 } });
  });

  it('keeps a hidden chat hidden', () => {
    const out = migrated({ top: ['workspace'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } });
    expect(out.layout.top).toEqual(['workspace']);
  });

  it('puts chat on the left of a workspace that had been dragged to its other side', () => {
    const out = migrated({ top: ['workspace', 'chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } });
    expect(out.layout.top).toEqual(['chat', 'workspace']);
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

  it('keeps the active __LOCALID_* entry while dropping a stale local id and an unknown chat id', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('__LOCALID_stale');
    s.setActiveSession('chat-b');
    s.setActiveSession('__LOCALID_active'); // active draft, stays active through the prune

    useLayoutStore.getState().pruneSessions(new Set(['chat-b']));

    const sessions = useLayoutStore.getState().sessions;
    expect(sessions.has('__LOCALID_stale')).toBe(false);
    expect(sessions.has('chat-b')).toBe(true);
    expect(sessions.has('__LOCALID_active')).toBe(true);
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

describe('conversation tabs', () => {
  const TABS_KEY = 'mf:conversation-tabs::local';
  const fork = { id: 'chat-f', kind: 'chat' as const, title: 'Fork', chatId: 'f', role: 'fork' as const };
  const agent = { id: 'agent-c', kind: 'agent' as const, title: 'reviewer', chatId: 'chat-1', toolCallId: 'c' };
  const file = { id: 'c1', kind: 'code' as const, title: 'a.ts', path: 'a.ts' };
  const stored = (key = LAYOUT_SCOPED_KEY) => JSON.parse(localStorage.getItem(key)!);
  /** As a restart: the store starts empty and reads what was written. */
  async function restart() {
    const layoutRaw = localStorage.getItem(LAYOUT_SCOPED_KEY);
    const tabsRaw = localStorage.getItem(TABS_KEY);
    useLayoutStore.setState({ sessions: new Map(), activeSessionId: null, run: null });
    if (layoutRaw != null) localStorage.setItem(LAYOUT_SCOPED_KEY, layoutRaw);
    if (tabsRaw != null) localStorage.setItem(TABS_KEY, tabsRaw);
    await useLayoutStore.persist.rehydrate();
    useLayoutStore.getState().setActiveSession('chat-1');
  }
  const panes = () =>
    useLayoutStore.getState().run?.panes.map((p) => ({ tabs: p.tabs.map((t) => t.id), active: p.active })) ?? null;

  beforeEach(() => {
    setActiveDaemon({ id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:0', token: null });
    localStorage.clear();
    useLayoutStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      run: null,
      layout: { top: ['chat'], topFlex: {} },
    });
    useLayoutStore.getState().setActiveSession('chat-1');
  });

  it('come back across a restart, in their place and in front', async () => {
    const { addRunTab } = useLayoutStore.getState();
    addRunTab(fork);
    addRunTab(file);
    addRunTab(agent);
    await restart();
    expect(panes()).toEqual([{ tabs: ['chat-f', 'c1', 'agent-c'], active: 'agent-c' }]);
    expect(useLayoutStore.getState().run!.panes[0]!.tabs[0]).toEqual(fork);
    expect(useLayoutStore.getState().run!.panes[0]!.tabs[2]).toEqual(agent);
  });

  it('come back behind the file that was in front', async () => {
    useLayoutStore.getState().addRunTab(fork);
    useLayoutStore.getState().addRunTab(file);
    await restart();
    expect(panes()).toEqual([{ tabs: ['chat-f', 'c1'], active: 'c1' }]);
  });

  it('come back with nothing else open, and in a pane of their own', async () => {
    useLayoutStore.getState().addRunTab(fork);
    await restart();
    expect(panes()).toEqual([{ tabs: ['chat-f'], active: 'chat-f' }]);

    useLayoutStore.setState({
      sessions: new Map([
        [
          'chat-1',
          {
            layout,
            run: {
              dir: 'h' as const,
              flex: [2, 1],
              panes: [
                { id: 'p1', tabs: [fork], active: 'chat-f' },
                { id: 'p2', tabs: [file], active: 'c1' },
              ],
            },
          },
        ],
      ]),
    });
    await restart();
    expect(panes()).toEqual([
      { tabs: ['chat-f'], active: 'chat-f' },
      { tabs: ['c1'], active: 'c1' },
    ]);
    expect(useLayoutStore.getState().run).toMatchObject({ dir: 'h', flex: [2, 1] });
  });

  it('are not in the layout an older build reads, which is one it knows', () => {
    const { addRunTab, setTopFrac } = useLayoutStore.getState();
    addRunTab(file);
    addRunTab(fork);
    setTopFrac(0.4);
    const { version, state } = stored();
    expect(version).toBe(2);
    expect(state.sessions['chat-1']).toEqual({
      layout: {
        top: ['chat', 'workspace'],
        bottom: null,
        topFlex: { chat: 0.4, workspace: 0.6 },
        vFlex: { top: 1, bottom: 0.4 },
      },
      run: { dir: 'v', flex: [1], panes: [{ id: expect.any(String), tabs: [file], active: 'c1' }] },
    });
    expect(localStorage.getItem(LAYOUT_SCOPED_KEY)).not.toContain('"chat-f"');
  });

  it('join what an older build left open since, two panes at most', async () => {
    useLayoutStore.getState().addRunTab(fork);
    const raw = stored();
    raw.state.sessions['chat-1'].run = {
      dir: 'v',
      flex: [1, 1],
      panes: [
        { id: 'n1', tabs: [file], active: 'c1' },
        { id: 'n2', tabs: [{ ...file, id: 'c2', path: 'b.ts' }], active: 'c2' },
      ],
    };
    const text = JSON.stringify(raw);
    const tabs = localStorage.getItem(TABS_KEY)!;
    useLayoutStore.setState({ sessions: new Map() });
    localStorage.setItem(LAYOUT_SCOPED_KEY, text);
    localStorage.setItem(TABS_KEY, tabs);
    await restart();
    expect(panes()).toEqual([
      { tabs: ['c1', 'chat-f'], active: 'c1' },
      { tabs: ['c2'], active: 'c2' },
    ]);
  });

  it('lost or unreadable, they cost nothing else', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useLayoutStore.getState().addRunTab(file);
    useLayoutStore.getState().addRunTab(fork);
    localStorage.setItem(TABS_KEY, '{not json');
    await restart();
    expect(panes()).toEqual([{ tabs: ['c1'], active: 'c1' }]);

    localStorage.setItem(TABS_KEY, JSON.stringify({ 'chat-1': { panes: [null, { id: 4, tabs: 'x' }] } }));
    await restart();
    expect(panes()).toEqual([{ tabs: ['c1'], active: 'c1' }]);
    warn.mockRestore();
  });
});

describe('what is read', () => {
  const read = (sessions: unknown) =>
    (
      layoutPersistOptions.merge!({ sessions }, useLayoutStore.getState()) as {
        sessions: Map<string, SessionWorkspace>;
      }
    ).sessions;
  const good = { layout, run: run([{ id: 'c1', kind: 'code', title: 'a.ts', path: 'a.ts' }]) };

  it('drops a tab of a kind this build does not know', () => {
    const out = read({
      'chat-1': {
        layout,
        run: run([
          { id: 'x', kind: 'hologram', title: 'From the future' },
          { id: 'c1', kind: 'code', title: 'a.ts', path: 'a.ts' },
        ]),
      },
    });
    expect(out.get('chat-1')!.run!.panes[0]).toMatchObject({ active: 'c1', tabs: [{ id: 'c1' }] });
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['no layout', { run: null }],
    ['a layout with no surfaces', { layout: {}, run: null }],
    ['surfaces that are not a list', { layout: { top: 'chat' }, run: null }],
    ['flex that is not an object', { layout: { top: ['chat'], topFlex: 3 }, run: null }],
    ['panes that are not a list', { layout, run: { dir: 'v', flex: [1], panes: 'none' } }],
    ['a pane with no tabs', { layout, run: { dir: 'v', flex: [1], panes: [{ id: 'p' }] } }],
    [
      'a tab that is nothing',
      { layout, run: { dir: 'v', flex: [1], panes: [{ id: 'p', tabs: [null], active: null }] } },
    ],
  ])('keeps the other sessions when one entry is %s', (_, bad) => {
    const out = read({ bad, 'chat-1': good });
    expect(out.get('chat-1')).toEqual({ layout, run: { ...good.run, flex: [1] } });
    const salvaged = out.get('bad');
    if (salvaged) expect(salvaged.layout.top.length).toBeGreaterThan(0);
  });

  it('reads a malformed list of sessions as none', () => {
    expect(read('nope').size).toBe(0);
    expect(read([good]).size).toBe(0);
  });

  it('keeps the good entries through the version migration too', () => {
    const old = { top: ['chat', 'run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } };
    const migrated = layoutPersistOptions.migrate!({ sessions: { bad: {}, 'chat-1': { layout: old, run: null } } }, 1);
    const out = read((migrated as { sessions: unknown }).sessions);
    expect(out.get('chat-1')!.layout.top).toEqual(['chat', 'workspace']);
  });

  it('keeps a dragged width whose value is a number only', () => {
    const out = read({
      'chat-1': { layout: { top: ['chat', 'workspace'], topFlex: { workspace: 'wide' } }, run: null },
    });
    expect(out.get('chat-1')!.layout.topFlex).toEqual({});
  });
});
