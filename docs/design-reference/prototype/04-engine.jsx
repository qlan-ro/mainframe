// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Engine: inspector, status bar, layout + typed-surface workspace, root
// Loaded as an ordered <script type="text/babel"> after React. All module
// files share one global scope (Babel executes them in document order),
// so symbols defined earlier (tokens, Icon, data) are visible here.
// Depends on: 01-base, 02-chrome, 03-content
// ════════════════════════════════════════════════════════════════

const TASKS_DATA = [
  { id: 2, t: 'Show warning errors in consumption details UI', done: false },
  { id: 4, t: 'Search in chat content',  done: false },
  { id: 5, t: 'Desktop, Mobile — Enable/disable notifications', done: false },
  { id: 6, t: 'After archiving a session, switch to next worktree automatically', done: false },
  { id: 7, t: 'Move skills panel to bottom drawer', done: true },
  { id: 8, t: 'Wire up @-mentions in composer', done: true },
];

function TasksList({ filter = 'active' }) {
  const items = filter === 'active'
    ? TASKS_DATA.filter(t => !t.done)
    : TASKS_DATA;
  return (
    <div style={{ padding: '4px 0' }}>
      {items.map(it => (
        <div key={it.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: 9,
          padding: '5px 14px 6px', cursor: 'pointer',
        }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
           onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <span style={{
            width: 13, height: 13, borderRadius: '50%',
            border: `1.5px solid ${it.done ? T.green : T.text4}`,
            background: it.done ? T.green : 'transparent', flexShrink: 0,
            marginTop: 1,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {it.done && <span style={{ color: '#fff', fontSize: 8, fontWeight: 800 }}>✓</span>}
          </span>
          <span style={{
            fontFamily: MONO, fontSize: 10, color: T.text3,
            flexShrink: 0, marginTop: 1,
          }}>#{it.id}</span>
          <span style={{
            flex: 1, fontFamily: FONT, fontSize: 12,
            color: it.done ? T.text3 : T.text,
            textDecoration: it.done ? 'line-through' : 'none',
            lineHeight: 1.4, letterSpacing: -0.05,
          }}>{it.t}</span>
        </div>
      ))}
    </div>
  );
}

function Inspector() {
  const [tab, setTab] = React.useState('files');
  const [drawerTab, setDrawerTab] = React.useState('tasks');
  const [drawerH, setDrawerH] = React.useState(220);
  const wrapRef = React.useRef(null);
  const activeTasks = TASKS_DATA.filter(t => !t.done).length;

  function onDragStart(e) {
    e.preventDefault();
    const startY = e.clientY, startH = drawerH;
    const wrap = wrapRef.current;
    const maxH = wrap ? wrap.clientHeight - 160 : 600;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const delta = startY - ev.clientY;
      const next = Math.max(80, Math.min(maxH, startH + delta));
      setDrawerH(next);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div ref={wrapRef} style={{
      width: 288, flexShrink: 0, background: T.content2,
      borderRadius: 13,
      boxShadow: `0 0 0 0.5px ${T.border}, 0 1px 2px rgba(0,0,0,0.04)`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: FONT, color: T.text,
    }}>
      {/* Top: Files / Changes */}
      <div style={{ padding: '10px 12px 8px', flexShrink: 0 }}>
        <div style={{
          display: 'flex', gap: 2, padding: 2, borderRadius: 8, background: T.chipBg,
        }}>
          {[
            { id: 'files',   l: 'Files',   ic: 'folder',  n: null },
            { id: 'changes', l: 'Changes', ic: 'diff',    n: 7 },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, height: 22, borderRadius: 6, border: 'none',
              background: tab === t.id ? T.tabBarActive : 'transparent',
              boxShadow: tab === t.id ? `0 0.5px 0 ${T.border}, 0 1px 2px rgba(0,0,0,0.06)` : 'none',
              color: tab === t.id ? T.text : T.text2,
              fontWeight: tab === t.id ? 600 : 500, fontFamily: FONT, fontSize: 11,
              cursor: 'pointer', letterSpacing: -0.05,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              <Icon name={t.ic} size={11} color={tab === t.id ? T.text : T.text2}/>
              {t.l}
              {t.n != null && (
                <span style={{ fontFamily: MONO, fontSize: 10, color: T.text3 }}>{t.n}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'files' && <FilesInspector/>}
        {tab === 'changes' && <ChangesInspector/>}
      </div>

      {/* Resize handle */}
      <div onMouseDown={onDragStart}
        onMouseEnter={(e) => e.currentTarget.firstChild.style.background = ACCENT}
        onMouseLeave={(e) => e.currentTarget.firstChild.style.background = T.border}
        style={{
          flexShrink: 0, height: 5, cursor: 'row-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <div style={{ width: '100%', height: 1, background: T.border, transition: 'background 0.15s' }}/>
      </div>

      {/* Bottom drawer: Tasks (extensible) */}
      <div style={{
        flexShrink: 0, height: drawerH,
        display: 'flex', flexDirection: 'column',
        background: 'rgba(0,0,0,0.015)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', padding: '4px 8px',
          gap: 2, borderBottom: `0.5px solid ${T.hairline}`, flexShrink: 0,
        }}>
          {[
            { id: 'tasks',  l: 'Tasks',  n: activeTasks, ic: 'circle.dotted' },
          ].map(t => (
            <button key={t.id} onClick={() => setDrawerTab(t.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 9px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: drawerTab === t.id ? T.tabBarActive : 'transparent',
              boxShadow: drawerTab === t.id ? `0 0.5px 0 ${T.border}, 0 1px 2px rgba(0,0,0,0.06)` : 'none',
              color: drawerTab === t.id ? T.text : T.text2,
              fontFamily: FONT, fontSize: 11, fontWeight: drawerTab === t.id ? 600 : 500,
              letterSpacing: -0.05,
            }}>
              <Icon name={t.ic} size={11} color={drawerTab === t.id ? ACCENT : T.text2}/>
              {t.l}
              <span style={{
                fontFamily: MONO, fontSize: 10, color: T.text3,
              }}>{t.n}</span>
            </button>
          ))}
          <div style={{ flex: 1 }}/>
          <button title="New task" style={{
            width: 22, height: 22, border: 'none', background: 'transparent',
            borderRadius: 4, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name="plus" size={11} color={T.text3}/></button>
          <button title="Open in popover" style={{
            width: 22, height: 22, border: 'none', background: 'transparent',
            borderRadius: 4, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name="pop" size={11} color={T.text3}/></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {drawerTab === 'tasks' && <TasksList/>}
        </div>
      </div>
    </div>
  );
}

function FilesInspector() {
  const ws = React.useContext(WorkspaceCtx);
  const tree = [
    { l: 'test-all-prs', f: true, open: true, d: 0, root: true },
    { l: 'desktop', f: true, open: true, d: 1 },
    { l: 'src', f: true, open: true, d: 2 },
    { l: 'components', f: true, open: true, d: 3 },
    { l: 'Layout.tsx', d: 4, sel: true },
    { l: 'LeftRail.tsx', d: 4 },
    { l: 'Sidebar.tsx', d: 4 },
    { l: 'CenterPanel.tsx', d: 4 },
    { l: 'store', f: true, d: 3 },
    { l: 'App.tsx', d: 3 },
    { l: 'index.html', d: 3 },
    { l: 'daemon', f: true, d: 1 },
    { l: 'scripts', f: true, d: 1 },
  ];
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 12px',
      }}>
        <span style={{
          fontFamily: MONO, fontSize: 10, color: T.text3,
          textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, flex: 1,
        }}>~/.worktrees</span>
        <button style={{
          width: 20, height: 20, border: 'none', background: 'transparent',
          borderRadius: 4, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="arrow.clockwise" size={11} color={T.text3}/></button>
      </div>
      {tree.map((it, i) => (
        <div key={i}
          onClick={() => { if (!it.f) ws && ws.openTarget({ kind: 'code', file: it.l }); }}
          onDoubleClick={() => { if (!it.f) ws && ws.openTarget({ kind: 'code', file: it.l }, { mode: 'permanent' }); }}
          style={{
          display: 'flex', alignItems: 'center', gap: 5,
          paddingLeft: 10 + it.d * 12, paddingRight: 12,
          height: 22, fontSize: 12, cursor: 'pointer',
          background: it.sel ? T.rowHover : 'transparent',
          color: it.sel ? T.text : (it.f ? T.text : T.text2),
          fontWeight: it.sel ? 600 : (it.f ? (it.root ? 600 : 500) : 400),
          letterSpacing: -0.1,
          borderLeft: it.sel ? `2px solid ${ACCENT}` : '2px solid transparent',
          paddingLeft: 8 + it.d * 12,
        }}>
          {it.f ? <>
            <Icon name="chevron.down" size={9} color={T.text3}
              style={{ transform: it.open ? 'none' : 'rotate(-90deg)' }}/>
            <Icon name="folder.fill" size={12} color={ACCENT}/>
          </> : <>
            <span style={{ width: 9 }}/>
            <Icon name="doc" size={11} color={T.text3}/>
          </>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.l}</span>
        </div>
      ))}
    </div>
  );
}

function ContextInspector() {
  return (
    <div style={{ padding: '4px 0' }}>
      <ContextSection icon="circle.dotted" title="Tasks" count={3} defaultOpen>
        {[
          { t: 'Merge all queued PRs into worktree', done: true },
          { t: 'Run e2e suite against merged tree',  done: true },
          { t: 'Surface failures + auto-rebase plan' },
        ].map((it, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '4px 14px', fontSize: 12, color: T.text, letterSpacing: -0.05,
          }}>
            <span style={{
              width: 12, height: 12, borderRadius: 4,
              border: `1.5px solid ${it.done ? T.green : T.text4}`,
              background: it.done ? T.green : 'transparent', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {it.done && <span style={{ color: '#fff', fontSize: 8, fontWeight: 800 }}>✓</span>}
            </span>
            <span style={{
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textDecoration: it.done ? 'line-through' : 'none',
              color: it.done ? T.text3 : T.text,
            }}>{it.t}</span>
          </div>
        ))}
      </ContextSection>

      <ContextSection icon="wifi" title="Global" count={2} defaultOpen>
        {[
          '~/CLAUDE.md',
          '~/.claude/AGENTS.md',
        ].map(p => <ContextFileItem key={p} path={p}/>)}
      </ContextSection>

      <ContextSection icon="folder" title="Project" count={4} defaultOpen>
        {[
          'CLAUDE.md',
          'docs/architecture.md',
          'docs/zones.md',
          '.claude/settings.json',
        ].map(p => <ContextFileItem key={p} path={p}/>)}
      </ContextSection>

      <ContextSection icon="chat" title="Session" count={8} defaultOpen>
        {[
          { p: 'desktop/src/renderer/components/Layout.tsx', b: '@' },
          { p: 'desktop/src/renderer/components/zone/use-zone-header-tabs.ts', b: 'auto' },
          { p: 'desktop/src/renderer/store/layout.ts', b: 'plan' },
          { p: 'desktop/src/renderer/components/Sidebar.tsx', b: 'auto' },
          { p: 'scripts/run-tests.sh', b: 'skill' },
        ].map(it => <ContextFileItem key={it.p} path={it.p} badge={it.b}/>)}
      </ContextSection>
    </div>
  );
}

function ContextSection({ icon, title, count, children, defaultOpen = false }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ marginBottom: 4 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%',
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', border: 'none', background: 'transparent',
        cursor: 'pointer', textAlign: 'left',
      }}>
        <Icon name="chevron.down" size={9} color={T.text3}
          style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}/>
        <Icon name={icon} size={11} color={T.text2}/>
        <span style={{
          fontFamily: FONT, fontSize: 11, fontWeight: 600, color: T.text,
          letterSpacing: -0.05, flex: 1,
        }}>{title}</span>
        <span style={{
          fontFamily: MONO, fontSize: 10, color: T.text3,
          padding: '0 5px', borderRadius: 6, background: T.chipBg,
        }}>{count}</span>
      </button>
      {open && <div style={{ padding: '0 0 4px' }}>{children}</div>}
    </div>
  );
}

function ContextFileItem({ path, badge }) {
  const parts = path.split('/');
  const name = parts.pop();
  const dir = parts.join('/');
  const badgeColor = {
    '@': ACCENT, auto: T.text3, plan: T.amber, skill: '#bf5af2',
  }[badge] ?? T.text3;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '3px 14px 3px 24px',
      fontSize: 11, color: T.text2, letterSpacing: -0.05,
      cursor: 'pointer',
    }}>
      <Icon name="doc" size={10} color={T.text3}/>
      <span style={{
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        <span style={{ color: T.text }}>{name}</span>
        {dir && <span style={{ color: T.text3, marginLeft: 4 }}>{dir}</span>}
      </span>
      {badge && (
        <span style={{
          fontFamily: MONO, fontSize: 10, fontWeight: 700,
          padding: '1px 4px', borderRadius: 4,
          background: badgeColor + '20', color: badgeColor,
          textTransform: 'uppercase', letterSpacing: 0.3, flexShrink: 0,
        }}>{badge}</span>
      )}
    </div>
  );
}

function ChangesInspector() {
  const ws = React.useContext(WorkspaceCtx);
  const [mode, setMode] = React.useState('session');
  const FILES = {
    session: [
      { p: 'desktop/src/renderer/components/Layout.tsx',         s: 'M' },
      { p: 'desktop/src/renderer/components/Sidebar.tsx',        s: 'M' },
      { p: 'desktop/src/renderer/store/layout.ts',               s: 'A' },
      { p: 'desktop/src/renderer/components/zone/old-tabs.ts',   s: 'D' },
    ],
    uncommitted: [
      { p: 'desktop/src/renderer/components/Layout.tsx',         s: 'M' },
      { p: 'package.json',                                        s: 'M' },
      { p: 'desktop/src/renderer/store/layout.ts',               s: 'A' },
    ],
    branch: [
      { p: 'desktop/src/renderer/components/Layout.tsx',         s: 'M' },
      { p: 'desktop/src/renderer/components/Sidebar.tsx',        s: 'M' },
      { p: 'desktop/src/renderer/components/center/CenterPanel.tsx', s: 'M' },
      { p: 'desktop/src/renderer/store/layout.ts',               s: 'A' },
      { p: 'desktop/src/renderer/store/tabs.ts',                 s: 'A' },
      { p: 'desktop/src/renderer/components/zone/old-tabs.ts',   s: 'D' },
      { p: 'docs/zones.md',                                       s: 'M' },
    ],
  };
  const statusLabel = { M: ['Modified', T.amber], A: ['Added', T.green], D: ['Deleted', T.red] };
  const files = FILES[mode];
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 12px 8px',
      }}>
        <div style={{
          display: 'flex', gap: 2, padding: 2, borderRadius: 6,
          background: T.chipBg, flex: 1,
        }}>
          {[
            { id: 'session',     l: 'Session' },
            { id: 'uncommitted', l: 'Uncommitted' },
            { id: 'branch',      l: 'Branch' },
          ].map(t => (
            <button key={t.id} onClick={() => setMode(t.id)} style={{
              flex: 1, height: 18, borderRadius: 4, border: 'none', cursor: 'pointer',
              background: mode === t.id ? T.tabBarActive : 'transparent',
              boxShadow: mode === t.id ? `0 0.5px 0 ${T.border}, 0 1px 2px rgba(0,0,0,0.06)` : 'none',
              color: mode === t.id ? T.text : T.text2,
              fontFamily: FONT, fontSize: 10, fontWeight: mode === t.id ? 600 : 500,
              letterSpacing: -0.05,
            }}>{t.l}</button>
          ))}
        </div>
        <button style={{
          width: 20, height: 20, border: 'none', background: 'transparent',
          borderRadius: 4, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="arrow.clockwise" size={11} color={T.text3}/></button>
      </div>
      <div style={{
        padding: '0 12px 6px',
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: FONT, fontSize: 10, color: T.text3, letterSpacing: -0.05,
      }}>
        <span>{files.length} changed file{files.length !== 1 ? 's' : ''}</span>
        <div style={{ flex: 1 }}/>
        {mode === 'branch' && (
          <span style={{ fontFamily: MONO, fontSize: 10, color: ACCENT }}>
            test/all-prs-merged ↔ main
          </span>
        )}
      </div>
      <div style={{ padding: '0 6px 6px' }}>
        {files.map(f => {
          const parts = f.p.split('/');
          const name = parts.pop();
          const dir = parts.join('/');
          const [label, color] = statusLabel[f.s];
          return (
            <div key={f.p}
              onClick={() => ws && ws.openTarget({ kind: 'diff', file: name, title: `${name} (diff)` })}
              onDoubleClick={() => ws && ws.openTarget({ kind: 'diff', file: name, title: `${name} (diff)` }, { mode: 'permanent' })}
              style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '4px 6px', borderRadius: 4,
              fontSize: 11, cursor: 'pointer', letterSpacing: -0.05,
            }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
               onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <Icon name="doc" size={10} color={T.text3}/>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: T.text }}>{name}</span>
                {dir && <span style={{ color: T.text3, marginLeft: 4, fontSize: 10 }}>{dir}</span>}
              </span>
              <span style={{
                fontFamily: FONT, fontSize: 10, fontWeight: 700, color,
                letterSpacing: 0.3, flexShrink: 0,
              }}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: T.text2,
      textTransform: 'uppercase', letterSpacing: 0.6,
      display: 'flex', alignItems: 'center',
    }}>{children}</div>
  );
}

// ── Status bar (matches real app: connection · branch · counts · update) ─
function StatusBar() {
  return (
    <div style={{
      height: 22, flexShrink: 0, background: T.glass,
      backdropFilter: 'blur(40px) saturate(180%)',
      WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      borderTop: `0.5px solid ${T.border}`,
      display: 'flex', alignItems: 'center', padding: '0 12px', gap: 16,
      fontFamily: FONT, fontSize: 10, color: T.text3, letterSpacing: -0.05,
    }}>
      {/* Connection */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.text2 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green }}/>
        Connected
      </span>

      {/* Git branch — opens the real branch switcher (upward, since the status bar
          sits at the bottom of the viewport). */}
      <BranchPopover side="top" align="start" trigger={({ toggle, open }) => (
        <button onClick={toggle} title="Switch branch" style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          height: 18, padding: '0 6px', borderRadius: 4, marginLeft: -6,
          border: 'none', background: open ? T.rowHover : 'transparent', cursor: 'pointer',
          color: T.text2, fontFamily: FONT, fontSize: 10, letterSpacing: -0.05,
        }} onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = T.rowHover; }}
           onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
          <Icon name="branch" size={11} color={ACCENT}/>
          <span style={{ fontFamily: MONO }}>{BRANCH_CURRENT}</span>
        </button>
      )}/>

      {/* Session counts */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: T.text2 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: ACCENT,
          }} className="tw-pulse"/>
          2 Working
        </span>
        <span style={{ color: T.amber }}>1 Needs Input</span>
        <span>4 Idle</span>
      </span>

      <div style={{ flex: 1 }}/>

      {/* Update indicator (right) */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, color: ACCENT, cursor: 'pointer',
      }}>
        <Icon name="arrow.down" size={10} color={ACCENT}/>
        Update v0.20.0
      </span>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

// Tree helpers --------------------------------------------------------
let _nid = 1;
function genId(prefix) {
  return `${prefix}-${++_nid}-${Math.random().toString(36).slice(2, 6)}`;
}

// Files you can open into a pane, and the changed files you can diff.
const OPENABLE_FILES = [
  'Layout.tsx', 'Sidebar.tsx', 'LeftRail.tsx', 'CenterPanel.tsx',
  'use-zone-header-tabs.ts', 'layout.ts', 'App.tsx', 'package.json',
  'README.md', 'CHANGELOG.md', 'metrics.csv', 'usage.csv',
  'logo.svg', 'badge.svg', 'hero-screenshot.png', 'onboarding.png',
  'spec.pdf', 'design-review.pdf',
];
const DIFFABLE_FILES = [
  { f: 'Layout.tsx', s: 'M' },
  { f: 'Sidebar.tsx', s: 'M' },
  { f: 'layout.ts', s: 'A' },
  { f: 'use-zone-header-tabs.ts', s: 'M' },
];

// Shared so any click source (file tree, Changes tab, chat rows) routes
// file/diff opens through openTargetWS — the typed-surface engine below.
const WorkspaceCtx = React.createContext(null);
// ═════════════════════════════════════════════════════════════════════
// TYPED-SURFACE WORKSPACE ENGINE
// ═════════════════════════════════════════════════════════════════════
// Supersedes the free-form 5-way docking tree. Three TYPED surfaces:
//   • Chat  — singleton spine. Always available; always claims a top column.
//   • Files — singleton destination for every file/diff open (+ guests).
//   • Run   — Preview + N terminals; can split internally.
// Layout grammar: grow by intent · chat-anchored + by-arrival ·
//   ≤2 top columns + one full-width bottom strip by default ·
//   arbitrary shapes only by manual drag. Only ever three surfaces.

const clone = (o) => JSON.parse(JSON.stringify(o));

// ── pure layout helpers ───────────────────────────────────────────────
function listSurfaces(layout) { const a = [...layout.top]; if (layout.bottom) a.push(layout.bottom); return a; }
function layoutHas(layout, s) { return layout.top.includes(s) || layout.bottom === s; }
function topOrder(side, others) { return side === 'left' ? ['chat', ...others] : [...others, 'chat']; }

// Keep chat on its side when inserting a non-chat surface beside it.
function insertTop(top, s, side) {
  if (s === 'chat') return side === 'left' ? ['chat', ...top] : [...top, 'chat'];
  if (top.includes('chat')) return side === 'left' ? [...top, s] : [s, ...top];
  return [...top, s];
}

// Place a surface into the layout by the by-arrival rule (LAYOUT ONLY —
// content is created by the caller). Chat always claims a top column; a
// new surface lands beside the current one if there's room, else the strip.
function placeInLayout(ws, s) {
  if (layoutHas(ws.layout, s)) return ws;
  const next = clone(ws);
  let top = [...ws.layout.top], bottom = ws.layout.bottom;
  if (s === 'chat') {
    if (top.length >= 2 && !bottom) bottom = top.pop();   // demote most-recent
    top = insertTop(top, 'chat', ws.chatSide);
  } else {
    if (top.length < 2) top = insertTop(top, s, ws.chatSide);
    else if (!bottom) bottom = s;
  }
  next.layout = { top, bottom };
  return next;
}

// Remove a surface + its content, compacting so we never leave a lonely
// bottom strip. Floor invariant: never zero surfaces → re-reveal Chat.
function removeSurface(ws, s) {
  const next = clone(ws);
  let top = ws.layout.top.filter(x => x !== s);
  let bottom = ws.layout.bottom === s ? null : ws.layout.bottom;
  if (bottom && top.length < 2) { top = insertTop(top, bottom, ws.chatSide); bottom = null; }
  if (top.length === 0 && bottom) { top = [bottom]; bottom = null; }
  if (s === 'files') next.files = null;
  if (s === 'run') next.run = null;
  if (top.length === 0 && !bottom) { top = ['chat']; }   // floor → chat
  next.layout = { top, bottom };
  return next;
}

// Manual-drag reposition. target: 'top-left' | 'top-right' | 'bottom'.
function repositionSurface(ws, s, target) {
  const next = clone(ws);
  let top = ws.layout.top.filter(x => x !== s);
  let bottom = ws.layout.bottom === s ? null : ws.layout.bottom;
  if (target === 'bottom') {
    if (s === 'chat') return ws;                  // chat never goes to the strip
    if (bottom) top = insertTop(top, bottom, ws.chatSide);
    bottom = s;
  } else if (target === 'top-left') {
    top = [s, ...top]; if (s === 'chat') next.chatSide = 'left';
  } else {
    top = [...top, s]; if (s === 'chat') next.chatSide = 'right';
  }
  next.layout = { top, bottom };
  return next;
}

// ── tab identity / content factories ──────────────────────────────────
function tabKeyOf(t) {
  const f = (t.file || t.title || '').replace(/\s*\(diff\)\s*$/i, '');
  return `${t.kind}:${f}`;
}
function freshFiles() {
  const a = { id: genId('code'), kind: 'code', title: 'Layout.tsx', file: 'Layout.tsx' };
  const b = { id: genId('diff'), kind: 'diff', title: 'Layout.tsx (diff)', file: 'Layout.tsx' };
  return { tabs: [a, b], active: a.id };
}
function freshRun() {
  const p = { id: genId('preview'), kind: 'preview', title: 'Preview', config: 'Preview', live: true };
  const t = { id: genId('term'), kind: 'terminal', title: 'zsh' };
  return { dir: 'v', flex: [1, 1], panes: [{ id: genId('pane'), tabs: [p, t], active: p.id }] };
}
function emptyRun() { return { dir: 'v', flex: [1, 1], panes: [{ id: genId('pane'), tabs: [], active: null }] }; }

// ── open-target routing (dedupe → Files singleton destination) ─────────
function openTargetWS(ws, target, mode) {
  const key = `${target.kind}:${target.file}`;
  // (1) dedupe — focus wherever it already lives (Files or a Run guest pane)
  if (ws.files) {
    const hit = ws.files.tabs.find(t => tabKeyOf(t) === key);
    if (hit) {
      const n = clone(ws);
      n.files = { ...n.files, active: hit.id, tabs: n.files.tabs.map(t => t.id === hit.id && mode === 'permanent' ? { ...t, preview: false } : t) };
      n._focus = 'files'; return n;
    }
  }
  if (ws.run) {
    for (const pane of ws.run.panes) {
      const hit = pane.tabs.find(t => tabKeyOf(t) === key);
      if (hit) {
        const n = clone(ws);
        n.run.panes = n.run.panes.map(p => p.id === pane.id ? { ...p, active: hit.id } : p);
        n._focus = 'run'; return n;
      }
    }
  }
  // (2) not open → into the Files surface (create it if absent)
  let next = clone(ws);
  const tab = { id: genId(target.kind), kind: target.kind, title: target.title || target.file, file: target.file, preview: mode !== 'permanent' };
  if (!next.files) {
    next.files = { tabs: [tab], active: tab.id };
  } else {
    let tabs = next.files.tabs;
    if (mode !== 'permanent') {
      const i = tabs.findIndex(t => t.preview);
      if (i >= 0) { tabs = [...tabs]; tabs[i] = tab; } else tabs = [...tabs, tab];
    } else tabs = [...tabs, tab];
    next.files = { tabs, active: tab.id };
  }
  if (!layoutHas(next.layout, 'files')) { const placed = placeInLayout(next, 'files'); next.layout = placed.layout; }
  next._focus = 'files';
  return next;
}

function addRunTab(ws, kind, configName) {
  let next = clone(ws);
  if (!next.run) next.run = emptyRun();
  if (kind === 'preview') {
    // Each launch config is its own tab — dedupe by config name, else open a new one.
    const cname = configName || 'Preview';
    for (const p of next.run.panes) { const pv = p.tabs.find(t => t.kind === 'preview' && (t.config || t.title) === cname); if (pv) { p.active = pv.id; if (!layoutHas(next.layout, 'run')) next.layout = placeInLayout(next, 'run').layout; next._focus = 'run'; return next; } }
    const tab = { id: genId('preview'), kind: 'preview', title: cname, config: cname, live: true };
    const pane = next.run.panes[0];
    pane.tabs = [...pane.tabs, tab]; pane.active = tab.id;
    if (!layoutHas(next.layout, 'run')) next.layout = placeInLayout(next, 'run').layout;
    next._focus = 'run';
    return next;
  }
  const tab = { id: genId('term'), kind: 'terminal', title: 'zsh' };
  const pane = next.run.panes[0];
  pane.tabs = [...pane.tabs, tab]; pane.active = tab.id;
  if (!layoutHas(next.layout, 'run')) next.layout = placeInLayout(next, 'run').layout;
  next._focus = 'run';
  return next;
}

function activateTabWS(ws, surface, paneId, tid) {
  const n = clone(ws);
  if (surface === 'files') n.files = { ...n.files, active: tid };
  else n.run = { ...n.run, panes: n.run.panes.map(p => p.id === paneId ? { ...p, active: tid } : p) };
  return n;
}

function closeFilesTab(ws, tid) {
  const tabs = ws.files.tabs.filter(t => t.id !== tid);
  if (tabs.length === 0) return removeSurface(ws, 'files');      // close last tab → surface closes
  const n = clone(ws);
  n.files = { tabs, active: ws.files.active === tid ? tabs[tabs.length - 1].id : ws.files.active };
  return n;
}

function closeRunTab(ws, paneId, tid) {
  let panes = ws.run.panes.map(p => {
    if (p.id !== paneId) return p;
    const tabs = p.tabs.filter(t => t.id !== tid);
    return { ...p, tabs, active: p.active === tid ? (tabs[tabs.length - 1]?.id ?? null) : p.active };
  }).filter(p => p.tabs.length > 0);
  if (panes.length === 0) return removeSurface(ws, 'run');        // emptied → close Run
  const n = clone(ws);
  n.run = { ...ws.run, panes, flex: panes.length === 1 ? [1, 1] : ws.run.flex };
  return n;
}

function closePaneWS(ws, paneId) {
  const panes = ws.run.panes.filter(p => p.id !== paneId);
  if (panes.length === 0) return removeSurface(ws, 'run');
  const n = clone(ws); n.run = { ...ws.run, panes, flex: [1, 1] }; return n;
}

// Drag a Files tab onto the Run region. center → join as a tab; edge →
// split Run so the file sits beside what's running. The file becomes a
// GUEST of Run (Run's toggle governs its visibility). If this empties
// Files, Files closes — but stays the singleton destination for next opens.
function moveTabToRunWS(ws, tid, edge, dropMode) {
  const tab = ws.files && ws.files.tabs.find(t => t.id === tid);
  if (!tab) return ws;
  let next = clone(ws);
  if (!next.run) next.run = emptyRun();
  const guest = { ...tab, preview: false };
  const useTab = edge === 'center' || dropMode === 'tab';
  if (useTab) {
    const pane = next.run.panes[0];
    pane.tabs = [...pane.tabs, guest]; pane.active = guest.id;
  } else {
    const dir = (edge === 'left' || edge === 'right') ? 'v' : 'h';
    const newPane = { id: genId('pane'), tabs: [guest], active: guest.id };
    const existing = next.run.panes[0];
    next.run.dir = dir;
    next.run.panes = (edge === 'left' || edge === 'top') ? [newPane, existing] : [existing, newPane];
    next.run.flex = [1, 1];
  }
  // update Files (close it if now empty)
  const fTabs = ws.files.tabs.filter(t => t.id !== tid);
  if (fTabs.length === 0) {
    next.files = null;
    let top = next.layout.top.filter(x => x !== 'files');
    let bottom = next.layout.bottom === 'files' ? null : next.layout.bottom;
    if (bottom && top.length < 2) { top = insertTop(top, bottom, next.chatSide); bottom = null; }
    next.layout = { top, bottom };
  } else {
    next.files = { tabs: fTabs, active: ws.files.active === tid ? fTabs[fTabs.length - 1].id : ws.files.active };
  }
  if (!layoutHas(next.layout, 'run')) next.layout = placeInLayout(next, 'run').layout;
  next._focus = 'run';
  return next;
}

// ── per-session workspaces ────────────────────────────────────────────
function buildWS(kind, side) {
  const base = {
    chatSide: side, topFlex: { chat: 1, files: 1, run: 1 }, vFlex: { top: 1.7, bottom: 1 },
    files: null, run: null, layout: { top: ['chat'], bottom: null }, title: '',
  };
  if (kind === 'chat') return base;
  if (kind === 'chat-files') { base.files = freshFiles(); base.layout = { top: topOrder(side, ['files']), bottom: null }; return base; }
  if (kind === 'chat-run') { base.run = freshRun(); base.layout = { top: topOrder(side, ['run']), bottom: null }; return base; }
  if (kind === 'all') { base.files = freshFiles(); base.run = freshRun(); base.layout = { top: topOrder(side, ['files']), bottom: 'run' }; return base; }
  return base;
}
function buildInitialSessions(side, initialKind) {
  const map = {};
  SESSIONS_DATA.forEach(s => { const w = buildWS('chat', side); w.title = s.t; map[s.id] = w; });
  map['s1'] = Object.assign(buildWS(initialKind, side), { title: SESSIONS_DATA[0].t });
  map['s3'] = Object.assign(buildWS('all', side), { title: SESSIONS_DATA[2].t });   // visible (agentic) → full 3-surface layout
  map['s2'] = Object.assign(buildWS('chat-run', side), { title: SESSIONS_DATA[1].t });
  map['s4'] = Object.assign(buildWS('chat-run', side), { title: SESSIONS_DATA[3].t });
  return map;
}

// ── shared style atoms ────────────────────────────────────────────────
const surfaceCard = {
  display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
  background: T.content, borderRadius: 11, overflow: 'hidden',
  boxShadow: `0 0 0 0.5px ${T.border}, 0 1px 2px rgba(0,0,0,0.05)`,
};
const hdrBtn = {
  width: 24, height: 24, display: 'grid', placeItems: 'center', border: 'none',
  background: 'transparent', cursor: 'pointer', borderRadius: 6,
};

// ═════════════════════════════════════════════════════════════════════
// VIEW
// ═════════════════════════════════════════════════════════════════════
function SurfaceBody({ tab }) {
  switch (tab.kind) {
    case 'code': return <CodePane filename={tab.title}/>;
    case 'diff': return <DiffPane/>;
    case 'terminal': return <TerminalPane/>;
    case 'preview': return <PreviewPane configName={tab.config || tab.title}/>;
    case 'markdown': return window.MarkdownViewer ? <window.MarkdownViewer file={tab.file}/> : null;
    case 'csv': return window.CsvViewer ? <window.CsvViewer file={tab.file}/> : null;
    case 'image': return window.ImageViewer ? <window.ImageViewer file={tab.file}/> : null;
    case 'svg': return window.SvgViewer ? <window.SvgViewer file={tab.file}/> : null;
    case 'pdf': return window.PdfViewer ? <window.PdfViewer file={tab.file}/> : null;
    default: return window.UnsupportedViewer ? <window.UnsupportedViewer file={tab.file}/> : null;
  }
}

function MenuLabel({ children }) {
  return <div style={{ padding: '5px 8px 4px', fontSize: 10, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>{children}</div>;
}
function MenuRow({ icon, color, label, hint, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
      cursor: 'pointer', fontSize: 12, color: T.text, letterSpacing: -0.1,
    }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
       onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <Icon name={icon} size={13} color={color}/>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {hint && <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4 }}>{hint}</span>}
    </div>
  );
}

// Type-scoped "+" menu. Files → Open file / View changes (never terminal/
// preview). Run → New terminal / Open preview. Cross-type tabs only by drag.
function AddMenu({ surface, paneId, actions, close }) {
  return (<React.Fragment>
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 49 }}/>
    <div style={{
      position: 'absolute', top: 28, left: 0, zIndex: 50, width: 214,
      background: T.popBg, borderRadius: 8, padding: 4, maxHeight: 360, overflowY: 'auto',
      boxShadow: '0 12px 32px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.16)',
    }}>
      {surface === 'files' ? (<React.Fragment>
        <MenuLabel>Open file</MenuLabel>
        {OPENABLE_FILES.map(f => { const ic = window.iconForFile ? window.iconForFile(f) : { icon: 'doc', color: T.text3 }; return <MenuRow key={f} icon={ic.icon} color={ic.color} label={f} onClick={() => { actions.openFile(f); close(); }}/>; })}
        <div style={{ height: 1, background: T.hairline, margin: '4px 8px' }}/>
        <MenuLabel>View changes</MenuLabel>
        {DIFFABLE_FILES.map(({ f, s }) => <MenuRow key={f} icon="diff" color={{ M: T.amber, A: T.green, D: T.red }[s]} label={f} hint={s} onClick={() => { actions.openDiff(f); close(); }}/>)}
      </React.Fragment>) : (<React.Fragment>
        <MenuLabel>New terminal</MenuLabel>
        <MenuRow icon="terminal" color={TAB_TYPES.terminal.color} label="New terminal" hint="zsh" onClick={() => { actions.addRun('terminal'); close(); }}/>
        <div style={{ height: 1, background: T.hairline, margin: '4px 8px' }}/>
        <MenuLabel>Launch configuration</MenuLabel>
        {LAUNCH_CONFIGS.map(c => (
          <MenuRow key={c.name} icon={c.preview ? 'eye' : 'terminal'} color={c.preview ? TAB_TYPES.preview.color : T.text3}
            label={c.name} hint={c.preview ? 'preview' : 'process'} onClick={() => { actions.addRun('preview', c.name); close(); }}/>
        ))}
      </React.Fragment>)}
    </div>
  </React.Fragment>);
}

function SurfaceTabStrip({ surface, primary, paneId, tabs, active, drag, actions, canClosePane }) {
  const [menu, setMenu] = React.useState(false);
  const meta = SURFACE_META[surface];
  const isFiles = surface === 'files';
  const labelFor = (t) => (t.kind === 'preview') ? (t.config || t.title) : t.title;
  return (
    <div style={{
      height: 34, flexShrink: 0, background: T.tabBar, borderBottom: `0.5px solid ${T.border}`,
      display: 'flex', alignItems: 'center', position: 'relative',
    }}>
      {primary && (
        <div title="Drag to reposition surface"
          onPointerDown={(e) => { if (e.button === 0 && drag) drag.beginSurfaceDrag(surface, e); }}
          style={{ display: 'grid', placeItems: 'center', width: 20, height: '100%', flexShrink: 0, cursor: 'grab', paddingLeft: 4 }}>
          <Icon name="grip" size={13} color={T.text4}/>
        </div>
      )}
      <div style={{ display: 'inline-flex', alignItems: 'center', paddingLeft: primary ? 4 : 10, paddingRight: 4, flexShrink: 0 }}>
        <Icon name={meta.icon} size={11} color={meta.color}/>
      </div>
      <div style={{
        flex: '0 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 2,
        height: '100%', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', paddingRight: 2,
      }}>
        {tabs.map(t => {
          const tm = TAB_TYPES[t.kind]; const a = t.id === active;
          // Launch-config (preview-kind) tabs read their look from the config so a
          // process tab never looks like a raw terminal: webview→eye, process→play.
          let tIcon = tm.icon, tColor = tm.color;
          if (t.kind === 'preview') {
            const lcfg = LAUNCH_CONFIGS.find(c => c.name === (t.config || t.title));
            if (lcfg && !lcfg.preview) { tIcon = 'play.fill'; tColor = T.green; }
            else { tIcon = 'eye'; tColor = TAB_TYPES.preview.color; }
          }
          return (
            <div key={t.id} className="ts-tab"
              onPointerDown={(e) => { if (isFiles && e.button === 0 && drag) drag.beginTabDrag(t.id, surface, e); }}
              onClick={() => actions.activateTab(surface, paneId, t.id)}
              title={isFiles ? 'Drag into Run to view side-by-side' : labelFor(t)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 6px 0 9px', height: 26, borderRadius: 8,
                background: a ? T.content : 'transparent',
                boxShadow: a ? `0 0 0 0.5px ${T.border}, 0 1px 2px rgba(0,0,0,0.05)` : 'none',
                cursor: isFiles ? 'grab' : 'pointer', flexShrink: 0, transition: 'background 120ms ease',
              }}
              onMouseEnter={(e) => { if (!a) e.currentTarget.style.background = T.rowHover; }}
              onMouseLeave={(e) => { if (!a) e.currentTarget.style.background = 'transparent'; }}>
              <Icon name={tIcon} size={11} color={a ? tColor : T.text3}/>
              <span style={{
                fontFamily: FONT, fontSize: 12, fontWeight: a ? 600 : 500, color: a ? T.text : T.text2,
                fontStyle: t.preview ? 'italic' : 'normal', letterSpacing: -0.1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150,
              }}>{labelFor(t)}</span>
              <span style={{ position: 'relative', width: 14, height: 14, flexShrink: 0 }}>
                {t.live && (
                  <span className="ts-dot" style={{ position: 'absolute', inset: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="tw-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT }}/>
                  </span>
                )}
                <button className="ts-x" onClick={(e) => { e.stopPropagation(); actions.closeTab(surface, paneId, t.id); }} title="Close tab"
                  style={{ position: 'absolute', inset: 0, width: 14, height: 14, padding: 0, border: 'none', background: 'transparent', borderRadius: 4, cursor: 'pointer', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="xmark" size={9} color={T.text3}/>
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'relative', marginLeft: 2, flexShrink: 0 }}>
        <button onClick={() => setMenu(m => !m)} title={isFiles ? 'Open file / View changes' : 'New terminal / Open preview'}
          style={{ ...gActionStyle(), background: menu ? T.chipBg : 'transparent' }}>
          <Icon name="plus" size={11} color={T.text3}/>
        </button>
        {menu && <AddMenu surface={surface} paneId={paneId} actions={actions} close={() => setMenu(false)}/>}
      </div>
      <div style={{ flex: 1 }}/>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px 0 2px', gap: 1, flexShrink: 0 }}>
        {primary && actions.canSplit && actions.canSplit() && (
          <React.Fragment>
            <button title="Split right" onClick={() => actions.splitSurface('v')} style={gActionStyle()}><Icon name="square.split.2x1" size={13} color={T.text3}/></button>
            <button title="Split down" onClick={() => actions.splitSurface('h')} style={gActionStyle()}><Icon name="square.split.1x2" size={13} color={T.text3}/></button>
          </React.Fragment>
        )}
        {canClosePane && <button title="Close pane (un-split)" onClick={() => actions.closePane(paneId)} style={gActionStyle()}><Icon name="square.split.2x1" size={12} color={T.text3}/></button>}
        {primary && actions.canClose(surface) && (
          <button title={`Close ${meta.label}`} onClick={() => actions.toggleSurface(surface)} style={gActionStyle()}>
            <Icon name="xmark" size={12} color={T.text3}/>
          </button>
        )}
      </div>
    </div>
  );
}

// Empty surface = an actionable picker, never a dead placeholder.
function SurfacePicker({ surface, actions }) {
  const [view, setView] = React.useState(null);
  const statusColor = { M: T.amber, A: T.green, D: T.red };
  const Row = ({ icon, color, label, hint, onClick, chevron }) => (
    <button onClick={onClick} className="ts-pick-row" style={{
      display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 12px', cursor: 'pointer',
      border: 'none', background: 'transparent', fontFamily: FONT, fontSize: 12, color: T.text, letterSpacing: -0.1, textAlign: 'left', borderRadius: 8,
    }}>
      <Icon name={icon} size={14} color={color}/>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {hint && <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4 }}>{hint}</span>}
      {chevron && <Icon name="chevron.down" size={10} color={T.text4} style={{ transform: 'rotate(-90deg)' }}/>}
    </button>
  );
  const meta = SURFACE_META[surface];
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.content, padding: 16 }}>
      <style>{`.ts-pick-row:hover{ background:${T.rowHover} !important; }`}</style>
      <div style={{
        display: 'flex', flexDirection: 'column', width: 300, background: T.content,
        border: `0.5px solid ${T.border}`, borderRadius: 13, overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.04)',
      }}>
        {view && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 10px 14px', borderBottom: `0.5px solid ${T.hairline}` }}>
            <button onClick={() => setView(null)} title="Back" style={{ width: 20, height: 20, display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6 }}>
              <Icon name="chevron.down" size={11} color={T.text2} style={{ transform: 'rotate(90deg)' }}/>
            </button>
            <Icon name={meta.icon} size={13} color={meta.color}/>
            <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: T.text2, letterSpacing: -0.1 }}>
              {view === 'file' ? 'Open a file' : 'View changes'}
            </span>
          </div>
        )}
        <div style={{ padding: 4, maxHeight: 300, overflowY: 'auto' }}>
          {surface === 'files' && view === null && (<React.Fragment>
            <Row icon="code" color={TAB_TYPES.code.color} label="Open file…" onClick={() => setView('file')} chevron/>
            <Row icon="diff" color={TAB_TYPES.diff.color} label="View changes…" onClick={() => setView('diff')} chevron/>
            <div style={{ height: 1, background: T.hairline, margin: '4px 8px' }}/>
            <MenuLabel>Recent</MenuLabel>
            {OPENABLE_FILES.slice(0, 3).map(f => { const ic = window.iconForFile ? window.iconForFile(f) : { icon: 'doc', color: T.text3 }; return <Row key={f} icon={ic.icon} color={ic.color} label={f} onClick={() => actions.openFile(f)}/>; })}
          </React.Fragment>)}
          {surface === 'files' && view === 'file' && OPENABLE_FILES.map(f => { const ic = window.iconForFile ? window.iconForFile(f) : { icon: 'doc', color: T.text3 }; return <Row key={f} icon={ic.icon} color={ic.color} label={f} onClick={() => actions.openFile(f)}/>; })}
          {surface === 'files' && view === 'diff' && DIFFABLE_FILES.map(({ f, s }) => <Row key={f} icon="diff" color={statusColor[s] || T.text3} label={f} hint={s} onClick={() => actions.openDiff(f)}/>)}
          {surface === 'run' && (<React.Fragment>
            <Row icon="terminal" color={TAB_TYPES.terminal.color} label="New terminal" hint="zsh" onClick={() => actions.addRun('terminal')}/>
            <div style={{ height: 1, background: T.hairline, margin: '4px 8px' }}/>
            <MenuLabel>Launch configuration</MenuLabel>
            {LAUNCH_CONFIGS.map(c => (
              <Row key={c.name} icon={c.preview ? 'eye' : 'terminal'} color={c.preview ? TAB_TYPES.preview.color : T.text3}
                label={c.name} hint={c.preview ? 'preview' : 'process'} onClick={() => actions.addRun('preview', c.name)}/>
            ))}
          </React.Fragment>)}
        </div>
        <div style={{ padding: '7px 14px', borderTop: `0.5px solid ${T.hairline}`, fontSize: 10, color: T.text4, fontFamily: MONO }}>
          {surface === 'files' ? 'opens route here automatically' : 'spawns a running surface'}
        </div>
      </div>
    </div>
  );
}

function ChatSurface({ ws, actions, drag, flex }) {
  return (
    <div data-surface="chat" style={{ ...surfaceCard, flex }}>
      <div title="Drag to swap Chat side"
        onPointerDown={(e) => { if (e.button === 0 && drag) drag.beginSurfaceDrag('chat', e); }}
        style={{ height: 34, flexShrink: 0, background: T.tabBar, borderBottom: `0.5px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 7, padding: '0 6px 0 8px', cursor: 'grab' }}>
        <Icon name="grip" size={13} color={T.text4}/>
        <Icon name="chat" size={13} color={ACCENT}/>
        <span className="tw-trim" style={{ flex: 1, minWidth: 0, fontFamily: FONT, fontSize: 12, fontWeight: 600, color: T.text, letterSpacing: -0.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.title}</span>
        <button title="Review changes (⌘⇧R)" onClick={() => actions.openReview && actions.openReview()} style={{ ...hdrBtn, flexShrink: 0 }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon name="clipboard.check" size={14} color={T.text2}/>
        </button>
        <span title="PR #2118" style={{
          display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
          height: 16, padding: '0 6px', borderRadius: 4,
          background: '#1a7f37', color: '#fff',
          fontFamily: MONO, fontSize: 10, fontWeight: 600,
        }}>
          <Icon name="branch" size={9} color="#fff"/>
          #2118
        </span>
        {actions.canSplit && actions.canSplit() && (
          <React.Fragment>
            <button title="Split right" onClick={() => actions.splitSurface('v')} style={hdrBtn}><Icon name="square.split.2x1" size={13} color={T.text3}/></button>
            <button title="Split down" onClick={() => actions.splitSurface('h')} style={hdrBtn}><Icon name="square.split.1x2" size={13} color={T.text3}/></button>
          </React.Fragment>
        )}
        {actions.canClose('chat') && (
          <button title="Hide Chat" onClick={() => actions.toggleSurface('chat')} style={hdrBtn}>
            <Icon name="eye.slash" size={13} color={T.text3}/>
          </button>
        )}
      </div>
      <ChatPane/>
    </div>
  );
}

function FilesSurface({ ws, actions, drag, flex }) {
  const f = ws.files || { tabs: [], active: null };
  const active = f.tabs.find(t => t.id === f.active);
  return (
    <div data-surface="files" style={{ ...surfaceCard, flex }}>
      <SurfaceTabStrip surface="files" primary tabs={f.tabs} active={f.active} drag={drag} actions={actions}/>
      {active ? <SurfaceBody tab={active}/> : <SurfacePicker surface="files" actions={actions}/>}
    </div>
  );
}

function RunPane({ pane, primary, split, actions, drag, flex }) {
  const active = pane.tabs.find(t => t.id === pane.active);
  return (
    <div style={{ flex, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: primary && split ? `0.5px solid ${T.border}` : 'none' }}>
      <SurfaceTabStrip surface="run" primary={primary} paneId={pane.id} tabs={pane.tabs} active={pane.active} drag={drag} actions={actions} canClosePane={split && !primary}/>
      {active ? <SurfaceBody tab={active}/> : <SurfacePicker surface="run" actions={actions}/>}
    </div>
  );
}

function RunSurface({ ws, actions, drag, flex }) {
  const run = ws.run; const ref = React.useRef(null);
  if (!run) return null;
  const split = run.panes.length === 2;
  return (
    <div ref={ref} data-surface="run" data-run-region style={{
      ...surfaceCard, flex, flexDirection: split && run.dir === 'h' ? 'column' : 'row', position: 'relative',
    }}>
      {run.panes.map((p, i) => (
        <React.Fragment key={p.id}>
          <RunPane pane={p} primary={i === 0} split={split} actions={actions} drag={drag} flex={run.flex[i] || 1}/>
          {split && i === 0 && <SurfDivider axis={run.dir === 'h' ? 'y' : 'x'} containerRef={ref} onFrac={(fr) => actions.setRunFrac(fr)}/>}
        </React.Fragment>
      ))}
    </div>
  );
}

function SurfaceView({ name, ws, actions, drag, flex }) {
  if (name === 'chat') return <ChatSurface ws={ws} actions={actions} drag={drag} flex={flex}/>;
  if (name === 'files') return <FilesSurface ws={ws} actions={actions} drag={drag} flex={flex}/>;
  if (name === 'run') return <RunSurface ws={ws} actions={actions} drag={drag} flex={flex}/>;
  return null;
}

function SurfDivider({ axis, containerRef, onFrac }) {
  const [hot, setHot] = React.useState(false);
  const onDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    const move = (ev) => {
      const r = containerRef.current?.getBoundingClientRect(); if (!r) return;
      const f = axis === 'x' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      onFrac(Math.max(0.18, Math.min(0.82, f)));
    };
    const up = () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const gutter = 6;
  return (
    <div onPointerDown={onDown} onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)}
      style={{
        flexShrink: 0, [axis === 'x' ? 'width' : 'height']: gutter, alignSelf: 'stretch',
        cursor: axis === 'x' ? 'col-resize' : 'row-resize', position: 'relative', zIndex: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <div style={{
        [axis === 'x' ? 'width' : 'height']: hot ? 2 : 0,
        [axis === 'x' ? 'height' : 'width']: '100%',
        background: ACCENT, borderRadius: 2, transition: 'all 0.12s',
      }}/>
    </div>
  );
}

function WorkspaceArea({ ws, actions, drag }) {
  const outerRef = React.useRef(null);
  const topRef = React.useRef(null);
  const top = ws.layout.top, bottom = ws.layout.bottom;
  const twoCol = top.length === 2;
  return (
    <div ref={outerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <div ref={topRef} style={{ flex: bottom ? ws.vFlex.top : 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
        {top.map((name, i) => (
          <React.Fragment key={name}>
            <SurfaceView name={name} ws={ws} actions={actions} drag={drag} flex={ws.topFlex[name] || 1}/>
            {i < top.length - 1 && (twoCol
              ? <SurfDivider axis="x" containerRef={topRef} onFrac={(f) => actions.setTopFrac(top[0], top[1], f)}/>
              : <div style={{ width: 6, flexShrink: 0 }}/>)}
          </React.Fragment>
        ))}
      </div>
      {bottom && <SurfDivider axis="y" containerRef={outerRef} onFrac={(f) => actions.setVFrac(f)}/>}
      {bottom && (
        <div style={{ flex: ws.vFlex.bottom, display: 'flex', minHeight: 0, minWidth: 0 }}>
          <SurfaceView name={bottom} ws={ws} actions={actions} drag={drag} flex={1}/>
        </div>
      )}
    </div>
  );
}

// Floating ghost + drop highlight, portaled to <body> (workspace is CSS-scaled).
function DragOverlay({ drag, drop, pt }) {
  if (!drag) return null;
  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
      {drop && drop.rect && (
        <div style={{
          position: 'fixed', left: drop.rect.left, top: drop.rect.top, width: drop.rect.width, height: drop.rect.height,
          background: `${ACCENT}1f`, border: `2px solid ${ACCENT}`, borderRadius: 11,
          transition: 'left .08s, top .08s, width .08s, height .08s',
        }}>
          <div style={{ position: 'absolute', top: 8, left: 8, fontFamily: MONO, fontSize: 10, fontWeight: 700, color: '#fff', background: ACCENT, padding: '2px 7px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>{drop.label}</div>
        </div>
      )}
      <div style={{
        position: 'fixed', left: pt.x + 12, top: pt.y + 12, display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 11px', borderRadius: 8, background: T.content, border: `0.5px solid ${T.border}`,
        boxShadow: '0 12px 32px rgba(0,0,0,0.22)', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: T.text,
      }}>
        <Icon name={drag.icon} size={12} color={drag.color}/>{drag.label}
      </div>
    </div>, document.body);
}

// ═════════════════════════════════════════════════════════════════════
// ROOT
// ═════════════════════════════════════════════════════════════════════
function MainframeTabbed({ width = 1440, height = 920, chrome = 'warm', inspector = true, chatSide = 'left', dropMode = 'position', initial = 'chat-files' }) {
  const [bySession, setBySession] = React.useState(() => buildInitialSessions(chatSide, initial));
  const [activeSession, setActiveSession] = React.useState('s1');
  const [inspectorOpen, setInspectorOpen] = React.useState(inspector);
  const [launchSel, setLaunchSel] = React.useState('Preview');
  const [launchStatus, setLaunchStatus] = React.useState({}); // name → 'starting' | 'running' (absent = stopped)
  const launchTimers = React.useRef({});
  const startConfig = React.useCallback((name) => {
    const c = LAUNCH_CONFIGS.find(x => x.name === name);
    setLaunchStatus(s => ({ ...s, [name]: 'starting' }));
    clearTimeout(launchTimers.current[name]);
    launchTimers.current[name] = setTimeout(() => setLaunchStatus(s => (s[name] === 'starting' ? { ...s, [name]: 'running' } : s)), c && c.preview ? 1100 : 500);
  }, []);
  const stopConfig = React.useCallback((name) => {
    clearTimeout(launchTimers.current[name]);
    setLaunchStatus(s => { const n = { ...s }; delete n[name]; return n; });
  }, []);
  const restartConfig = React.useCallback((name) => { stopConfig(name); setTimeout(() => startConfig(name), 80); }, [startConfig, stopConfig]);
  React.useEffect(() => setInspectorOpen(inspector), [inspector]);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [dirPickerOpen, setDirPickerOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [todosOpen, setTodosOpen] = React.useState(false);
  const [quickOpen, setQuickOpen] = React.useState(false);

  // Global shortcuts: ⌘, settings · ⌘O / ⌘P palette · ⌘⇧R review · ⌘⇧T quick task.
  React.useEffect(() => {
    const h = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      else if (mod && !e.shiftKey && (e.key === 'o' || e.key === 'O' || e.key === 'p' || e.key === 'P')) { e.preventDefault(); setPaletteOpen(true); }
      else if (mod && e.shiftKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); setReviewOpen(true); }
      else if (mod && e.shiftKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); setQuickOpen(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // The titlebar checklist icon (TasksButton) opens the board via this event.
  React.useEffect(() => {
    const open = () => setTodosOpen(true);
    window.addEventListener('mf:open-tasks', open);
    return () => window.removeEventListener('mf:open-tasks', open);
  }, []);

  const ws = bySession[activeSession];
  const updateWS = React.useCallback((fn) => {
    setBySession(b => ({ ...b, [activeSession]: fn(b[activeSession]) }));
  }, [activeSession]);

  // Rebuild the active session when the initial-preset / chat-side tweak changes.
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setBySession(b => {
      const title = b[activeSession].title;
      return { ...b, [activeSession]: Object.assign(buildWS(initial, chatSide), { title }) };
    });
  }, [initial, chatSide]);

  const dropModeRef = React.useRef(dropMode); dropModeRef.current = dropMode;
  const contentRef = React.useRef(null);

  // ── drag controller ──────────────────────────────────────────────
  const [drag, setDrag] = React.useState(null);
  const [drop, setDrop] = React.useState(null);
  const [pt, setPt] = React.useState({ x: 0, y: 0 });
  const liveDrop = React.useRef(null);

  function surfaceDropZone(x, y, rect, name) {
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    const canBottom = name !== 'chat';
    if (canBottom && y > rect.top + rect.height * 0.62) {
      return { target: 'bottom', label: 'Bottom strip', rect: { left: rect.left, top: rect.top + rect.height * 0.6, width: rect.width, height: rect.height * 0.4 } };
    }
    const h = canBottom ? rect.height * 0.6 : rect.height;
    if (x < rect.left + rect.width / 2)
      return { target: 'top-left', label: name === 'chat' ? 'Chat ← left' : 'Left column', rect: { left: rect.left, top: rect.top, width: rect.width / 2, height: h } };
    return { target: 'top-right', label: name === 'chat' ? 'right → Chat' : 'Right column', rect: { left: rect.left + rect.width / 2, top: rect.top, width: rect.width / 2, height: h } };
  }
  function tabDropZone(x, y) {
    const el = document.elementFromPoint(x, y);
    const run = el && el.closest('[data-run-region]');
    if (!run) return null;
    const r = run.getBoundingClientRect();
    const rx = (x - r.left) / r.width, ry = (y - r.top) / r.height;
    const m = Math.min(rx, 1 - rx, ry, 1 - ry);
    let edge = 'center';
    if (dropModeRef.current !== 'tab' && m < 0.3) edge = m === rx ? 'left' : m === (1 - rx) ? 'right' : m === ry ? 'top' : 'bottom';
    let rect;
    if (edge === 'center') rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    else if (edge === 'left') rect = { left: r.left, top: r.top, width: r.width / 2, height: r.height };
    else if (edge === 'right') rect = { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height };
    else if (edge === 'top') rect = { left: r.left, top: r.top, width: r.width, height: r.height / 2 };
    else rect = { left: r.left, top: r.top + r.height / 2, width: r.width, height: r.height / 2 };
    return { edge, rect, label: edge === 'center' ? 'Add tab to Run' : `Split Run ${edge}` };
  }

  const beginSurfaceDrag = React.useCallback((name, e) => {
    const meta = SURFACE_META[name];
    const x0 = e.clientX, y0 = e.clientY; let started = false;
    const onMove = (ev) => {
      const x = ev.clientX, y = ev.clientY;
      if (!started) { if (Math.abs(x - x0) < 4 && Math.abs(y - y0) < 4) return; started = true; document.body.style.userSelect = 'none'; setDrag({ kind: 'surface', name, label: meta.label, icon: meta.icon, color: meta.color }); }
      setPt({ x, y });
      const cr = contentRef.current?.getBoundingClientRect();
      const d = cr ? surfaceDropZone(x, y, cr, name) : null;
      liveDrop.current = d; setDrop(d);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      const d = liveDrop.current;
      if (started && d) updateWS(w => repositionSurface(w, name, d.target));
      setDrag(null); setDrop(null); liveDrop.current = null;
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  }, [updateWS]);

  const beginTabDrag = React.useCallback((tid, surface, e) => {
    const x0 = e.clientX, y0 = e.clientY; let started = false;
    const onMove = (ev) => {
      const x = ev.clientX, y = ev.clientY;
      if (!started) { if (Math.abs(x - x0) < 4 && Math.abs(y - y0) < 4) return; started = true; document.body.style.userSelect = 'none'; setDrag({ kind: 'tab', tid, label: 'file', icon: 'doc.text', color: TAB_TYPES.code.color }); }
      setPt({ x, y });
      const d = tabDropZone(x, y);
      liveDrop.current = d; setDrop(d);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      const d = liveDrop.current;
      if (started && d) updateWS(w => moveTabToRunWS(w, tid, d.edge, dropModeRef.current));
      setDrag(null); setDrop(null); liveDrop.current = null;
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  }, [updateWS]);

  const dragApi = { beginSurfaceDrag, beginTabDrag };

  // ── surface toggles (rail + headers) ─────────────────────────────
  const onToggleSurface = React.useCallback((name) => {
    updateWS(w => {
      if (layoutHas(w.layout, name)) {
        if (listSurfaces(w.layout).length <= 1) return w;        // floor
        return removeSurface(w, name);
      }
      // reveal via rail → empty (actionable picker), except chat
      let n = clone(w);
      if (name === 'files') n.files = { tabs: [], active: null };
      if (name === 'run') n.run = emptyRun();
      n = placeInLayout(n, name);
      return n;
    });
  }, [updateWS]);

  const openTarget = React.useCallback((target, opts = {}) => {
    updateWS(w => openTargetWS(w, target, opts.mode || 'preview'));
  }, [updateWS]);

  const actions = {
    toggleSurface: onToggleSurface,
    openReview: () => setReviewOpen(true),
    canClose: () => listSurfaces(ws.layout).length > 1,
    activateTab: (surface, paneId, tid) => updateWS(w => activateTabWS(w, surface, paneId, tid)),
    closeTab: (surface, paneId, tid) => updateWS(w => surface === 'files' ? closeFilesTab(w, tid) : closeRunTab(w, paneId, tid)),
    closePane: (paneId) => updateWS(w => closePaneWS(w, paneId)),
    openFile: (f) => openTarget({ kind: (window.kindForFile ? window.kindForFile(f) : 'code'), file: f }, { mode: 'permanent' }),
    openDiff: (f) => openTarget({ kind: 'diff', file: f, title: `${f} (diff)` }, { mode: 'permanent' }),
    addRun: (kind, configName) => updateWS(w => addRunTab(w, kind, configName)),
    setTopFrac: (a, b, f) => updateWS(w => ({ ...w, topFlex: { ...w.topFlex, [a]: f, [b]: 1 - f } })),
    setVFrac: (f) => updateWS(w => ({ ...w, vFlex: { top: f, bottom: 1 - f } })),
    setRunFrac: (f) => updateWS(w => ({ ...w, run: { ...w.run, flex: [f, 1 - f] } })),
    canSplit: () => (['files', 'run'].some(s => !layoutHas(ws.layout, s)) || !layoutHas(ws.layout, 'chat')),
    splitSurface: (orientation) => updateWS(w => {
      // Reveal the next surface into a new pane. NEVER a chat (singleton) —
      // unless chat is currently hidden, in which case it may be re-added (max 1).
      let nextS = ['files', 'run'].find(s => !layoutHas(w.layout, s));
      if (!nextS && !layoutHas(w.layout, 'chat')) nextS = 'chat';
      if (!nextS) return w;                                   // all present — nothing to split into
      let n = clone(w);
      if (nextS === 'files') n.files = { tabs: [], active: null };
      if (nextS === 'run') n.run = emptyRun();
      n = placeInLayout(n, nextS);
      if (nextS === 'chat') n = repositionSurface(n, 'chat', 'top-left');
      else if (orientation === 'h') n = repositionSurface(n, nextS, 'bottom');   // stacked
      else n = repositionSurface(n, nextS, 'top-right');                          // side-by-side
      return n;
    }),
  };

  const surfacesState = { chat: layoutHas(ws.layout, 'chat'), files: layoutHas(ws.layout, 'files'), run: layoutHas(ws.layout, 'run') };

  // Command surface shared by the ⌘O palette and other entry points.
  const commandApi = {
    openFile: (f) => { actions.openFile(f); },
    openDiff: (f) => { actions.openDiff(f); },
    openSettings: () => setSettingsOpen(true),
    openReview: () => setReviewOpen(true),
    toggleSurface: (s) => onToggleSurface(s),
    toggleSidebar: () => setSidebarOpen(o => !o),
    toggleInspector: () => setInspectorOpen(o => !o),
  };

  return (
    <WorkspaceCtx.Provider value={{ openTarget }}>
    <LaunchCtx.Provider value={{ selected: launchSel, setSelected: setLaunchSel, openConfig: (name) => { setLaunchSel(name); actions.addRun('preview', name); }, status: launchStatus, start: startConfig, stop: stopConfig, restart: restartConfig }}>
      <div style={{
        width, height, borderRadius: 11, overflow: 'hidden',
        background: `radial-gradient(900px 600px at 20% 20%, ${ACCENT}10, transparent 60%), radial-gradient(700px 500px at 80% 90%, #ff9f0a10, transparent 60%), ${T.windowBg}`,
        boxShadow: T.shadow, fontFamily: FONT, color: T.text, display: 'flex', flexDirection: 'column', position: 'relative', padding: 6,
      }}>
        <style>{`
          @keyframes twPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }
          .tw-pulse { animation: twPulse 1.6s ease-in-out infinite; }
          @keyframes twDots { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
          .tw-dots { animation: twDots 1.4s ease-in-out infinite; }
          @keyframes tw-spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
          @keyframes tw-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
          .tw-shimmer { background: linear-gradient(90deg, ${T.text4} 25%, ${T.text2} 50%, ${T.text4} 75%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: tw-shimmer 2.2s linear infinite; }
          @keyframes tw-slidein { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } }
          .tw-slidein { animation: tw-slidein 0.26s cubic-bezier(0.22,1,0.36,1) both; }
          .ts-tab .ts-x { display: none; }
          .ts-tab .ts-dot { display: inline-flex; }
          .ts-tab:hover .ts-x { display: inline-flex; }
          .ts-tab:hover .ts-dot { display: none; }
          .tw-trim { text-box-trim: trim-both; text-box-edge: cap alphabetic; -webkit-text-box-trim: trim-both; -webkit-text-box-edge: cap alphabetic; }
        `}</style>

        <div style={{ flex: 1, display: 'flex', gap: 6, overflow: 'hidden', minHeight: 0, position: 'relative' }}>
          {sidebarOpen && (
            <Sidebar surfaces={surfacesState} onToggleSurface={onToggleSurface}
              activeSession={activeSession} onSelectSession={setActiveSession}
              onToggleSidebar={() => setSidebarOpen(false)}
              onOpenSettings={() => setSettingsOpen(true)}
              onAddProject={() => setDirPickerOpen(true)}/>
          )}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
            background: chrome === 'warm' ? T.tabBar : T.content, borderRadius: 13, overflow: 'hidden',
            boxShadow: `0 0 0 0.5px ${T.border}, 0 1px 2px rgba(0,0,0,0.04)`,
          }}>
            <MainToolbar inspectorOpen={inspectorOpen} toggleInspector={() => setInspectorOpen(o => !o)}
              variant={chrome} chatHidden={!surfacesState.chat} onShowChat={() => onToggleSurface('chat')}
              sidebarHidden={!sidebarOpen} onShowSidebar={() => setSidebarOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)} onOpenSearch={() => setPaletteOpen(true)}/>
            <div ref={contentRef} style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, padding: 6 }}>
              <WorkspaceArea ws={ws} actions={actions} drag={dragApi}/>
            </div>
          </div>
          {inspectorOpen && <Inspector/>}
        </div>

        <StatusBar/>
        <DragOverlay drag={drag} drop={drop} pt={pt}/>
        {window.SettingsModal && <window.SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}/>}
        {window.DirectoryPickerModal && <window.DirectoryPickerModal open={dirPickerOpen} onCancel={() => setDirPickerOpen(false)} onSelect={() => setDirPickerOpen(false)}/>}
        {window.SearchPalette && <window.SearchPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} api={commandApi}/>}
        {window.ReviewModal && <window.ReviewModal open={reviewOpen} onClose={() => setReviewOpen(false)} onOpenInWorkspace={(f) => { setReviewOpen(false); actions.openDiff(f); }}/>}
        {window.TodosBoard && <window.TodosBoard open={todosOpen} onClose={() => setTodosOpen(false)}/>}
        {window.QuickTaskDialog && <window.QuickTaskDialog open={quickOpen} onClose={() => setQuickOpen(false)}/>}
      </div>
    </LaunchCtx.Provider>
    </WorkspaceCtx.Provider>
  );
}

window.MainframeTabbed = MainframeTabbed;
