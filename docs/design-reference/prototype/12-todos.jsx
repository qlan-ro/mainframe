// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Tasks (Todos) board + edit modal + quick-add
// Reached the real way: the checklist icon next to the traffic lights
// dispatches 'mf:open-tasks', which MainframeTabbed listens for and opens
// the fullview board (mirrors the source TodosPanel fullview). The board
// hosts the create/edit TodoModal; QuickTaskDialog is the ⌘⇧T fast path.
// Single source of truth: window.TodosBoard / window.QuickTaskDialog are
// mounted by the workspace AND by Tasks Review.html. Depends on: 01-base.
// ════════════════════════════════════════════════════════════════

// ── Type / priority palettes (warm-chrome compatible tints) ───────────
const TD_TYPE = {
  bug:           { label: 'Bug',           fg: '#c4302b', bg: 'rgba(196,48,43,0.10)' },
  feature:       { label: 'Feature',       fg: ACCENT,    bg: `rgba(${ACCENT_RGB},0.10)` },
  enhancement:   { label: 'Enhancement',   fg: '#7b3ff2', bg: 'rgba(123,63,242,0.10)' },
  documentation: { label: 'Documentation', fg: T.text2,   bg: T.chipBg },
  question:      { label: 'Question',      fg: '#b9770e', bg: 'rgba(185,119,14,0.12)' },
  wont_fix:      { label: "Won't fix",     fg: T.text3,   bg: T.chipBg },
  duplicate:     { label: 'Duplicate',     fg: '#c2540a', bg: 'rgba(194,84,10,0.10)' },
  invalid:       { label: 'Invalid',       fg: T.text3,   bg: T.chipBg },
};
const TD_PRI = {
  critical: { label: 'Critical', fg: '#c4302b', bg: 'rgba(196,48,43,0.10)', dot: '#c4302b' },
  high:     { label: 'High',     fg: '#c2540a', bg: 'rgba(194,84,10,0.10)', dot: '#e8730f' },
  medium:   { label: 'Medium',   fg: '#a76d0c', bg: 'rgba(185,119,14,0.12)', dot: '#e0a019' },
  low:      { label: 'Low',      fg: T.text3,   bg: T.chipBg,                dot: '#c4c2bd' },
};
const TD_COLUMNS = [
  { status: 'open',        label: 'Open' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'done',        label: 'Done' },
];
const TD_TYPE_KEYS = ['bug', 'feature', 'enhancement', 'documentation', 'question'];
const TD_PRI_KEYS  = ['critical', 'high', 'medium', 'low'];
const TD_PRI_RANK  = { critical: 0, high: 1, medium: 2, low: 3 };
const TD_SORT_LABELS = { number: '#', priority: 'Priority', type: 'Type' };

// ── Seed data — real-feeling Mainframe backlog ────────────────────────
const TODOS_SEED = [
  { number: 2,  title: 'Show warning errors in consumption details UI', body: 'The consumption panel swallows soft-limit warnings. Surface them inline with a dismissible banner.', status: 'open', type: 'bug', priority: 'high', labels: ['ui', 'billing'], assignees: ['dana'], milestone: 'v1.2', dependencies: [], attachments: 1, created: '2026-05-12', updated: '2026-05-28' },
  { number: 4,  title: 'Search in chat content', body: 'Add full-text search across the active session transcript, with match highlighting and ⌘G to cycle.', status: 'open', type: 'feature', priority: 'medium', labels: ['chat', 'search'], assignees: [], milestone: 'v1.2', dependencies: [], attachments: 0, created: '2026-05-15', updated: '2026-05-22' },
  { number: 5,  title: 'Desktop & mobile — enable/disable notifications', body: 'Per-surface notification toggles in Settings → Notifications. Persist to the daemon.', status: 'open', type: 'feature', priority: 'low', labels: ['settings'], assignees: ['lee'], milestone: '', dependencies: [12], attachments: 0, created: '2026-05-18', updated: '2026-05-30' },
  { number: 9,  title: 'Composer drops attachment on rapid paste', body: 'Pasting two images within ~80ms races the upload buffer; the second is silently dropped.', status: 'open', type: 'bug', priority: 'critical', labels: ['composer'], assignees: ['dana'], milestone: 'v1.2', dependencies: [], attachments: 2, created: '2026-05-29', updated: '2026-06-01' },
  { number: 11, title: 'Document the launch-config schema', body: 'Write the reference for LAUNCH_CONFIGS: fields, web vs process, the ↑ CHAT capture cluster.', status: 'open', type: 'documentation', priority: 'low', labels: ['docs'], assignees: [], milestone: '', dependencies: [], attachments: 0, created: '2026-05-09', updated: '2026-05-20' },
  { number: 6,  title: 'Auto-switch worktree after archiving a session', body: 'When the active session is archived, fall through to the next session in the same worktree instead of an empty state.', status: 'in_progress', type: 'enhancement', priority: 'medium', labels: ['sessions', 'git'], assignees: ['lee'], milestone: 'v1.2', dependencies: [], attachments: 0, created: '2026-05-21', updated: '2026-06-02' },
  { number: 12, title: 'Wire @-mentions in composer', body: 'Trigger the context picker on `@`, insert a pill, and attach the referenced file/symbol to the turn.', status: 'in_progress', type: 'feature', priority: 'high', labels: ['composer', 'chat'], assignees: ['dana', 'lee'], milestone: 'v1.2', dependencies: [], attachments: 0, created: '2026-05-24', updated: '2026-06-02' },
  { number: 14, title: 'Diff review: keyboard-only navigation', body: 'j/k between hunks, v to mark viewed, Cmd-Enter to commit — no mouse required.', status: 'in_progress', type: 'enhancement', priority: 'medium', labels: ['review'], assignees: [], milestone: '', dependencies: [], attachments: 0, created: '2026-05-26', updated: '2026-06-01' },
  { number: 7,  title: 'Move skills panel to bottom drawer', body: 'Relocate the skills list from the inspector into a collapsible bottom drawer shared with the console.', status: 'done', type: 'enhancement', priority: 'low', labels: ['layout'], assignees: ['lee'], milestone: 'v1.1', dependencies: [], attachments: 0, created: '2026-04-30', updated: '2026-05-14' },
  { number: 8,  title: 'Provider lock after first message', body: 'Once a session sends its first turn, lock the provider selector and show a lock affordance.', status: 'done', type: 'feature', priority: 'medium', labels: ['composer'], assignees: ['dana'], milestone: 'v1.1', dependencies: [], attachments: 0, created: '2026-05-02', updated: '2026-05-16' },
  { number: 10, title: 'Crash when closing the last surface', body: 'Closing the final surface left the workspace in an unmountable state. Guard listSurfaces length.', status: 'done', type: 'bug', priority: 'high', labels: ['layout'], assignees: ['lee'], milestone: 'v1.1', dependencies: [], attachments: 0, created: '2026-05-05', updated: '2026-05-19' },
];
let TD_NEXT_NUM = 20;

// ── Dates ─────────────────────────────────────────────────────────────
const TD_NOW = new Date('2026-06-02T12:00:00');
function tdFmtDate(s) { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function tdAgo(s) {
  const days = Math.round((TD_NOW - new Date(s + 'T12:00:00')) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + 'd ago';
  if (days < 28) return Math.round(days / 7) + 'w ago';
  return tdFmtDate(s);
}
function tdTodayISO() { return TD_NOW.toISOString().slice(0, 10); }

// ── Pure helpers ──────────────────────────────────────────────────────
function tdAllLabels(todos) {
  const s = new Set();
  todos.forEach(t => t.labels.forEach(l => s.add(l)));
  return [...s].sort();
}
function tdMatch(t, f) {
  if (f.types.length && !f.types.includes(t.type)) return false;
  if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
  if (f.labels.length && !f.labels.some(l => t.labels.includes(l))) return false;
  if (f.search && !t.title.toLowerCase().includes(f.search.toLowerCase())) return false;
  return true;
}
function tdSort(todos, sort) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...todos].sort((a, b) => {
    if (sort.key === 'number') return (a.number - b.number) * dir;
    if (sort.key === 'priority') return ((TD_PRI_RANK[a.priority] ?? 4) - (TD_PRI_RANK[b.priority] ?? 4)) * dir;
    if (sort.key === 'updated') return (new Date(a.updated) - new Date(b.updated)) * dir;
    return a.type.localeCompare(b.type) * dir;
  });
}
const tdHasFilters = f => f.types.length > 0 || f.priorities.length > 0 || f.labels.length > 0 || f.search.length > 0;

// ── Small shared bits ─────────────────────────────────────────────────
function TdPill({ meta, dot }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 6, background: meta.bg,
      fontFamily: FONT, fontSize: 11, fontWeight: 600, color: meta.fg,
      letterSpacing: -0.05, whiteSpace: 'nowrap',
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.dot, flexShrink: 0 }}/>}
      {meta.label}
    </span>
  );
}
function TdChip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
      fontFamily: FONT, fontSize: 11, fontWeight: 500, letterSpacing: -0.05,
      background: on ? `rgba(${ACCENT_RGB},0.14)` : T.chipBg,
      color: on ? ACCENT : T.text2, textTransform: 'capitalize',
      transition: 'background .12s',
    }}>{children}</button>
  );
}

// ── Card ──────────────────────────────────────────────────────────────
function TdCard({ todo, onEdit, onDelete, onStart, onDragStart }) {
  const [hover, setHover] = React.useState(false);
  const tm = TD_TYPE[todo.type] || TD_TYPE.invalid;
  const pm = TD_PRI[todo.priority] || TD_PRI.low;
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/todo', String(todo.number)); onDragStart && onDragStart(todo); }}
      onClick={() => onEdit(todo)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: T.content, borderRadius: 8, padding: '10px 11px',
        border: `0.5px solid ${hover ? T.borderH : T.border}`,
        boxShadow: hover ? '0 4px 12px rgba(0,0,0,0.07)' : '0 1px 2px rgba(0,0,0,0.03)',
        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7,
        transition: 'border-color .12s, box-shadow .12s',
      }}>
      {/* Row 1 — number + title + type */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: ACCENT, flexShrink: 0, marginTop: 1 }}>#{todo.number}</span>
        <span style={{
          flex: 1, fontFamily: FONT, fontSize: 13, fontWeight: 600, color: todo.status === 'done' ? T.text3 : T.text,
          lineHeight: 1.32, letterSpacing: -0.15, textDecoration: todo.status === 'done' ? 'line-through' : 'none',
        }}>{todo.title}</span>
        <span style={{
          flexShrink: 0, padding: '1px 6px', borderRadius: 6, background: tm.bg,
          fontFamily: FONT, fontSize: 10, fontWeight: 600, color: tm.fg, marginTop: 1,
        }}>{tm.label}</span>
      </div>
      {/* Row 2 — priority + dependency note + updated date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TdPill meta={pm} dot/>
        {todo.dependencies.length > 0 && (
          <span style={{ fontFamily: FONT, fontSize: 10, color: T.text3 }}>
            Depends on {todo.dependencies.map(n => `#${n}`).join(', ')}
          </span>
        )}
        <span style={{ flex: 1 }}/>
        <span title={`Updated ${tdFmtDate(todo.updated)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, fontFamily: FONT, fontSize: 10, color: T.text3, whiteSpace: 'nowrap' }}>
          <Icon name="clock" size={11} color={T.text4}/>{tdAgo(todo.updated)}
        </span>
      </div>
      {/* Row 3 — labels + attachments + hover actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 22 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, minWidth: 0 }}>
          {todo.labels.map(l => (
            <span key={l} style={{ padding: '1px 6px', borderRadius: 6, background: T.chipBg, fontFamily: FONT, fontSize: 10, color: T.text2 }}>{l}</span>
          ))}
          {todo.attachments > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: T.text3, fontFamily: FONT, fontSize: 10 }}>
              <Icon name="paperclip" size={11} color={T.text3}/>{todo.attachments}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, opacity: hover ? 1 : 0, transition: 'opacity .12s' }}>
          {todo.status !== 'done' && (
            <button title="Start session" onClick={(e) => { e.stopPropagation(); onStart(todo); }} style={tdIconBtn(ACCENT)}>
              <Icon name="play.fill" size={11} color={ACCENT}/>
            </button>
          )}
          <button title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(todo); }} style={tdIconBtn(T.text2)}>
            <Icon name="pencil" size={12} color={T.text2}/>
          </button>
          <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(todo); }} style={tdIconBtn(T.red)}>
            <Icon name="trash" size={12} color={T.text3}/>
          </button>
        </div>
      </div>
    </div>
  );
}
function tdIconBtn() {
  return { width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
}

// ── Filter bar ────────────────────────────────────────────────────────
function TdMenuBtn({ active, count, children, onClick, open }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
      border: `0.5px solid ${active || open ? 'transparent' : T.border}`,
      background: active ? `rgba(${ACCENT_RGB},0.12)` : (open ? T.rowHover : T.content),
      color: active ? ACCENT : T.text2, fontFamily: FONT, fontSize: 12, fontWeight: 500,
    }}>
      {children}
      {count > 0 && <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: ACCENT, background: `rgba(${ACCENT_RGB},0.18)`, borderRadius: 6, padding: '0 5px', height: 15, display: 'inline-flex', alignItems: 'center' }}>{count}</span>}
      <Icon name="chevron.down" size={9} color={active ? ACCENT : T.text3}/>
    </button>
  );
}

function TdFilterMenu({ label, options, selected, onToggle }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <TdMenuBtn active={selected.length > 0} count={selected.length} open={open} onClick={() => setOpen(o => !o)}>{label}</TdMenuBtn>
      {open && (<>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }}/>
        <div style={{ position: 'absolute', top: 34, left: 0, zIndex: 11, minWidth: 172, maxHeight: 264, overflowY: 'auto', background: T.content, borderRadius: 11, padding: 5, boxShadow: T.shadow }}>
          {options.map(o => {
            const on = selected.includes(o.id);
            return (
              <button key={o.id} type="button" onClick={() => onToggle(o.id)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', borderRadius: 8,
                border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: FONT, fontSize: 12, color: T.text,
              }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: on ? ACCENT : 'transparent', border: on ? 'none' : `1.5px solid ${T.border}` }}>
                  {on && <Icon name="checkmark" size={9} color="#fff"/>}
                </span>
                {o.swatch && <span style={{ width: 8, height: 8, borderRadius: '50%', background: o.swatch, flexShrink: 0 }}/>}
                <span style={{ flex: 1 }}>{o.label}</span>
              </button>
            );
          })}
        </div>
      </>)}
    </div>
  );
}

const TD_SORTS = [
  { key: 'priority', label: 'Priority' },
  { key: 'number',   label: 'Number' },
  { key: 'updated',  label: 'Last updated' },
  { key: 'type',     label: 'Type' },
];
function TdSortMenu({ sort, onSort }) {
  const [open, setOpen] = React.useState(false);
  const cur = TD_SORTS.find(s => s.key === sort.key) || TD_SORTS[0];
  const dirIcon = sort.dir === 'desc' ? 'arrow.down' : 'arrow.up';
  const pick = (key) => {
    if (sort.key === key) onSort({ key, dir: sort.dir === 'desc' ? 'asc' : 'desc' });
    else onSort({ key, dir: (key === 'priority' || key === 'type') ? 'asc' : 'desc' });
  };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
        border: `0.5px solid ${open ? 'transparent' : T.border}`, background: open ? T.rowHover : T.content, color: T.text2, fontFamily: FONT, fontSize: 12, fontWeight: 500,
      }}>
        <Icon name="chevron.up.down" size={12} color={T.text3}/>{cur.label}<Icon name={dirIcon} size={10} color={T.text3}/>
      </button>
      {open && (<>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }}/>
        <div style={{ position: 'absolute', top: 34, right: 0, zIndex: 11, minWidth: 172, background: T.content, borderRadius: 11, padding: 5, boxShadow: T.shadow }}>
          {TD_SORTS.map(s => {
            const on = sort.key === s.key;
            return (
              <button key={s.key} type="button" onClick={() => pick(s.key)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', borderRadius: 8, border: 'none',
                background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: FONT, fontSize: 12, color: on ? ACCENT : T.text, fontWeight: on ? 600 : 400,
              }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <span style={{ width: 14, flexShrink: 0, display: 'inline-flex' }}>{on && <Icon name="checkmark" size={11} color={ACCENT}/>}</span>
                <span style={{ flex: 1 }}>{s.label}</span>
                {on && <Icon name={dirIcon} size={10} color={ACCENT}/>}
              </button>
            );
          })}
        </div>
      </>)}
    </div>
  );
}

function TdFilterBar({ filters, onChange, allLabels, sort, onSort }) {
  const toggle = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  const active = tdHasFilters(filters);
  const typeOpts = TD_TYPE_KEYS.map(t => ({ id: t, label: TD_TYPE[t].label, swatch: TD_TYPE[t].fg }));
  const priOpts = TD_PRI_KEYS.map(p => ({ id: p, label: TD_PRI[p].label, swatch: TD_PRI[p].dot }));
  const lblOpts = allLabels.map(l => ({ id: l, label: l }));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: `0.5px solid ${T.hairline}`, background: T.content2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, width: 230, height: 30, padding: '0 10px', background: T.content, borderRadius: 8, border: `0.5px solid ${T.border}` }}>
        <Icon name="magnifyingglass" size={13} color={T.text3}/>
        <input value={filters.search} onChange={(e) => onChange({ ...filters, search: e.target.value })} placeholder="Search tasks…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT, fontSize: 12, color: T.text, minWidth: 0 }}/>
        {filters.search && <button onClick={() => onChange({ ...filters, search: '' })} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'inline-flex' }}><Icon name="xmark" size={11} color={T.text3}/></button>}
      </div>
      <TdFilterMenu label="Type" options={typeOpts} selected={filters.types} onToggle={(v) => onChange({ ...filters, types: toggle(filters.types, v) })}/>
      <TdFilterMenu label="Priority" options={priOpts} selected={filters.priorities} onToggle={(v) => onChange({ ...filters, priorities: toggle(filters.priorities, v) })}/>
      {allLabels.length > 0 && <TdFilterMenu label="Label" options={lblOpts} selected={filters.labels} onToggle={(v) => onChange({ ...filters, labels: toggle(filters.labels, v) })}/>}
      {active && <button type="button" onClick={() => onChange({ types: [], priorities: [], labels: [], search: '' })} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: 12, fontWeight: 500, padding: '0 4px' }}>Clear</button>}
      <div style={{ flex: 1 }}/>
      <TdSortMenu sort={sort} onSort={onSort}/>
    </div>
  );
}

// ── Edit / create modal ───────────────────────────────────────────────
function TdField({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <label style={{ fontFamily: FONT, fontSize: 11, color: T.text2, fontWeight: 500 }}>{label}</label>
        {hint && <span style={{ fontFamily: FONT, fontSize: 10, color: T.text3 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
const tdInput = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8,
  border: `0.5px solid ${T.border}`, background: T.content2, outline: 'none',
  fontFamily: FONT, fontSize: 13, color: T.text, letterSpacing: -0.1,
};
const tdSelect = { ...tdInput, cursor: 'pointer', appearance: 'none', textTransform: 'capitalize',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%2392918d' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 9px center', paddingRight: 26 };

function TdLabelEditor({ value, onChange }) {
  const [draft, setDraft] = React.useState('');
  const add = () => { const v = draft.trim(); if (v && !value.includes(v)) onChange([...value, v]); setDraft(''); };
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: '5px 8px', minHeight: 34, boxSizing: 'border-box',
      borderRadius: 8, border: `0.5px solid ${T.border}`, background: T.content2,
    }}>
      {value.map(l => (
        <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 8px', borderRadius: 6, background: T.chipBg, fontFamily: FONT, fontSize: 11, color: T.text2 }}>
          {l}
          <button onClick={() => onChange(value.filter(x => x !== l))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'inline-flex' }}>
            <Icon name="xmark" size={9} color={T.text3}/>
          </button>
        </span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1)); }}
        placeholder={value.length ? '' : 'Add label…'} style={{ flex: 1, minWidth: 70, border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT, fontSize: 12, color: T.text }}/>
    </div>
  );
}

function TdEditModal({ todo, allLabels = [], onClose, onSave, onDelete, onStart, embedded }) {
  const isEdit = !!todo;
  const [title, setTitle] = React.useState(todo?.title || '');
  const [body, setBody] = React.useState(todo?.body || '');
  const [type, setType] = React.useState(todo?.type || 'feature');
  const [priority, setPriority] = React.useState(todo?.priority || 'medium');
  const [status, setStatus] = React.useState(todo?.status || 'open');
  const [labels, setLabels] = React.useState(todo?.labels || []);
  const [assignees, setAssignees] = React.useState((todo?.assignees || []).join(', '));
  const [milestone, setMilestone] = React.useState(todo?.milestone || '');

  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  const save = () => {
    if (!title.trim()) return;
    onSave({
      ...(todo || {}),
      title: title.trim(), body: body.trim(), type, priority, status, labels,
      assignees: assignees.split(',').map(a => a.trim()).filter(Boolean),
      milestone: milestone.trim(),
    });
  };

  return (
    <div onClick={embedded ? undefined : onClose} style={{ position: embedded ? 'absolute' : 'fixed', inset: 0, zIndex: 4500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,19,15,0.40)', fontFamily: FONT }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 520, maxWidth: '92vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: T.content, borderRadius: 13, overflow: 'hidden', boxShadow: T.shadow,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: `0.5px solid ${T.hairline}`, background: T.content2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name={isEdit ? 'pencil' : 'plus'} size={14} color={ACCENT}/>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>{isEdit ? `Edit Task #${todo.number}` : 'New Task'}</span>
          </div>
          <button onClick={onClose} style={tdIconBtn()} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="xmark" size={14} color={T.text2}/>
          </button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 13 }}>
          {isEdit && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: 11, color: T.text3 }}>
              <Icon name="clock" size={12} color={T.text3}/>Created {tdFmtDate(todo.created)} · Updated {tdAgo(todo.updated)}
            </div>
          )}
          <TdField label="Title *">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" style={tdInput}/>
          </TdField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <TdField label="Type">
              <select value={type} onChange={(e) => setType(e.target.value)} style={tdSelect}>
                {Object.keys(TD_TYPE).map(t => <option key={t} value={t}>{TD_TYPE[t].label}</option>)}
              </select>
            </TdField>
            <TdField label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} style={tdSelect}>
                {TD_PRI_KEYS.map(p => <option key={p} value={p}>{TD_PRI[p].label}</option>)}
              </select>
            </TdField>
            <TdField label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={tdSelect}>
                {TD_COLUMNS.map(c => <option key={c.status} value={c.status}>{c.label}</option>)}
              </select>
            </TdField>
          </div>
          <TdField label="Description" hint="Markdown · paste image to attach">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Describe the task…" style={{ ...tdInput, resize: 'none', lineHeight: 1.5 }}/>
          </TdField>
          <TdField label="Attachments">
            <button type="button" style={{
              alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
              border: `0.5px dashed ${T.borderH}`, background: 'transparent', cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: 12,
            }}>
              <Icon name="arrow.up" size={12} color={T.text2}/>Add image
            </button>
          </TdField>
          <TdField label="Labels">
            <TdLabelEditor value={labels} onChange={setLabels}/>
          </TdField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <TdField label="Assignees">
              <input value={assignees} onChange={(e) => setAssignees(e.target.value)} placeholder="e.g. alice, bob" style={tdInput}/>
            </TdField>
            <TdField label="Milestone">
              <input value={milestone} onChange={(e) => setMilestone(e.target.value)} placeholder="e.g. v1.2" style={tdInput}/>
            </TdField>
          </div>
        </div>
        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderTop: `0.5px solid ${T.hairline}`, background: T.content2 }}>
          {isEdit && (
            <button onClick={() => { onDelete(todo); onClose(); }} style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: T.red, fontFamily: FONT, fontSize: 12 }}>
              <Icon name="trash" size={12} color={T.red}/>Delete
            </button>
          )}
          {isEdit && status === 'in_progress' && (
            <button onClick={() => { onStart(todo); onClose(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, border: 'none', background: `rgba(${ACCENT_RGB},0.12)`, cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: 12, fontWeight: 600, marginLeft: isEdit ? 0 : 'auto' }}>
              <Icon name="play.fill" size={11} color={ACCENT}/>Start session
            </button>
          )}
          <button onClick={onClose} style={{ marginLeft: isEdit && status === 'in_progress' ? 0 : 'auto', padding: '7px 13px', borderRadius: 8, border: 'none', background: T.chipBg, cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: 12, fontWeight: 500 }}>Cancel</button>
          <button onClick={save} disabled={!title.trim()} style={{ padding: '7px 15px', borderRadius: 8, border: 'none', cursor: title.trim() ? 'pointer' : 'default', background: ACCENT, opacity: title.trim() ? 1 : 0.4, color: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>
            {isEdit ? 'Save changes' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Agent-first list view pieces ──────────────────────────────────────
const TD_AVATARS = [[ACCENT, `rgba(${ACCENT_RGB},0.14)`], ['#7b3ff2', 'rgba(123,63,242,0.13)'], ['#c2540a', 'rgba(194,84,10,0.13)'], ['#1f8a5b', 'rgba(31,138,91,0.15)'], ['#a76d0c', 'rgba(185,119,14,0.16)']];
function tdHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

function TdAvatar({ name, size = 20 }) {
  const [fg, bg] = TD_AVATARS[tdHash(name) % TD_AVATARS.length];
  return (
    <span title={name} style={{ width: size, height: size, borderRadius: '50%', background: bg, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontSize: size * 0.42, fontWeight: 700, flexShrink: 0, textTransform: 'uppercase' }}>{name.slice(0, 2)}</span>
  );
}

// Clickable lifecycle dot — open → in progress → done → open.
function TdStatusDot({ status, onCycle }) {
  const [hover, setHover] = React.useState(false);
  let inner;
  if (status === 'done') inner = <span style={{ width: 16, height: 16, borderRadius: '50%', background: T.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="checkmark" size={9} color="#fff"/></span>;
  else if (status === 'in_progress') inner = <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${ACCENT}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><span className="tw-pulse" style={{ width: 5, height: 5, borderRadius: '50%', background: ACCENT }}/></span>;
  else inner = <span style={{ width: 14, height: 14, borderRadius: '50%', border: `1.6px solid ${hover ? ACCENT : T.text4}`, transition: 'border-color .1s' }}/>;
  return (
    <button title="Cycle status" onClick={(e) => { e.stopPropagation(); onCycle(); }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ width: 18, height: 18, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{inner}</button>
  );
}

function TdListRow({ todo, selected, expanded, onClick, onCycle, onEdit, onDelete, onStart }) {
  const [hover, setHover] = React.useState(false);
  const tm = TD_TYPE[todo.type] || TD_TYPE.invalid;
  const pm = TD_PRI[todo.priority] || TD_PRI.low;
  const done = todo.status === 'done';
  const running = todo.status === 'in_progress';
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ borderBottom: `0.5px solid ${T.hairline}`, background: selected ? T.selBg : (hover ? T.rowHover : 'transparent'), transition: 'background .1s' }}>
      <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, paddingRight: 14, cursor: 'pointer' }}>
        <span style={{ width: 3, alignSelf: 'stretch', background: running ? ACCENT : pm.dot, opacity: done ? 0.3 : 1, flexShrink: 0 }}/>
        <TdStatusDot status={todo.status} onCycle={onCycle}/>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: done ? T.text4 : ACCENT, flexShrink: 0, width: 30 }}>#{todo.number}</span>
        <span style={{ flex: 1, minWidth: 0, fontFamily: FONT, fontSize: 13, fontWeight: 500, color: done ? T.text3 : T.text, letterSpacing: -0.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: done ? 'line-through' : 'none' }}>{todo.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ padding: '1px 6px', borderRadius: 6, background: tm.bg, fontFamily: FONT, fontSize: 10, fontWeight: 600, color: tm.fg }}>{tm.label}</span>
          {todo.labels.slice(0, 2).map(l => (
            <span key={l} style={{ padding: '1px 6px', borderRadius: 6, background: T.chipBg, fontFamily: FONT, fontSize: 10, color: T.text3 }}>{l}</span>
          ))}
          {todo.attachments > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: T.text3, fontFamily: FONT, fontSize: 10 }}><Icon name="paperclip" size={11} color={T.text3}/>{todo.attachments}</span>}
        </span>
        <div style={{ width: 84, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <span title={`Updated ${tdFmtDate(todo.updated)}`} style={{ fontFamily: FONT, fontSize: 10, color: T.text3, whiteSpace: 'nowrap' }}>{tdAgo(todo.updated)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, width: 78, justifyContent: 'flex-end', opacity: hover ? 1 : 0, transition: 'opacity .1s' }}>
          {!done && <button title="Start session (↵)" onClick={(e) => { e.stopPropagation(); onStart(todo); }} style={tdIconBtn()}><Icon name="play.fill" size={11} color={ACCENT}/></button>}
          <button title="Edit (E)" onClick={(e) => { e.stopPropagation(); onEdit(todo); }} style={tdIconBtn()}><Icon name="pencil" size={12} color={T.text2}/></button>
          <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(todo); }} style={tdIconBtn()}><Icon name="trash" size={12} color={T.text3}/></button>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 14px 31px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          {todo.body && <p style={{ margin: 0, fontFamily: FONT, fontSize: 12, color: T.text2, lineHeight: 1.55, maxWidth: 720 }}>{todo.body}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <TdPill meta={pm} dot/>
            {todo.milestone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT, fontSize: 11, color: T.text3 }}><Icon name="tag" size={11} color={T.text3}/>{todo.milestone}</span>}
            {todo.dependencies.length > 0 && <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3 }}>Depends on {todo.dependencies.map(n => `#${n}`).join(', ')}</span>}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT, fontSize: 11, color: T.text3 }}><Icon name="clock" size={11} color={T.text3}/>Created {tdFmtDate(todo.created)} · Updated {tdAgo(todo.updated)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {!done && (
              <button onClick={(e) => { e.stopPropagation(); onStart(todo); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>
                <Icon name="play.fill" size={11} color="#fff"/>{running ? 'Resume session' : 'Start session'}
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onEdit(todo); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `0.5px solid ${T.border}`, background: T.content, color: T.text2, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 500 }}>
              <Icon name="pencil" size={11} color={T.text2}/>Edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const TD_LIST_GROUPS = [
  { status: 'in_progress', label: 'In Progress' },
  { status: 'open',        label: 'Open' },
  { status: 'done',        label: 'Done' },
];

function TdListView({ todos, filters, sort, selected, setSelected, expanded, setExpanded, onCycle, onEdit, onDelete, onStart }) {
  const [collapsed, setCollapsed] = React.useState({ done: true });
  const groups = TD_LIST_GROUPS.map(g => ({ ...g, items: tdSort(todos.filter(t => t.status === g.status && tdMatch(t, filters)), sort) }));
  const total = groups.reduce((a, g) => a + g.items.length, 0);

  // Keyboard-first: ↑/↓ select · ↵ start session · E edit · Space cycle · →/← expand.
  React.useEffect(() => {
    const order = [];
    groups.forEach(g => { if (!collapsed[g.status]) g.items.forEach(t => order.push(t)); });
    const h = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const idx = order.findIndex(t => t.number === selected);
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); const n = order[Math.min(order.length - 1, idx < 0 ? 0 : idx + 1)]; if (n) setSelected(n.number); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); const n = order[Math.max(0, idx < 0 ? 0 : idx - 1)]; if (n) setSelected(n.number); }
      else if (idx >= 0) {
        const t = order[idx];
        if (e.key === 'Enter') { e.preventDefault(); onStart(t); }
        else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); onEdit(t); }
        else if (e.key === ' ') { e.preventDefault(); onCycle(t); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setExpanded(t.number); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setExpanded(null); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [todos, filters, sort, collapsed, selected]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: T.content }}>
      {total === 0 ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: T.text4 }}>
          <Icon name="checklist.box" size={26} color={T.text4}/>
          <span style={{ fontFamily: FONT, fontSize: 13 }}>{tdHasFilters(filters) ? 'No tasks match these filters' : 'No tasks yet'}</span>
        </div>
      ) : groups.map(g => g.items.length === 0 ? null : (
        <section key={g.status}>
          <div onClick={() => setCollapsed(c => ({ ...c, [g.status]: !c[g.status] }))}
            style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', background: T.content2, borderBottom: `0.5px solid ${T.hairline}`, cursor: 'pointer' }}>
            <span style={{ display: 'inline-flex', transform: collapsed[g.status] ? 'rotate(-90deg)' : 'none', transition: 'transform .12s' }}><Icon name="chevron.down" size={10} color={T.text3}/></span>
            <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: 0.6 }}>{g.label}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: T.text3, padding: '1px 6px', borderRadius: 8, background: T.chipBg }}>{g.items.length}</span>
          </div>
          {!collapsed[g.status] && g.items.map(t => (
            <TdListRow key={t.number} todo={t} selected={selected === t.number} expanded={expanded === t.number}
              onClick={() => { setSelected(t.number); setExpanded(e => e === t.number ? null : t.number); }}
              onCycle={() => onCycle(t)} onEdit={onEdit} onDelete={onDelete} onStart={onStart}/>
          ))}
        </section>
      ))}
    </div>
  );
}

// ── Board view (kanban — the alternate) ───────────────────────────────
function TdBoardView({ todos, filters, sort, dragOver, setDragOver, move, onEdit, onDelete, onStart }) {
  return (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: T.hairline, minHeight: 0 }}>
      {TD_COLUMNS.map(({ status, label }) => {
        const col = tdSort(todos.filter(t => t.status === status && tdMatch(t, filters)), sort);
        const isOver = dragOver === status;
        return (
          <div key={status} data-screen-label={`Column ${label}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(status); }}
            onDragLeave={() => setDragOver(d => d === status ? null : d)}
            onDrop={(e) => { e.preventDefault(); const n = +e.dataTransfer.getData('text/todo'); if (n) move(n, status); setDragOver(null); }}
            style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: isOver ? `rgba(${ACCENT_RGB},0.05)` : T.content2, transition: 'background .12s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px 8px', flexShrink: 0 }}>
              <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: T.text3, padding: '1px 6px', borderRadius: 8, background: T.chipBg }}>{col.length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              {col.length === 0 ? (
                <div style={{ flex: 1, minHeight: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px dashed ${T.border}`, borderRadius: 8, color: T.text4, fontFamily: FONT, fontSize: 12 }}>
                  {tdHasFilters(filters) ? 'No matches' : isOver ? 'Drop here' : 'Nothing here'}
                </div>
              ) : col.map(t => <TdCard key={t.number} todo={t} onEdit={onEdit} onDelete={onDelete} onStart={onStart}/>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// View switcher (List ⇄ Board)
function TdSegmented({ value, onChange }) {
  const opts = [{ id: 'list', label: 'List', icon: 'doc.text' }, { id: 'board', label: 'Board', icon: 'square.grid.2x2' }];
  return (
    <div style={{ display: 'inline-flex', padding: 2, borderRadius: 8, background: T.chipBg, gap: 2 }}>
      {opts.map(o => {
        const on = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: on ? T.content : 'transparent', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.13)' : 'none',
            color: on ? T.text : T.text3, fontFamily: FONT, fontSize: 12, fontWeight: on ? 600 : 500,
          }}>
            <Icon name={o.icon} size={12} color={on ? ACCENT : T.text3}/>{o.label}
          </button>
        );
      })}
    </div>
  );
}

const TD_HINTS = [['↑↓', 'Navigate'], ['↵', 'Start session'], ['E', 'Edit'], ['Space', 'Toggle status']];
function TdFooterHints() {
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, padding: '7px 16px', borderTop: `0.5px solid ${T.hairline}`, background: T.content2 }}>
      {TD_HINTS.map(([k, l]) => (
        <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: T.text2, padding: '1px 6px', borderRadius: 6, background: T.content, border: `0.5px solid ${T.border}` }}>{k}</span>
          <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3 }}>{l}</span>
        </span>
      ))}
    </div>
  );
}

// ── The Tasks surface (fullview) — agent-first list, board as alternate ─
function TodosBoard({ open, onClose, embedded, defaultView = 'list' }) {
  const [todos, setTodos] = React.useState(TODOS_SEED);
  const [filters, setFilters] = React.useState({ types: [], priorities: [], labels: [], search: '' });
  const [sort, setSort] = React.useState({ key: 'priority', dir: 'asc' });
  const [editing, setEditing] = React.useState(null); // todo | 'new' | null
  const [dragOver, setDragOver] = React.useState(null);
  const [view, setView] = React.useState(defaultView);
  const [selected, setSelected] = React.useState(null);
  const [expanded, setExpanded] = React.useState(null);

  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape' && !editing) { e.preventDefault(); onClose && onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose, editing]);

  if (!open) return null;

  const allLabels = tdAllLabels(todos);
  const move = (number, status) => setTodos(ts => ts.map(t => t.number === number ? { ...t, status, updated: tdTodayISO() } : t));
  const remove = (todo) => setTodos(ts => ts.filter(t => t.number !== todo.number));
  const start = (todo) => { if (todo.status === 'open') move(todo.number, 'in_progress'); };
  const cycle = (todo) => { const order = ['open', 'in_progress', 'done']; move(todo.number, order[(order.indexOf(todo.status) + 1) % 3]); };
  const saveTodo = (data) => {
    const today = tdTodayISO();
    setTodos(ts => {
      if (data.number != null && ts.some(t => t.number === data.number)) return ts.map(t => t.number === data.number ? { ...t, ...data, updated: today } : t);
      return [...ts, { ...data, number: TD_NEXT_NUM++, dependencies: data.dependencies || [], attachments: 0, created: today, updated: today }];
    });
    setEditing(null);
  };
  const active = todos.filter(t => t.status !== 'done').length;
  const doneN = todos.length - active;

  return (
    <div onClick={embedded ? undefined : onClose} style={embedded
      ? { position: 'relative', width: '100%', height: '100%', fontFamily: FONT, display: 'flex' }
      : { position: 'fixed', inset: 0, zIndex: 4300, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,19,15,0.45)', backdropFilter: 'blur(3px)' }}>
      <div data-screen-label="Tasks" onClick={(e) => e.stopPropagation()} style={embedded
        ? { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: T.windowBg, borderRadius: 13, overflow: 'hidden', border: `0.5px solid ${T.border}` }
        : { width: view === 'list' ? 880 : '90%', maxWidth: view === 'list' ? '94vw' : 1200, height: '86%', maxHeight: 860, display: 'flex', flexDirection: 'column', background: T.windowBg, borderRadius: 13, overflow: 'hidden', boxShadow: T.shadow, transition: 'width .18s ease' }}>
        {/* Header */}
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: `0.5px solid ${T.hairline}`, background: T.content }}>
          <button onClick={onClose} title="Close (Esc)" style={tdIconBtn()} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="xmark" size={15} color={T.text2}/>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Icon name="checklist.box" size={16} color={ACCENT}/>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>Tasks</span>
          </div>
          <span style={{ fontFamily: MONO, fontSize: 11, color: T.text3, padding: '2px 8px', borderRadius: 8, background: T.chipBg }}>{active} active · {doneN} done</span>
          <div style={{ flex: 1 }}/>
          <TdSegmented value={view} onChange={setView}/>
          <button onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>
            <Icon name="plus" size={12} color="#fff"/>New task
          </button>
        </div>

        <TdFilterBar filters={filters} onChange={setFilters} allLabels={allLabels} sort={sort} onSort={setSort}/>

        {view === 'list'
          ? <TdListView todos={todos} filters={filters} sort={sort} selected={selected} setSelected={setSelected} expanded={expanded} setExpanded={setExpanded} onCycle={cycle} onEdit={setEditing} onDelete={remove} onStart={start}/>
          : <TdBoardView todos={todos} filters={filters} sort={sort} dragOver={dragOver} setDragOver={setDragOver} move={move} onEdit={setEditing} onDelete={remove} onStart={start}/>}
      </div>

      {editing && (
        <TdEditModal
          todo={editing === 'new' ? null : editing}
          allLabels={allLabels}
          embedded={embedded}
          onClose={() => setEditing(null)}
          onSave={saveTodo}
          onDelete={remove}
          onStart={start}
        />
      )}
    </div>
  );
}

// ── Quick-add dialog (⌘⇧T fast path) ──────────────────────────────────
function QuickTaskDialog({ open, onClose, onCreate, embedded }) {
  const [type, setType] = React.useState('feature');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [priority, setPriority] = React.useState('medium');

  React.useEffect(() => {
    if (!open) return;
    setType('feature'); setTitle(''); setBody(''); setPriority('medium');
    const h = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;
  const submit = () => { if (!title.trim()) return; onCreate && onCreate({ type, title: title.trim(), body: body.trim(), priority }); onClose(); };
  const Pill = ({ active, onClick, children }) => (
    <button type="button" onClick={onClick} style={{
      padding: '5px 13px', borderRadius: 999, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 500,
      border: `0.5px solid ${active ? ACCENT : T.border}`, background: active ? ACCENT : T.content2, color: active ? '#fff' : T.text2,
    }}>{children}</button>
  );

  return (
    <div onClick={embedded ? undefined : onClose} style={{ position: embedded ? 'absolute' : 'fixed', inset: 0, zIndex: 4400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,19,15,0.40)', fontFamily: FONT }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '92vw', background: T.content, borderRadius: 13, overflow: 'hidden', boxShadow: T.shadow, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '13px 16px', borderBottom: `0.5px solid ${T.hairline}`, background: T.content2, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="bolt" size={14} color={ACCENT}/>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>Quick Task</span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 7 }}>
            <Pill active={type === 'feature'} onClick={() => setType('feature')}>Feature</Pill>
            <Pill active={type === 'bug'} onClick={() => setType('bug')}>Bug</Pill>
          </div>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }} placeholder="What needs to be done?" style={tdInput}/>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Details (optional)" style={{ ...tdInput, resize: 'none', lineHeight: 1.5 }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: FONT, fontSize: 12, color: T.text2 }}>Priority</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {['low', 'medium', 'high'].map(p => <Pill key={p} active={priority === p} onClick={() => setPriority(p)}>{TD_PRI[p].label}</Pill>)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderTop: `0.5px solid ${T.hairline}`, background: T.content2 }}>
          <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3 }}>
            <span style={{ fontFamily: MONO, padding: '1px 5px', borderRadius: 4, background: T.chipBg }}>⌘↵</span> to create · <span style={{ fontFamily: MONO, padding: '1px 5px', borderRadius: 4, background: T.chipBg }}>Esc</span> to cancel
          </span>
          <button onClick={submit} disabled={!title.trim()} style={{ padding: '7px 15px', borderRadius: 8, border: 'none', cursor: title.trim() ? 'pointer' : 'default', background: ACCENT, opacity: title.trim() ? 1 : 0.45, color: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>Create</button>
        </div>
      </div>
    </div>
  );
}

// Expose for the workspace + review canvas (single source of truth).
window.TodosBoard = TodosBoard;
window.QuickTaskDialog = QuickTaskDialog;
window.TdCard = TdCard;
window.TdListView = TdListView;
window.TdListRow = TdListRow;
window.TdBoardView = TdBoardView;
window.TdEditModal = TdEditModal;
window.TdFilterBar = TdFilterBar;
window.TODOS_SEED = TODOS_SEED;
window.TD_TYPE = TD_TYPE;
window.TD_PRI = TD_PRI;
