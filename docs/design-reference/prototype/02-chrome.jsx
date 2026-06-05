// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Chrome: toolbar, sidebar, sessions, surface rail
// Loaded as an ordered <script type="text/babel"> after React. All module
// files share one global scope (Babel executes them in document order),
// so symbols defined earlier (tokens, Icon, data) are visible here.
// Depends on: 01-base
// ════════════════════════════════════════════════════════════════

function TrafficLights() {
  return (
    <div style={{ display: 'flex', gap: 8, paddingLeft: 4 }}>
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57',
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.15)' }}/>
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e',
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.15)' }}/>
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840',
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.15)' }}/>
    </div>
  );
}

// ── Titlebar ──────────────────────────────────────────────────────────
function TasksButton() {
  // Opens the fullview Tasks board (mounted by MainframeTabbed). Event-wired so
  // the chrome doesn't have to thread the open setter down through every prop.
  const [hover, setHover] = React.useState(false);
  return (
    <button title="Tasks" onClick={() => window.dispatchEvent(new CustomEvent('mf:open-tasks'))}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: 28, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 6, background: hover ? T.chipBg : 'transparent', border: 'none', cursor: 'pointer',
      }}>
      <Icon name="checklist.box" size={14} color={T.text2}/>
    </button>
  );
}

function LaunchPicker() {
  const lc = React.useContext(LaunchCtx) || {};
  const configs = (typeof LAUNCH_CONFIGS !== 'undefined') ? LAUNCH_CONFIGS : [];
  const [open, setOpen] = React.useState(false);
  const selected = lc.selected || 'Preview';
  const openConfig = lc.openConfig || (() => {});
  const status = lc.status || {};
  const start = lc.start || (() => {});
  const stop = lc.stop || (() => {});
  return (
    <span data-tut="run" style={{ position: 'relative', display: 'inline-flex' }}>
      <button title="Launch configurations" onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, height: 24,
        padding: '0 8px', borderRadius: 6, background: open ? T.rowHover : T.chipBg, color: T.text2,
        border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 500,
        letterSpacing: -0.05, maxWidth: 200, minWidth: 0,
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected}</span>
        <Icon name="chevron.down" size={9} color={T.text3}/>
      </button>
      {open && (<React.Fragment>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }}/>
        <div style={{
          position: 'absolute', top: 28, right: 0, zIndex: 61, width: 224,
          background: T.popBg, borderRadius: 8, padding: 4,
          boxShadow: '0 16px 40px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(0,0,0,0.14)',
        }}>
          {configs.map(c => {
            const sel = c.name === selected;
            const st = status[c.name];               // 'starting' | 'running' | undefined
            const live = st === 'running' || st === 'starting';
            return (
              <div key={c.name} className="lp-row"
                onClick={() => { openConfig(c.name); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 6px 6px 8px', borderRadius: 6,
                  cursor: 'pointer', fontFamily: FONT, background: sel ? T.rowHover : 'transparent',
                }}
                onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = T.rowHover; }}
                onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}>
                <Icon name={c.preview ? 'eye' : 'terminal'} size={12} color={c.preview ? TAB_TYPES.preview.color : T.text3}/>
                <span style={{ flex: 1, fontSize: 12, fontWeight: sel ? 600 : 500, color: T.text, letterSpacing: -0.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                {st === 'starting' && <span style={{ width: 10, height: 10, borderRadius: '50%', border: `1.5px solid ${T.amber}`, borderTopColor: 'transparent', animation: 'tw-spin 0.9s linear infinite', flexShrink: 0 }}/>}
                <button title={live ? `Stop ${c.name}` : `Start ${c.name}`}
                  onClick={(e) => { e.stopPropagation(); live ? stop(c.name) : start(c.name); }}
                  style={{
                    width: 26, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = T.chipBg}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <Icon name={live ? 'stop.fill' : 'play.fill'} size={live ? 15 : 16} color={live ? T.red : T.green}/>
                </button>
              </div>
            );
          })}
          <div style={{ height: 1, background: T.hairline, margin: '4px 6px' }}/>
          <div className="lp-row" onClick={() => setOpen(false)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: FONT,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="sparkles" size={12} color={ACCENT}/>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: T.text2, letterSpacing: -0.1 }}>Generate with Agent</span>
          </div>
        </div>
      </React.Fragment>)}
    </span>
  );
}

function MainToolbar({ inspectorOpen, toggleInspector, variant = 'white', chatHidden, onShowChat, sidebarHidden, onShowSidebar, onOpenSettings, onOpenSearch }) {
  const ibtn = {
    width: 28, height: 24, display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', borderRadius: 6, background: 'transparent',
    border: 'none', cursor: 'pointer',
  };
  // Chrome variants — how the toolbar band relates to the warm side panels vs white panes.
  const VAR = {
    white: { bg: T.content,                 blur: false, border: T.hairline },
    warm:  { bg: T.tabBar,                  blur: false, border: T.border   },
    glass: { bg: 'rgba(243,240,234,0.72)',  blur: true,  border: T.border   },
  }[variant] || { bg: T.content, blur: false, border: T.hairline };
  return (
    <div style={{
      height: 40, flexShrink: 0,
      background: VAR.bg,
      backdropFilter: VAR.blur ? 'blur(24px) saturate(180%)' : 'none',
      WebkitBackdropFilter: VAR.blur ? 'blur(24px) saturate(180%)' : 'none',
      borderBottom: `0.5px solid ${VAR.border}`,
      display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center',
      padding: '0 8px',
    }}>
      {/* Left: chat/branch identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', minWidth: 0 }}>
        {sidebarHidden && (
          <button title="Show sidebar" onClick={onShowSidebar} style={{
            width: 28, height: 24, display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', borderRadius: 6, background: 'transparent',
            border: 'none', cursor: 'pointer', flexShrink: 0,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="sidebar.left" size={14} color={T.text2}/>
          </button>
        )}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0,
          fontFamily: FONT, fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: -0.2,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>mainframe</span>
          <span style={{ fontWeight: 400, color: T.text4, padding: '0 1px' }}>|</span>
          <BranchPopover trigger={({ toggle, open }) => (
            <button onClick={toggle} title="Switch branch"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 6px',
                borderRadius: 6, border: 'none', cursor: 'pointer', minWidth: 0, maxWidth: 230,
                background: open ? T.rowHover : 'transparent',
                fontFamily: MONO, fontSize: 11, fontWeight: 400, color: T.text2,
              }}
              onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = T.rowHover; }}
              onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
              <Icon name="branch" size={11} color={T.text3}/>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{BRANCH_CURRENT}</span>
              <Icon name="chevron.down" size={8} color={T.text4}/>
            </button>
          )}/>
        </div>
        {chatHidden && (
          <button title="Show chat" onClick={onShowChat} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, height: 24,
            padding: '0 9px 0 8px', borderRadius: 6, background: `${ACCENT}14`, color: ACCENT,
            border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 11, fontWeight: 600,
            letterSpacing: -0.05, flexShrink: 0,
          }}>
            <Icon name="chat" size={12} color={ACCENT}/>
            Show chat
          </button>
        )}
      </div>
      {/* Right: search + launch picker + play + inspector toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 4, padding: '0 12px' }}>
        <button title="Search · ⌘O" onClick={onOpenSearch} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 24,
          padding: '0 6px 0 7px', borderRadius: 6, background: 'transparent',
          border: 'none', cursor: 'pointer',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon name="magnifyingglass" size={14} color={T.text2}/>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 17, padding: '0 5px', borderRadius: 4,
            background: T.content, border: `0.5px solid ${T.border}`,
            boxShadow: '0 1px 0 rgba(0,0,0,0.03)',
            fontFamily: FONT, fontSize: 11, fontWeight: 600, color: T.text2,
            letterSpacing: 0.3, lineHeight: 1,
          }}>⌘O</span>
        </button>
        <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }}/>
        {/* Launch config selector — shares state with the Preview surface */}
        <LaunchPicker/>
        <button title="Start" style={{
          width: 28, height: 24, borderRadius: 6, background: 'transparent',
          border: 'none', cursor: 'pointer', color: T.green,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="play.fill" size={15} color={T.green}/></button>
        <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }}/>
        <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }}/>
        {(() => {
          const dark = (typeof window !== 'undefined' && window.__mfTheme === 'dark');
          return (
            <button title={dark ? 'Switch to light' : 'Switch to dark'}
              onClick={() => window.setMfTheme && window.setMfTheme(dark ? 'light' : 'dark')} style={{
              width: 28, height: 24, display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', borderRadius: 6, background: 'transparent',
              border: 'none', cursor: 'pointer',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <Icon name={dark ? 'sun' : 'moon'} size={15} color={T.text2}/>
            </button>
          );
        })()}
        <button title="Toggle Inspector" onClick={toggleInspector} style={{
          width: 28, height: 24, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', borderRadius: 6,
          background: inspectorOpen ? T.chipBg : 'transparent',
          border: 'none', cursor: 'pointer',
        }}>
          <Icon name="sidebar.right" size={14} color={inspectorOpen ? T.text : T.text2}/>
        </button>
      </div>
    </div>
  );
}

// ── Sidebar (unified IDE + agent sidebar) ─────────────────────────────

// Tag registry — mirrors the real app's TagColor system.
const TAG_REGISTRY = {
  agentic:    '#0a84ff',
  'pr-prep':  '#34c759',
  refactor:   '#bf5af2',
  ui:         '#ff375f',
  bugfix:     '#ff453a',
  docs:       '#5ac8fa',
  experiment: '#ff9500',
};

// Projects (filter pills) — each gets a stable identity color used on rows in "All" view
const PROJECTS_LIST = [
  { id: 'mf',   name: 'mainframe',         attn: 2, color: '#2a6fdb' },
  { id: 'glen', name: 'glen-home-hub',     attn: 0, color: '#1f8a5b' },
  { id: 'ft',   name: 'football-tracker',  attn: 1, color: '#b0560f' },
];
const PROJECT_COLOR = Object.fromEntries(PROJECTS_LIST.map(p => [p.name, p.color]));
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Time bucketing for session grouping (Today / Yesterday / Earlier)
function twBucket(when) {
  if (/^\d{1,2}:\d{2}/.test(when)) return 'Today';
  if (/^yest/i.test(when)) return 'Yesterday';
  return 'Earlier';
}
function groupSessionsByTime(items) {
  const pinned = items.filter(s => s.pinned);
  const rest = items.filter(s => !s.pinned);
  const g = { Today: [], Yesterday: [], Earlier: [] };
  rest.forEach(s => g[twBucket(s.when)].push(s));
  const out = [];
  if (pinned.length) out.push(['Pinned', pinned]);
  Object.entries(g).forEach(([k, v]) => { if (v.length) out.push([k, v]); });
  return out;
}

// Sort options for the sessions list. 'recent' keeps the time grouping;
// the others flatten to a single sorted list (pinned still surfaced first).
const SESSION_SORTS = [
  { id: 'recent', label: 'Recent activity' },
  { id: 'name',   label: 'Name (A–Z)' },
  { id: 'status', label: 'Status' },
];
const SESSION_STATUS_RANK = { working: 0, waiting: 1, idle: 2 };
function arrangeSessions(items, mode) {
  if (mode === 'name' || mode === 'status') {
    const pinned = items.filter(s => s.pinned);
    const rest = items.filter(s => !s.pinned);
    if (mode === 'name') rest.sort((a, b) => a.t.localeCompare(b.t));
    else rest.sort((a, b) => (SESSION_STATUS_RANK[a.status] ?? 3) - (SESSION_STATUS_RANK[b.status] ?? 3));
    const out = [];
    if (pinned.length) out.push(['Pinned', pinned]);
    out.push([mode === 'name' ? 'A–Z' : 'By status', rest]);
    return out;
  }
  return groupSessionsByTime(items);
}

// Sessions — dense, with tags, adapter, worktree, PR
const SESSIONS_DATA = [
  { id: 's1', t: 'Prepare PR Test Worktree',  proj: 'mainframe',
    adapter: 'Claude · Sonnet 4.5', worktree: 'test-all-prs', pr: 2118,
    tags: ['agentic', 'pr-prep'], status: 'working', when: '11:56', pinned: true, sel: true },
  { id: 's2', t: 'Audit git history of zone', proj: 'mainframe',
    adapter: 'Claude · Sonnet 4.5', worktree: 'audit-zone',
    tags: ['refactor'], status: 'waiting', when: '10:14' },
  { id: 's3', t: 'Wire Skill API into chat',   proj: 'mainframe',
    adapter: 'Codex · gpt-5',
    tags: ['agentic', 'experiment'], status: 'idle', when: '09:02' },
  { id: 's4', t: 'Login overhaul (v3)',        proj: 'glen-home-hub',
    adapter: 'Claude · Sonnet 4.5', worktree: 'login-v3', unread: true,
    tags: ['ui'], status: 'idle', when: 'Yest' },
  { id: 's5', t: 'Refactor terminal store',    proj: 'mainframe',
    adapter: 'Gemini · 2.5 Pro',
    tags: ['refactor', 'bugfix'], status: 'idle', when: 'Mon' },
  { id: 's6', t: 'Onboarding flow polish',     proj: 'football-tracker',
    adapter: 'Claude · Sonnet 4.5',
    tags: ['ui', 'docs'], status: 'idle', when: 'May 21' },
];

const ADAPTER_DOT = {
  Claude: '#d97757', Codex: '#10b981', Gemini: '#5ac8fa', OpenCode: '#bf5af2',
};

function TagPill({ name, variant = 'row', active = false, onClick }) {
  const color = TAG_REGISTRY[name] ?? T.text3;
  if (variant === 'row') {
    return (
      <span onClick={onClick} className="tw-trim" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: 16, padding: '0 6px', borderRadius: 8,
        background: color, color: '#fff',
        fontFamily: FONT, fontSize: 10, fontWeight: 600, lineHeight: 1,
        letterSpacing: -0.05, whiteSpace: 'nowrap', cursor: 'pointer',
      }}>{name}</span>
    );
  }
  // filter
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      height: 20, padding: '0 9px', borderRadius: 11,
      background: active ? ACCENT + '18' : 'transparent',
      border: 'none',
      color: active ? T.text : T.text2, cursor: 'pointer',
      fontFamily: FONT, fontSize: 11, letterSpacing: -0.05, lineHeight: 1,
      fontWeight: active ? 600 : 500,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }}/>
      <span className="tw-trim">{name}</span>
    </button>
  );
}

function StatusDot({ status, unread }) {
  if (status === 'working' || status === 'waiting') {
    return (
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        border: `1.5px solid ${ACCENT}`, borderTopColor: 'transparent',
        animation: 'tw-spin 0.9s linear infinite',
      }}/>
    );
  }
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
      background: unread ? ACCENT : T.text4, opacity: unread ? 1 : 0.5,
    }}/>
  );
}

function HoverActionBtn({ icon, title }) {
  return (
    <button title={title} style={{
      width: 22, height: 22, padding: 0, border: 'none', background: 'transparent',
      borderRadius: 4, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
       onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <Icon name={icon} size={11} color={T.text2}/>
    </button>
  );
}

function SessionRowDense({ s, showProject, inPinnedGroup, active, onSelect }) {
  const hasMeta = s.worktree || s.pr || (s.tags && s.tags.length > 0);
  const showMeta = hasMeta || showProject;
  const pc = PROJECT_COLOR[s.proj] ?? T.text3;
  const showPin = s.pinned && !inPinnedGroup;
  const sel = active != null ? active : s.sel;
  return (
    <div className="tw-session-row" onClick={onSelect} style={{
      padding: '8px 12px 9px 10px', cursor: 'pointer', position: 'relative',
      background: sel ? T.rowHover : 'transparent',
      borderLeft: sel ? `2px solid ${ACCENT}` : '2px solid transparent',
      display: 'flex', alignItems: 'center', gap: 9,
    }}>
      {/* Leading indicator column — vertically centered across the whole row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
      }}>
        {showPin && <Icon name="pin" size={11} color={ACCENT}/>}
        <StatusDot status={s.status} unread={s.unread}/>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
      {/* Row 1: title + time/hover-actions */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
        height: 22,
      }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: FONT, fontSize: 13,
          color: sel ? T.text : (s.unread ? T.text : T.text2),
          fontWeight: sel || s.unread ? 600 : 500,
          letterSpacing: -0.15,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{s.t}</span>
        <span className="tw-row-time" style={{
          fontFamily: FONT, fontSize: 10, color: T.text3,
          flexShrink: 0, fontVariantNumeric: 'tabular-nums',
        }}>{s.when}</span>
        <div className="tw-row-actions" style={{ display: 'none', gap: 0 }}>
          <HoverActionBtn icon="tag" title="Tags"/>
          <HoverActionBtn icon="paperclip" title="Rename"/>
          <HoverActionBtn icon="xmark" title="Archive"/>
        </div>
      </div>

      {/* Row 2: ghost meta line — when there IS meta, or in "All" view (project chip) */}
      {showMeta && (
        <div style={{
          marginTop: 4,
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT, fontSize: 10, color: T.text3,
          letterSpacing: -0.05, minWidth: 0,
        }}>
          {showProject && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
              height: 15, padding: '0 6px 0 5px', borderRadius: 4,
              background: hexToRgba(pc, 0.10), color: pc,
              fontFamily: FONT, fontSize: 10, fontWeight: 600, letterSpacing: 0,
              maxWidth: 124,
            }} title={s.proj}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: pc, flexShrink: 0 }}/>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.proj}</span>
            </span>
          )}
          {s.worktree && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              minWidth: 0, color: T.text2,
            }}>
              <Icon name="branch" size={9} color={T.text3}/>
              <span style={{
                fontFamily: MONO, fontSize: 10,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: 130,
              }}>{s.worktree}</span>
            </span>
          )}
          {s.pr && (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              fontFamily: MONO, fontSize: 10, fontWeight: 600,
              color: '#1a7f37', flexShrink: 0,
            }}>#{s.pr}</span>
          )}
          {s.status === 'waiting' && (
            <span style={{
              fontFamily: FONT, fontSize: 10, fontWeight: 600,
              color: T.amber, flexShrink: 0,
            }}>Needs input</span>
          )}
          <div style={{ flex: 1 }}/>
          {s.tags && s.tags.length > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
            }} title={s.tags.join(' · ')}>
              {s.tags.slice(0, 4).map(name => (
                <span key={name} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: TAG_REGISTRY[name] ?? T.text3,
                }}/>
              ))}
            </span>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

// Surface registry — the three typed surfaces of the workspace.
const SURFACE_META = {
  chat:  { icon: 'chat',      color: ACCENT,    label: 'Chat'  },
  files: { icon: 'doc.text',  color: '#7a4d9e', label: 'Files' },
  run:   { icon: 'play.fill', color: '#1f9d4d', label: 'Run'   },
};

// The surface rail — replaces the old hover-expand preset switcher. Always
// visible icon toggles for Chat · Files · Run. Lit chip (white bg + colored
// icon) = present; dimmed icon = absent but clickable. The last lit toggle
// is disabled (floor invariant — you can't hit zero surfaces).
function SurfaceRail({ surfaces, onToggle }) {
  const order = ['chat', 'files', 'run'];
  const TIP = { chat: 'Chat', files: 'Editor', run: 'Preview' };
  const litCount = order.filter(k => surfaces[k]).length;
  return (
    <div style={{
      display: 'flex', gap: 2, padding: 2, borderRadius: 8, background: T.chipBg,
    }}>
      {order.map(k => {
        const meta = SURFACE_META[k];
        const on = !!surfaces[k];
        const isFloor = on && litCount === 1;
        return (
          <button key={k}
            disabled={isFloor}
            onClick={() => { if (!isFloor) onToggle(k); }}
            title={TIP[k]}
            style={{
              width: 26, height: 21, borderRadius: 6, border: 'none', padding: 0,
              cursor: isFloor ? 'default' : 'pointer', flexShrink: 0,
              background: on ? T.tabBarActive : 'transparent',
              boxShadow: on ? `0 0.5px 0 ${T.border}, 0 1px 2px rgba(0,0,0,0.06)` : 'none',
              opacity: isFloor ? 0.6 : 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 120ms ease, box-shadow 120ms ease',
            }}
            onMouseEnter={(e) => { if (!on && !isFloor) e.currentTarget.style.background = T.rowHover; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
            <Icon name={meta.icon} size={12} color={on ? meta.color : T.text4}/>
          </button>
        );
      })}
    </div>
  );
}

function Sidebar({ surfaces, onToggleSurface, activeSession, onSelectSession, onToggleSidebar, onOpenSettings, onAddProject }) {
  const [activeProj, setActiveProj] = React.useState(null); // null = All
  const [activeTags, setActiveTags] = React.useState(new Set(['agentic']));
  const [bottomTab, setBottomTab] = React.useState('context');
  const [bottomHeight, setBottomHeight] = React.useState(280);
  const [tagsExpanded, setTagsExpanded] = React.useState(false);
  const [projsExpanded, setProjsExpanded] = React.useState(false);
  const [sortMode, setSortMode] = React.useState('recent');
  const [sortOpen, setSortOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const sidebarRef = React.useRef(null);

  const filteredSessions = SESSIONS_DATA.filter(s => {
    if (activeProj && s.proj !== activeProj) return false;
    if (activeTags.size > 0) {
      const sset = new Set(s.tags ?? []);
      for (const t of activeTags) if (!sset.has(t)) return false;
    }
    return true;
  });
  const totalAttn = PROJECTS_LIST.reduce((a, p) => a + p.attn, 0);

  function toggleTag(name) {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }
  const tagsInUse = [...new Set(SESSIONS_DATA.flatMap(s => s.tags ?? []))];

  function onResizeMouseDown(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomHeight;
    const sidebar = sidebarRef.current;
    const maxH = sidebar ? sidebar.clientHeight - 200 : 600;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const delta = startY - ev.clientY;
      const next = Math.max(120, Math.min(maxH, startH + delta));
      setBottomHeight(next);
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
    <div ref={sidebarRef} style={{
      width: 280, flexShrink: 0, background: T.glass,
      backdropFilter: 'blur(40px) saturate(180%)',
      WebkitBackdropFilter: 'blur(40px) saturate(180%)',
      borderRadius: 13,
      boxShadow: `0 0 0 0.5px ${T.border}, 0 1px 2px rgba(0,0,0,0.04)`,
      display: 'flex', flexDirection: 'column',
      fontFamily: FONT, color: T.text, overflow: 'hidden',
    }}>
      <style>{`
        @keyframes tw-spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
        .tw-session-row:hover .tw-row-actions { display: flex !important; }
        .tw-session-row:hover .tw-row-time { display: none; }
      `}</style>

      {/* Sidebar header — traffic lights + layout preset switcher (Tahoe-style) */}
      <div style={{
        height: 38, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 8px', gap: 8,
        borderBottom: `0.5px solid ${T.hairline}`,
      }}>
        <TrafficLights/>
        <SurfaceRail surfaces={surfaces} onToggle={onToggleSurface}/>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <TasksButton/>
          <button title="Settings · ⌘," onClick={onOpenSettings} style={{
            width: 26, height: 22, display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', borderRadius: 6, background: 'transparent',
            border: 'none', cursor: 'pointer',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="gear" size={15} color={T.text2}/>
          </button>
          <div style={{ width: 1, height: 16, background: T.hairline, margin: '0 1px' }}/>
          <button title="Hide sidebar" onClick={onToggleSidebar} style={{
            width: 26, height: 22, display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', borderRadius: 6, background: 'transparent',
            border: 'none', cursor: 'pointer',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="sidebar.left" size={14} color={T.text2}/>
          </button>
        </div>
      </div>

      {/* Sessions group header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '8px 12px 4px', gap: 4,
      }}>
        <Icon name="chevron.down" size={10} color={T.text3}/>
        <span style={{
          fontSize: 10, fontWeight: 700, color: T.text2,
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>Sessions</span>
        <span style={{ fontSize: 10, color: T.text3 }}>{SESSIONS_DATA.length}</span>
        <div style={{ flex: 1 }}/>
        {(() => {
          const iconBtn = (extra) => ({
            width: 22, height: 22, border: 'none', borderRadius: 6, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: extra ? T.rowHover : 'transparent',
          });
          const closePops = () => { setSortOpen(false); setMoreOpen(false); };
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
              <button title="New session" data-tut="sessions" style={iconBtn()}
                onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <Icon name="plus" size={12} color={T.text3}/>
              </button>
              <button title="Sort sessions" style={iconBtn(sortOpen)}
                onClick={() => { setMoreOpen(false); setSortOpen(o => !o); }}
                onMouseEnter={(e) => { if (!sortOpen) e.currentTarget.style.background = T.rowHover; }}
                onMouseLeave={(e) => { if (!sortOpen) e.currentTarget.style.background = 'transparent'; }}>
                <Icon name="chevron.up.down" size={11} color={sortOpen ? T.text : T.text3}/>
              </button>
              <button title="More — archived, import…" style={iconBtn(moreOpen)}
                onClick={() => { setSortOpen(false); setMoreOpen(o => !o); }}
                onMouseEnter={(e) => { if (!moreOpen) e.currentTarget.style.background = T.rowHover; }}
                onMouseLeave={(e) => { if (!moreOpen) e.currentTarget.style.background = 'transparent'; }}>
                <Icon name="ellipsis" size={11} color={moreOpen ? T.text : T.text3}/>
              </button>

              {(sortOpen || moreOpen) && (
                <div onClick={closePops} style={{ position: 'fixed', inset: 0, zIndex: 60 }}/>
              )}

              {sortOpen && (
                <div style={{
                  position: 'absolute', top: 26, right: 0, zIndex: 61, minWidth: 176,
                  background: T.popBg, borderRadius: 10, padding: 5,
                  boxShadow: '0 14px 38px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(0,0,0,0.14)',
                }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: T.text3, padding: '4px 8px 5px' }}>Sort by</div>
                  {SESSION_SORTS.map(s => {
                    const on = sortMode === s.id;
                    return (
                      <button key={s.id} onClick={() => { setSortMode(s.id); setSortOpen(false); }} style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: on ? T.selBg : 'transparent', color: T.text,
                        fontFamily: FONT, fontSize: 12, fontWeight: on ? 600 : 500,
                      }}
                      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = T.rowHover; }}
                      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                        <span style={{ width: 13, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
                          {on && <Icon name="checkmark" size={12} color={ACCENT} stroke={2.2}/>}
                        </span>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {moreOpen && (
                <div style={{
                  position: 'absolute', top: 26, right: 0, zIndex: 61, minWidth: 196,
                  background: T.popBg, borderRadius: 10, padding: 5,
                  boxShadow: '0 14px 38px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(0,0,0,0.14)',
                }}>
                  {[
                    { ic: 'archive',    label: 'Archived sessions' },
                    { ic: 'arrow.down', label: 'Import external sessions' },
                  ].map(item => (
                    <button key={item.label} onClick={() => setMoreOpen(false)} style={{
                      display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                      padding: '7px 9px', borderRadius: 7, border: 'none', cursor: 'pointer',
                      background: 'transparent', color: T.text, fontFamily: FONT, fontSize: 12, fontWeight: 500,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <Icon name={item.ic} size={13} color={T.text2}/>{item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Project filter pills — wraps, collapsible (same pattern as Tags) */}
      {(() => {
        const COLLAPSE_AT = 2;
        const hiddenCount = Math.max(0, PROJECTS_LIST.length - COLLAPSE_AT);
        const collapsible = hiddenCount > 0;
        const shownProjs = projsExpanded ? PROJECTS_LIST : PROJECTS_LIST.slice(0, COLLAPSE_AT);
        return (
          <div style={{
            padding: '4px 10px 6px', display: 'flex', gap: 4, flexWrap: 'wrap',
          }}>
            <FilterPill label="All"
              active={!activeProj} onClick={() => setActiveProj(null)} accent/>
            {shownProjs.map(p => (
              <FilterPill key={p.id} label={p.name}
                active={activeProj === p.name} onClick={() => setActiveProj(activeProj === p.name ? null : p.name)}/>
            ))}
            {collapsible && (
              <button onClick={() => setProjsExpanded(v => !v)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                height: 22, padding: '0 9px', borderRadius: 11,
                background: T.rowHover, border: 'none', cursor: 'pointer',
                color: T.text2, fontFamily: FONT, fontSize: 11, fontWeight: 600,
                letterSpacing: -0.05, flexShrink: 0,
              }}>
                {projsExpanded ? (
                  <React.Fragment>
                    <Icon name="chevron.down" size={9} color={T.text3}
                      style={{ transform: 'rotate(180deg)' }}/>
                    Less
                  </React.Fragment>
                ) : `+${hiddenCount} more`}
              </button>
            )}
            <button title="Add project" onClick={onAddProject} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 22, padding: '0 10px 0 8px', borderRadius: 11,
              background: 'transparent', border: `1px dashed ${T.borderH}`, cursor: 'pointer',
              color: T.text3, fontFamily: FONT, fontSize: 11, fontWeight: 600,
              letterSpacing: -0.05, flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.rowHover; e.currentTarget.style.color = T.text2; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = T.text3; }}>
              <Icon name="folder.plus" size={12} color="currentColor"/>Add project
            </button>
          </div>
        );
      })()}

      {/* Sessions list — grouped by time (Today / Yesterday / Earlier) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0 4px' }}>
        {arrangeSessions(filteredSessions, sortMode).map(([label, items]) => (
          <div key={label}>
            <div style={{
              position: 'sticky', top: 0, zIndex: 1,
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '7px 12px 3px',
              fontFamily: FONT, fontSize: 10, fontWeight: 700,
              color: T.text3, textTransform: 'uppercase', letterSpacing: 0.7,
              background: T.glass,
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            }}>
              {label === 'Pinned' && <Icon name="pin" size={9} color={ACCENT}/>}
              {label}
            </div>
            {items.map(s => (
              <SessionRowDense key={s.id} s={s} showProject={!activeProj}
                inPinnedGroup={label === 'Pinned'}
                active={activeSession === s.id}
                onSelect={() => onSelectSession && onSelectSession(s.id)}/>
            ))}
          </div>
        ))}
        {filteredSessions.length === 0 && (
          <div style={{
            padding: '20px 12px', textAlign: 'center', color: T.text3,
            fontSize: 11,
          }}>No sessions match these filters.</div>
        )}
      </div>

      {/* Tag filter row — wraps, collapsible, sits above bottom panel */}
      {(() => {
        const COLLAPSE_AT = 4;
        const extraBtns = 2; // has-pr, has-worktree
        const hiddenCount = Math.max(0, tagsInUse.length - COLLAPSE_AT) + extraBtns;
        const collapsible = hiddenCount > 0;
        const shownTags = tagsExpanded ? tagsInUse : tagsInUse.slice(0, COLLAPSE_AT);
        const ghostBtn = {
          display: 'inline-flex', alignItems: 'center', gap: 5,
          height: 20, padding: '0 9px', borderRadius: 11,
          background: 'transparent', border: 'none',
          color: T.text2, cursor: 'pointer', fontFamily: FONT, fontSize: 11,
          fontWeight: 500, flexShrink: 0,
        };
        return (
          <div style={{
            flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            padding: '6px 12px 7px',
            borderTop: `0.5px solid ${T.hairline}`,
          }}>
            <span style={{
              fontSize: 10, color: T.text3, textTransform: 'uppercase',
              letterSpacing: 0.6, fontWeight: 600, flexShrink: 0,
            }}>Tags</span>
            {shownTags.map(name => (
              <TagPill key={name} name={name} variant="filter"
                active={activeTags.has(name)} onClick={() => toggleTag(name)}/>
            ))}
            {tagsExpanded && (
              <button onClick={() => toggleTag('has-pr')} style={ghostBtn}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.text3 }}/>
                has-pr
              </button>
            )}
            {tagsExpanded && (
              <button style={ghostBtn}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.text3 }}/>
                has-worktree
              </button>
            )}
            {collapsible && (
              <button onClick={() => setTagsExpanded(v => !v)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                height: 20, padding: '0 8px', borderRadius: 11,
                background: T.rowHover, border: 'none', cursor: 'pointer',
                color: T.text2, fontFamily: FONT, fontSize: 11, fontWeight: 600,
                letterSpacing: -0.05, flexShrink: 0,
              }}>
                {tagsExpanded ? (
                  <React.Fragment>
                    <Icon name="chevron.down" size={9} color={T.text3}
                      style={{ transform: 'rotate(180deg)' }}/>
                    Less
                  </React.Fragment>
                ) : `+${hiddenCount} more`}
              </button>
            )}
          </div>
        );
      })()}

      {/* Resize handle for bottom tabbed section */}
      <div onMouseDown={onResizeMouseDown}
        onMouseEnter={(e) => e.currentTarget.firstChild.style.background = ACCENT}
        onMouseLeave={(e) => e.currentTarget.firstChild.style.background = T.border}
        style={{
          flexShrink: 0, height: 5, cursor: 'row-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
        <div style={{
          width: '100%', height: 1, background: T.border, transition: 'background 0.15s',
        }}/>
      </div>

      {/* Bottom: Context | Skills | Agents tabbed section (resizable) */}
      <div style={{
        flexShrink: 0, height: bottomHeight,
        display: 'flex', flexDirection: 'column',
        background: 'rgba(0,0,0,0.015)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', padding: '4px 8px',
          gap: 2, borderBottom: `0.5px solid ${T.hairline}`, flexShrink: 0,
        }}>
          {[
            { id: 'context', l: 'Context', n: 14, ic: 'doc.text' },
            { id: 'skills',  l: 'Skills',  n: 5,  ic: 'wand.sparkles' },
            { id: 'agents',  l: 'Agents',  n: 3,  ic: 'bot' },
          ].map(t => (
            <button key={t.id} onClick={() => setBottomTab(t.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 9px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: bottomTab === t.id ? T.tabBarActive : 'transparent',
              boxShadow: bottomTab === t.id ? `0 0.5px 0 ${T.border}, 0 1px 2px rgba(0,0,0,0.06)` : 'none',
              color: bottomTab === t.id ? T.text : T.text2,
              fontFamily: FONT, fontSize: 11, fontWeight: bottomTab === t.id ? 600 : 500,
              letterSpacing: -0.05,
            }}>
              <Icon name={t.ic} size={11} color={bottomTab === t.id ? ACCENT : T.text2}/>
              <span className="tw-trim" style={{ lineHeight: 1, display: 'inline-block' }}>{t.l}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}>
          {bottomTab === 'context' && <ContextInspector/>}
          {bottomTab === 'skills' && [
            { n: 'auditing-git-history', scope: 'project', d: 'Audit unusual commits' },
            { n: 'claude-source-history', scope: 'project' },
            { n: 'clean-code', scope: 'global', d: 'Apply clean-code principles' },
            { n: 'read-pdf', scope: 'global' },
            { n: 'export-pptx', scope: 'plugin' },
          ].map(s => (
            <div key={s.n} style={{
              display: 'grid', gridTemplateColumns: '14px 1fr auto', gap: 7,
              padding: '4px 12px', alignItems: 'center', cursor: 'pointer',
            }}>
              <Icon name="bolt" size={11} color={ACCENT}/>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: FONT, fontSize: 11, fontWeight: 500, color: T.text,
                  letterSpacing: -0.05,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>/{s.n}</div>
                {s.d && (
                  <div style={{
                    fontFamily: FONT, fontSize: 10, color: T.text3,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{s.d}</div>
                )}
              </div>
              <span style={{
                fontFamily: FONT, fontSize: 10, color: T.text3,
                textTransform: 'uppercase', letterSpacing: 0.5,
                padding: '1px 5px', borderRadius: 8, background: T.chipBg,
              }}>{s.scope}</span>
            </div>
          ))}
          {bottomTab === 'agents' && [
            { n: 'release-bot',     scope: 'project', d: 'Cuts releases & writes changelog' },
            { n: 'pr-reviewer',     scope: 'project', d: 'Reviews diffs against style guide' },
            { n: 'doc-gardener',    scope: 'global',  d: 'Keeps docs in sync with code' },
          ].map(a => (
            <div key={a.n} style={{
              display: 'grid', gridTemplateColumns: '14px 1fr auto', gap: 7,
              padding: '4px 12px', alignItems: 'center', cursor: 'pointer',
            }}>
              <Icon name="sparkles" size={11} color={ACCENT}/>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: FONT, fontSize: 11, fontWeight: 500, color: T.text,
                  letterSpacing: -0.05,
                }}>{a.n}</div>
                <div style={{
                  fontFamily: FONT, fontSize: 10, color: T.text3,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{a.d}</div>
              </div>
              <span style={{
                fontFamily: FONT, fontSize: 10, color: T.text3,
                textTransform: 'uppercase', letterSpacing: 0.5,
                padding: '1px 5px', borderRadius: 8, background: T.chipBg,
              }}>{a.scope}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterPill({ label, count, active, onClick, accent }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      height: 22, padding: count ? '0 4px 0 10px' : '0 10px', borderRadius: 11,
      border: 'none', cursor: 'pointer',
      background: active ? ACCENT : T.rowHover,
      color: active ? '#fff' : T.text2,
      fontFamily: FONT, fontSize: 11, fontWeight: 500, letterSpacing: -0.05,
      maxWidth: 140, minWidth: 0,
    }}>
      <span className="tw-trim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {count > 0 && (
        <span className="tw-trim" style={{
          minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: active ? 'rgba(255,255,255,0.25)' : ACCENT, color: '#fff',
          fontFamily: FONT, fontSize: 10, fontWeight: 700, lineHeight: 1,
        }}>{count}</span>
      )}
    </button>
  );
}

function SidebarGroup({ title, count, children, defaultOpen = true }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ borderBottom: `0.5px solid ${T.hairline}` }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', padding: '6px 12px',
        gap: 4, cursor: 'pointer',
      }}>
        <Icon name="chevron.down" size={10} color={T.text3}
          style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}/>
        <span style={{
          fontSize: 10, fontWeight: 700, color: T.text2,
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>{title}</span>
        {count != null && (
          <span style={{ fontSize: 10, color: T.text3 }}>{count}</span>
        )}
      </div>
      {open && <div style={{ paddingBottom: 4 }}>{children}</div>}
    </div>
  );
}

function gActionStyle() {
  return {
    width: 22, height: 22, border: 'none', background: 'transparent',
    borderRadius: 6, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 120ms ease',
  };
}
