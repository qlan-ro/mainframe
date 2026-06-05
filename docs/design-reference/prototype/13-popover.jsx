// ============================================================
// mainframe/13-popover.jsx — the canonical popover system.
//
// ONE surface (PopCard), ONE anchored/dismissible wrapper (Popover), a kit
// of section + row primitives, and the concrete popovers built on them
// (branch switcher / new-branch form / tag editor / context menu).
//
// This module is the single source of truth for popovers. `Popovers Review.html`
// mounts these very components, and the workspace's hand-rolled menus get
// refactored onto PopCard + the row primitives so there is one look, not three.
// Every concrete popover takes an `inline` prop: inline renders just the open
// PopCard (no trigger, no backdrop) so a review artboard can show it open.
// ============================================================

// The one popover shadow + the one popover surface. (Previously there were three
// slightly-different shadow recipes scattered across the app — this unifies them.)
const POP_SHADOW = T.popShadow;

function PopCard({ width, minWidth, maxHeight, pad = 5, children, style, className }) {
  return (
    <div className={className} style={{
      width, minWidth, maxHeight, overflowY: maxHeight ? 'auto' : undefined,
      background: T.popBg, borderRadius: 11, padding: pad, boxShadow: POP_SHADOW,
      fontFamily: FONT, boxSizing: 'border-box', ...style,
    }}>{children}</div>
  );
}

// Anchored, dismissible popover. `trigger` is a render-prop receiving
// { open, toggle, close } so the caller styles its own button. `side` is which
// way the panel opens (top = above the trigger, bottom = below); `align` pins it
// to the start/end edge. ESC and outside-click both close.
//
// The panel is PORTALED to <body> and positioned with fixed coords measured from
// the trigger — this is how it escapes the workspace's nested overflow:hidden
// panes and the ZoomStage transform (same reason DragOverlay portals to body).
function Popover({ trigger, children, side = 'top', align = 'start', gap = 6,
                  width, minWidth, maxHeight, pad, panelStyle, zBase = 4000, bare }) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef(null);
  const [rect, setRect] = React.useState(null);
  React.useEffect(() => {
    if (!open) { setRect(null); return; }
    const measure = () => { if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect()); };
    measure();
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);
  const panelPos = { position: 'fixed', zIndex: zBase + 1, opacity: 1 };
  if (rect) {
    if (side === 'top') panelPos.bottom = window.innerHeight - rect.top + gap;
    else panelPos.top = rect.bottom + gap;
    if (align === 'end') panelPos.right = window.innerWidth - rect.right;
    else panelPos.left = rect.left;
  }
  return (
    <span ref={anchorRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger({ open, toggle: () => setOpen(o => !o), close: () => setOpen(false) })}
      {open && rect && ReactDOM.createPortal(
        <React.Fragment>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: zBase }}/>
          <div className="pop-pop" style={panelPos}>
            {bare
              ? (typeof children === 'function' ? children({ close: () => setOpen(false) }) : children)
              : (
                <PopCard width={width} minWidth={minWidth} maxHeight={maxHeight} pad={pad} style={panelStyle}>
                  {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
                </PopCard>
              )}
          </div>
        </React.Fragment>, document.body)}
    </span>
  );
}

// ── Section + structural primitives ──────────────────────────────────
function PopLabel({ children, trailing }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px 4px' }}>
      <span style={{ fontSize: 10, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>{children}</span>
      {trailing}
    </div>
  );
}
function PopDivider({ m = '4px 6px' }) {
  return <div style={{ height: 1, background: T.hairline, margin: m }}/>;
}
function PopFootNote({ children, top = true }) {
  return (
    <div style={{ padding: '6px 8px 3px', marginTop: 3, borderTop: top ? `0.5px solid ${T.hairline}` : 'none',
      fontSize: 10, color: T.text4, letterSpacing: -0.05, lineHeight: 1.45 }}>{children}</div>
  );
}

// Search field that lives inside a PopCard (branch switcher, tag editor, etc.).
function PopSearchField({ value, onChange, placeholder = 'Search…', autoFocus }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, margin: '2px 3px 5px', padding: '0 9px',
      background: T.content2, borderRadius: 8, border: `0.5px solid ${T.border}` }}>
      <Icon name="magnifyingglass" size={13} color={T.text3}/>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        spellCheck={false} style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent',
        fontFamily: FONT, fontSize: 12, color: T.text, minWidth: 0 }}/>
    </div>
  );
}

// ── Row primitives ───────────────────────────────────────────────────
// Action row: icon + label (+ optional note line) + hint/trailing. `danger`
// recolors for destructive items. The workhorse for context/action menus.
function PopMenuRow({ icon, iconColor, label, note, hint, trailing, danger, disabled, onClick }) {
  const ink = danger ? T.red : T.text;
  return (
    <div onClick={disabled ? undefined : onClick} style={{
      display: 'flex', alignItems: note ? 'flex-start' : 'center', gap: 9, padding: note ? '7px 8px' : '7px 8px',
      borderRadius: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontFamily: FONT,
    }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = danger ? 'rgba(220,53,69,0.08)' : T.rowHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      {icon && <span style={{ width: 16, flexShrink: 0, display: 'inline-flex', justifyContent: 'center', marginTop: note ? 1 : 0 }}>
        <Icon name={icon} size={13} color={danger ? T.red : (iconColor || T.text3)}/>
      </span>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: ink, letterSpacing: -0.1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {note && <span style={{ display: 'block', fontSize: 10, color: T.text3, marginTop: 1, lineHeight: 1.35 }}>{note}</span>}
      </span>
      {hint && <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4, flexShrink: 0 }}>{hint}</span>}
      {trailing}
    </div>
  );
}

// Single-select row: checkmark gutter + label (+ note) + trailing meta + leading dot.
function PopSelectRow({ selected, dot, label, note, meta, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6,
      cursor: 'pointer', background: selected ? T.rowHover : 'transparent', fontFamily: FONT,
    }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = T.rowHover; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
        {selected && <Icon name="checkmark" size={11} color={ACCENT}/>}
      </span>
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }}/>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: selected ? 600 : 500, color: T.text, letterSpacing: -0.1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {note && <span style={{ display: 'block', fontSize: 10, color: T.text3, marginTop: 1 }}>{note}</span>}
      </span>
      {meta != null && <span style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>{meta}</span>}
    </div>
  );
}

// Multi-select row: checkbox square + optional swatch + label.
function PopCheckRow({ checked, swatch, label, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', borderRadius: 8,
      cursor: 'pointer', fontFamily: FONT,
    }}
      onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', background: checked ? ACCENT : 'transparent', border: checked ? 'none' : `1.5px solid ${T.border}` }}>
        {checked && <Icon name="checkmark" size={9} color="#fff"/>}
      </span>
      {swatch && <span style={{ width: 8, height: 8, borderRadius: '50%', background: swatch, flexShrink: 0 }}/>}
      <span style={{ flex: 1, fontSize: 12, color: T.text }}>{label}</span>
    </div>
  );
}

function PopEmpty({ icon = 'magnifyingglass', children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '20px 10px', textAlign: 'center' }}>
      <Icon name={icon} size={18} color={T.text4}/>
      <span style={{ fontSize: 11, color: T.text3 }}>{children}</span>
    </div>
  );
}

// ── Form pieces (for form-popovers like new-branch) ──────────────────
function PopField({ label, children }) {
  return (
    <div style={{ marginBottom: 11 }}>
      <label style={{ display: 'block', fontSize: 10, color: T.text3, fontWeight: 600, letterSpacing: 0.2, marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
const POP_INPUT = {
  width: '100%', height: 30, borderRadius: 8, border: `0.5px solid ${T.border}`, background: T.content,
  padding: '0 9px', fontFamily: MONO, fontSize: 11, color: T.text, outline: 'none', boxSizing: 'border-box',
};
function PopSelectInput({ value, onChange, options }) {
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...POP_INPUT, appearance: 'none', cursor: 'pointer' }}>
        {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
      </select>
      <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
        <Icon name="chevron.down" size={10} color={T.text3}/>
      </span>
    </div>
  );
}
function PopActions({ onCancel, onConfirm, cancelLabel = 'Cancel', confirmLabel = 'Done', confirmIcon, danger, disabled }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
      <button onClick={onCancel} style={{ height: 28, padding: '0 12px', borderRadius: 8, border: 'none', background: 'transparent',
        cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 500, color: T.text2 }}>{cancelLabel}</button>
      <button onClick={disabled ? undefined : onConfirm} disabled={disabled} style={{ height: 28, padding: '0 13px', borderRadius: 8, border: 'none',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        background: danger ? T.red : ACCENT, color: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {confirmIcon && <Icon name={confirmIcon} size={11} color="#fff" stroke={2.4}/>}{confirmLabel}
      </button>
    </div>
  );
}

// Tiny helper so concrete popovers render either inline (just the card) or live
// (wrapped in a Popover with the given trigger).
function popHost({ inline, trigger, width, minWidth, maxHeight, side, align, pad, body, bare }) {
  if (inline) return bare ? body(() => {}) : <PopCard width={width} minWidth={minWidth} maxHeight={maxHeight} pad={pad}>{body(() => {})}</PopCard>;
  return (
    <Popover trigger={trigger} side={side} align={align} width={width} minWidth={minWidth} maxHeight={maxHeight} pad={pad} bare={bare}>
      {({ close }) => body(close)}
    </Popover>
  );
}

// ============================================================
// Concrete popovers — built entirely on the primitives above.
// ============================================================

const BRANCH_SEED = [
  { name: 'test/all-prs-merged', current: true, ahead: 3, behind: 0, when: '2m', author: 'you' },
  { name: 'main', ahead: 0, behind: 12, when: '1h', author: 'sam' },
  { name: 'fix/composer-lock', ahead: 2, behind: 0, when: '6h', author: 'you' },
  { name: 'release/0.20', ahead: 0, behind: 0, when: '2d', author: 'lee' },
  // Branches checked out in their own worktree dir — grouped under the worktree.
  { name: 'feat/popover-system', ahead: 7, behind: 1, when: '18m', author: 'you', worktree: 'popover-system' },
  { name: 'feat/tech-debt-all', ahead: 1, behind: 4, when: '3h', author: 'you', worktree: 'tech-debt' },
];
const BRANCH_REMOTE = [
  { name: 'origin/main', when: '1h' },
  { name: 'origin/release/0.20', when: '2d' },
  { name: 'origin/feat/popover-system', when: '18m' },
];
const BRANCH_CURRENT = BRANCH_SEED.find(b => b.current).name;

// Collapsible section header used inside the branch list (Local / worktree / Remote).
function BranchSectionHead({ icon, iconColor, label, expanded, onToggle, actions }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 26 }}>
      <button onClick={onToggle} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '0 8px', height: '100%', border: 'none', background: 'transparent', cursor: 'pointer',
        fontFamily: FONT, fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'left' }}>
        <Icon name={expanded ? 'chevron.down' : 'chevron.right'} size={9} color={T.text3}/>
        {icon && <Icon name={icon} size={11} color={iconColor || T.text3}/>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </button>
      {actions}
    </div>
  );
}

// One branch row. Clicking opens the side submenu (not an instant switch) —
// the row carries the current-check, a status dot, divergence, and a ›.
function BranchRow({ b, isCurrent, selected, onOpen }) {
  return (
    <div onClick={onOpen} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
      cursor: 'pointer', background: selected ? T.rowHover : 'transparent', fontFamily: FONT,
    }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = T.rowHover; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ width: 13, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
        {isCurrent && <Icon name="checkmark" size={11} color={ACCENT}/>}
      </span>
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: isCurrent ? T.green : T.text4 }}/>
      <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12, fontWeight: isCurrent ? 600 : 500, color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortBranch(b.name)}</span>
      <BranchDivergence ahead={b.ahead} behind={b.behind}/>
      <Icon name="chevron.right" size={11} color={T.text4}/>
    </div>
  );
}
function shortBranch(n) { return n.replace(/^origin\//, ''); }

// The side submenu (per-branch actions). Mirrors the source's local/remote
// action sets; destructive items in red, context-aware disabling.
function BranchSubmenu({ branch, isCurrent, isRemote, isWorktree, onClose }) {
  const sep = { sep: true };
  const items = isRemote ? [
    { icon: 'checkmark', label: 'Checkout' },
    { icon: 'branch', label: `New branch from ‘${branch}’…` },
    sep,
    { icon: 'arrow.down', label: 'Merge into current' },
    { icon: 'arrow.up', label: 'Rebase current onto this' },
    sep,
    { icon: 'trash', label: 'Delete remote branch', danger: true },
  ] : [
    { icon: 'branch', label: `New branch from ‘${branch}’…` },
    sep,
    { icon: 'checkmark', label: 'Checkout', disabled: isCurrent || isWorktree },
    { icon: 'arrow.down', label: 'Pull', disabled: isWorktree },
    { icon: 'arrow.up', label: 'Push' },
    sep,
    { icon: 'arrow.down', label: 'Merge into current', disabled: isCurrent },
    { icon: 'arrow.up', label: 'Rebase current onto this', disabled: isCurrent },
    sep,
    { icon: 'pencil', label: 'Rename…', disabled: isWorktree },
    { icon: 'trash', label: 'Delete branch', danger: true, disabled: isCurrent || isWorktree },
  ];
  return (
    <PopCard width={236} pad={4}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px 7px', borderBottom: `0.5px solid ${T.hairline}`, marginBottom: 3 }}>
        <Icon name={isRemote ? 'globe' : 'branch'} size={12} color={T.text3}/>
        <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12, fontWeight: 600, color: T.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branch}</span>
      </div>
      {items.map((it, i) => it.sep
        ? <PopDivider key={i}/>
        : <PopMenuRow key={i} icon={it.icon} label={it.label} danger={it.danger} disabled={it.disabled} onClick={() => onClose && onClose()}/>)}
    </PopCard>
  );
}

// Branch switcher — the full thing: search + fetch, global actions
// (new branch / update all / push), then the list grouped into Local,
// per-worktree sections, and Remote. Clicking any branch flies out a side
// submenu of per-branch git actions.
function BranchPopover({ inline, onNewBranch, trigger, initialQuery = '', side = 'bottom', align = 'start',
                        defaultSelected = null }) {
  const [q, setQ] = React.useState(initialQuery);
  const [selected, setSelected] = React.useState(defaultSelected);
  const [open, setOpen] = React.useState({ local: true, remote: false, wt: {} });
  const match = (b) => b.name.toLowerCase().includes(q.toLowerCase());
  const locals = BRANCH_SEED.filter(b => !b.worktree && match(b));
  const remotes = BRANCH_REMOTE.filter(match);
  const wtGroups = [...new Set(BRANCH_SEED.filter(b => b.worktree).map(b => b.worktree))]
    .map(w => ({ name: w, branches: BRANCH_SEED.filter(b => b.worktree === w && match(b)) }))
    .filter(g => g.branches.length);
  const nothing = !locals.length && !remotes.length && !wtGroups.length;
  const selMeta = selected && (BRANCH_SEED.find(b => b.name === selected) || { name: selected, remote: true });

  const main = (close) => (
    <PopCard width={300} pad={5}>
      {/* search + fetch */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '1px 2px 5px' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 9px',
          background: T.content2, borderRadius: 8, border: `0.5px solid ${T.border}` }}>
          <Icon name="magnifyingglass" size={13} color={T.text3}/>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search branches…" autoFocus={!inline}
            spellCheck={false} style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT, fontSize: 12, color: T.text, minWidth: 0 }}/>
        </div>
        <button title="Fetch from all remotes" style={{ width: 30, height: 30, borderRadius: 8, border: `0.5px solid ${T.border}`,
          background: T.content, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
          onMouseLeave={(e) => e.currentTarget.style.background = T.content}>
          <Icon name="refresh" size={13} color={T.text2}/>
        </button>
      </div>
      {/* global actions */}
      <PopMenuRow icon="plus" iconColor={ACCENT} label={q ? `Create branch “${q}”` : 'New branch…'}
        onClick={() => { onNewBranch && onNewBranch(q); close && close(); }}/>
      <PopMenuRow icon="refresh" label="Update all" hint="⤓"/>
      <PopMenuRow icon="arrow.up" label="Push"/>
      <PopDivider/>
      {/* list */}
      <div style={{ maxHeight: 244, overflowY: 'auto', margin: '0 -1px' }}>
        {nothing && <PopEmpty icon="branch">No branch matches “{q}”.</PopEmpty>}
        {!!locals.length && (
          <React.Fragment>
            <BranchSectionHead label="Local branches" expanded={open.local} onToggle={() => setOpen(o => ({ ...o, local: !o.local }))}/>
            {open.local && locals.map(b => (
              <BranchRow key={b.name} b={b} isCurrent={b.current} selected={selected === b.name} onOpen={() => setSelected(b.name)}/>
            ))}
          </React.Fragment>
        )}
        {wtGroups.map(g => (
          <React.Fragment key={g.name}>
            <BranchSectionHead icon="worktree" iconColor={T.amber} label={g.name} expanded={open.wt[g.name] !== false}
              onToggle={() => setOpen(o => ({ ...o, wt: { ...o.wt, [g.name]: o.wt[g.name] === false } }))}
              actions={<span style={{ display: 'inline-flex', gap: 1, paddingRight: 4 }}>
                <button title="New session on this worktree" style={wtActBtn} onMouseEnter={wtActHover} onMouseLeave={wtActOut}>
                  <Icon name="plus" size={11} color={T.text3}/></button>
                <button title="Delete worktree" style={wtActBtn} onMouseEnter={wtActHover} onMouseLeave={wtActOut}>
                  <Icon name="trash" size={11} color={T.text3}/></button>
              </span>}/>
            {open.wt[g.name] !== false && g.branches.map(b => (
              <BranchRow key={b.name} b={b} isCurrent={b.current} selected={selected === b.name} onOpen={() => setSelected(b.name)}/>
            ))}
          </React.Fragment>
        ))}
        {!!remotes.length && (
          <React.Fragment>
            <PopDivider/>
            <BranchSectionHead label="Remote branches" expanded={open.remote} onToggle={() => setOpen(o => ({ ...o, remote: !o.remote }))}/>
            {open.remote && remotes.map(b => (
              <BranchRow key={b.name} b={b} isCurrent={false} selected={selected === b.name} onOpen={() => setSelected(b.name)}/>
            ))}
          </React.Fragment>
        )}
      </div>
    </PopCard>
  );

  const body = (close) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      {main(close)}
      {selMeta && (
        <BranchSubmenu branch={selMeta.name} isCurrent={selMeta.current} isRemote={!!selMeta.remote}
          isWorktree={!!selMeta.worktree} onClose={() => { setSelected(null); close && close(); }}/>
      )}
    </div>
  );

  return popHost({ inline, bare: true, side, align, body,
    trigger: trigger || (({ toggle, open: o }) => (
      <button onClick={toggle} style={branchPillStyle(o)}>
        <Icon name="branch" size={11} color={T.text2}/>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500 }}>{BRANCH_CURRENT}</span>
        <Icon name="chevron.down" size={9} color={T.text3}/>
      </button>
    )) });
}
const wtActBtn = { width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const wtActHover = (e) => { e.currentTarget.style.background = T.rowHover; };
const wtActOut = (e) => { e.currentTarget.style.background = 'transparent'; };
function BranchDivergence({ ahead, behind }) {
  if (!ahead && !behind) return <span style={{ fontSize: 10, color: T.text4 }}>up to date</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: MONO, fontSize: 10, color: T.text3 }}>
      {ahead > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}><Icon name="arrow.up" size={9} color={T.green}/>{ahead}</span>}
      {behind > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}><Icon name="arrow.down" size={9} color={T.amber}/>{behind}</span>}
    </span>
  );
}
function branchPillStyle(open) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 11,
    border: `0.5px solid ${open ? ACCENT : T.border}`, background: open ? `${ACCENT}10` : T.chipBg,
    color: T.text2, cursor: 'pointer', fontFamily: FONT,
  };
}

// New-branch form-popover: name input + base select + create/cancel. The
// banner + segmented + fields + actions form-popover idiom (cf. WorktreeButton).
function NewBranchPopover({ inline, initialName = '', onClose }) {
  const [name, setName] = React.useState(initialName);
  const [base, setBase] = React.useState('feat/tech-debt-all');
  const [checkout, setCheckout] = React.useState(true);
  const body = (close) => (
    <div style={{ padding: 7 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: -0.2, padding: '2px 2px 11px' }}>New branch</div>
      <PopField label="Branch name">
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!inline} spellCheck={false}
          placeholder="feat/my-change" style={POP_INPUT}/>
      </PopField>
      <PopField label="Base branch">
        <PopSelectInput value={base} onChange={setBase}
          options={BRANCH_SEED.map(b => ({ value: b.name, label: b.name + (b.current ? '  (current)' : '') }))}/>
      </PopField>
      <div onClick={() => setCheckout(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px 12px', cursor: 'pointer' }}>
        <span style={{ width: 15, height: 15, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: checkout ? ACCENT : 'transparent', border: checkout ? 'none' : `1.5px solid ${T.border}` }}>
          {checkout && <Icon name="checkmark" size={9} color="#fff"/>}
        </span>
        <span style={{ fontSize: 12, color: T.text2 }}>Check out after creating</span>
      </div>
      <PopActions onCancel={() => { onClose && onClose(); close && close(); }} confirmLabel="Create branch" confirmIcon="checkmark"
        disabled={!name.trim()} onConfirm={() => { onClose && onClose(); close && close(); }}/>
    </div>
  );
  return popHost({ inline, width: 300, pad: 5, side: 'bottom', align: 'start', body,
    trigger: ({ toggle, open }) => (
      <button onClick={toggle} style={branchPillStyle(open)}>
        <Icon name="plus" size={11} color={T.text2}/><span style={{ fontSize: 12, fontWeight: 500 }}>New branch</span>
      </button>
    ) });
}

// ── Merge / rebase conflicts ──────────────────────────────────────────
// Shown mid-operation when a merge or rebase halts on conflicts. Built on
// PopCard + the banner idiom + a row primitive — no new surface. The card
// runs pad:0 so the danger header can bleed edge-to-edge under the rounded top.
const CONFLICTS_SEED = [
  'mainframe/13-popover.jsx',
  'mainframe/03-content.jsx',
  'src/components/Composer.tsx',
  'src/git/BranchPopover.tsx',
  'src/state/sessionStore.ts',
  'webview/src/main.tsx',
];

// One conflicted file: a red “C” status badge + the path (mono, end-truncated).
function ConflictRow({ path }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 12px', cursor: 'pointer' }}
      onMouseEnter={(e) => e.currentTarget.style.background = `${T.red}0e`}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <span style={{ width: 17, height: 17, borderRadius: 4, flexShrink: 0, background: `${T.red}1a`, color: T.red,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 10, fontWeight: 700 }}>C</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 11.5, color: T.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}>{path}</span>
    </div>
  );
}

// Conflicts popover. `op` selects the verb in the header/footnote (merge|rebase).
function ConflictsPopover({ inline, files = CONFLICTS_SEED, op = 'merge', onAbort, side = 'top', align = 'start' }) {
  const verb = op === 'rebase' ? 'rebase' : 'merge';
  const body = (close) => (
    <React.Fragment>
      {/* danger header — bleeds to the card edges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        background: `${T.red}14`, borderBottom: `0.5px solid ${T.red}26` }}>
        <Icon name="exclamationmark.triangle" size={14} color={T.red}/>
        <span style={{ flex: 1, fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: T.red, letterSpacing: -0.1 }}>Merge / Rebase Conflicts</span>
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: T.red, background: `${T.red}1a`,
          borderRadius: 999, padding: '1px 7px' }}>{files.length}</span>
      </div>
      {/* conflicted files */}
      <div style={{ maxHeight: 168, overflowY: 'auto', padding: '4px 0' }}>
        {files.map((f, i) => <ConflictRow key={i} path={f}/>)}
      </div>
      <div style={{ padding: '12px 12px 3px', borderTop: `0.5px solid ${T.hairline}`,
        fontFamily: FONT, fontSize: 10.5, color: T.text4, lineHeight: 1.5, letterSpacing: -0.05 }}>
        Ask an agent to resolve the conflicts, or use an external editor. Once resolved, stage and commit to complete the {verb}.
      </div>
      {/* abort */}
      <div style={{ padding: '7px 10px 10px' }}>
        <button onClick={() => { onAbort && onAbort(); close && close(); }} style={{ width: '100%', height: 32, borderRadius: 8, border: 'none',
          cursor: 'pointer', background: T.red, color: '#fff', fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.93)'}
          onMouseLeave={(e) => e.currentTarget.style.filter = 'none'}>
          <Icon name="xmark" size={12} color="#fff" stroke={2.4}/>Abort {verb}
        </button>
      </div>
    </React.Fragment>
  );
  return popHost({ inline, width: 292, pad: 0, side, align, body,
    trigger: ({ toggle, open }) => (
      <button onClick={toggle} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px',
        borderRadius: 11, border: `0.5px solid ${open ? T.red : `${T.red}55`}`, background: `${T.red}14`,
        color: T.red, cursor: 'pointer', fontFamily: FONT }}>
        <Icon name="exclamationmark.triangle" size={11} color={T.red}/>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{files.length} conflicts</span>
      </button>
    ) });
}

const TAG_SEED = [
  { id: 'bug', label: 'bug', color: '#dc3545' },
  { id: 'feature', label: 'feature', color: '#28a745' },
  { id: 'refactor', label: 'refactor', color: '#0a84ff' },
  { id: 'design', label: 'design', color: '#a855f7' },
  { id: 'infra', label: 'infra', color: '#d97706' },
  { id: 'docs', label: 'docs', color: '#0891b2' },
];
// Tag editor: multi-select check-rows + a create-new footer action.
function TagPopover({ inline, initial = ['design', 'refactor'], initialQuery = '' }) {
  const [q, setQ] = React.useState(initialQuery);
  const [sel, setSel] = React.useState(initial);
  const toggle = (id) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const rows = TAG_SEED.filter(t => t.label.toLowerCase().includes(q.toLowerCase()));
  const showCreate = q && !TAG_SEED.some(t => t.label.toLowerCase() === q.toLowerCase());
  const body = () => (
    <React.Fragment>
      <PopLabel>Tags</PopLabel>
      <PopSearchField value={q} onChange={setQ} placeholder="Filter or add tag…" autoFocus={!inline}/>
      <div style={{ maxHeight: 210, overflowY: 'auto' }}>
        {rows.map(t => <PopCheckRow key={t.id} checked={sel.includes(t.id)} swatch={t.color} label={t.label} onClick={() => toggle(t.id)}/>)}
        {rows.length === 0 && !showCreate && <PopEmpty icon="tag">No tags match.</PopEmpty>}
      </div>
      {showCreate && (<React.Fragment>
        <PopDivider/>
        <PopMenuRow icon="plus" iconColor={ACCENT} label={`Create tag “${q}”`} onClick={() => { setSel(s => [...s, q]); setQ(''); }}/>
      </React.Fragment>)}
    </React.Fragment>
  );
  return popHost({ inline, width: 230, side: 'bottom', align: 'start', body,
    trigger: ({ toggle, open }) => (
      <button onClick={toggle} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px',
        borderRadius: 11, border: `0.5px solid ${open ? ACCENT : T.border}`, background: open ? `${ACCENT}10` : T.chipBg,
        color: T.text2, cursor: 'pointer', fontFamily: FONT }}>
        <Icon name="tag" size={11} color={T.text2}/><span style={{ fontSize: 12, fontWeight: 500 }}>Tags</span>
      </button>
    ) });
}

// Generic right-click context menu: action rows, dividers, destructive items.
function ContextMenu({ inline, items, width = 200 }) {
  const ITEMS = items || [
    { icon: 'pencil', label: 'Rename', hint: '↵' },
    { icon: 'copy', label: 'Duplicate', hint: '⌘D' },
    { icon: 'branch', label: 'Open in worktree' },
    { divider: true },
    { icon: 'pin', label: 'Pin session' },
    { icon: 'archive', label: 'Archive' },
    { divider: true },
    { icon: 'trash', label: 'Delete', hint: '⌫', danger: true },
  ];
  const body = (close) => ITEMS.map((it, i) => it.divider
    ? <PopDivider key={i}/>
    : <PopMenuRow key={i} icon={it.icon} label={it.label} hint={it.hint} danger={it.danger} onClick={() => close && close()}/>);
  return popHost({ inline, width, pad: 4, side: 'bottom', align: 'start', body,
    trigger: ({ toggle, open }) => (
      <button onClick={toggle} style={{ width: 26, height: 22, borderRadius: 6, border: `0.5px solid ${open ? ACCENT : T.border}`,
        background: open ? `${ACCENT}10` : T.chipBg, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="ellipsis" size={14} color={T.text2}/>
      </button>
    ) });
}

Object.assign(window, {
  PopCard, Popover, PopLabel, PopDivider, PopFootNote, PopSearchField,
  PopMenuRow, PopSelectRow, PopCheckRow, PopEmpty, PopField, PopSelectInput, PopActions,
  POP_SHADOW, POP_INPUT,
  BranchPopover, NewBranchPopover, TagPopover, ContextMenu, ConflictsPopover,
  BranchRow, BranchSubmenu, BranchSectionHead,
  BRANCH_SEED, BRANCH_REMOTE, BRANCH_CURRENT, TAG_SEED, BranchDivergence,
});
