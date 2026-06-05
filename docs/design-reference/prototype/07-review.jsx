// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Review Changes (full-screen)
// PR-style review surface reached via ⌘⇧R or the palette. Left: changed-file
// list with status + stat bars. Right: stacked hunks with split gutters,
// per-file viewed checkbox, and a commit composer. Loaded after 04-engine.
// ════════════════════════════════════════════════════════════════

// Lightweight TS/TSX tokenizer for diff bodies — returns colored spans.
const RV_KW = /\b(import|from|export|const|let|return|function|if|else|interface|type|new|await|async|useState|useEffect|useMemo|useCallback|true|false|null)\b/;
function rvTokens(src) {
  if (!src) return [<span key="e">{'\u00A0'}</span>];
  const out = []; let i = 0, key = 0;
  const re = /(\/\/[^\n]*)|(["'`])(?:\\.|(?!\2).)*\2|(\b\d[\d.]*\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(src))) {
    let color = T.codeFg, txt = m[0];
    if (m[1]) color = T.codeCmt;
    else if (m[2]) color = T.codeStr;
    else if (m[3]) color = T.codeNum;
    else if (m[4]) {
      if (RV_KW.test(txt)) color = T.codeKw;
      else if (/^[A-Z]/.test(txt)) color = T.codeType;
      else if (src[re.lastIndex] === '(') color = T.codeFn;
    } else if (m[6]) color = T.text2;
    out.push(<span key={key++} style={{ color }}>{txt}</span>);
  }
  return out;
}

// Changed file set with real-ish hunks. k: context|add|del
const RV_FILES = [
  {
    f: 'Layout.tsx', dir: 'src/renderer/components', s: 'M', add: 18, del: 7,
    hunks: [
      { head: '@@ -14,9 +14,12 @@ export function Layout()', lines: [
        { o: 14, n: 14, k: 'context', t: "  const sidebar = useLayoutStore((s) => s.sidebar);" },
        { o: 15, n: 15, k: 'context', t: "  const rail = useZoneHeaderTabs();" },
        { o: 16, k: 'del', t: "  return (" },
        { o: 17, k: 'del', t: "    <div className=\"layout\">" },
        { n: 16, k: 'add', t: "  const collapsed = sidebar.mode === 'rail';" },
        { n: 17, k: 'add', t: "  return (" },
        { n: 18, k: 'add', t: "    <div className={cx('layout', collapsed && 'is-rail')}>" },
        { o: 18, n: 19, k: 'context', t: "      <Sidebar />" },
        { o: 19, n: 20, k: 'context', t: "      <WorkspaceArea />" },
        { o: 20, k: 'del', t: "      <Inspector />" },
        { n: 21, k: 'add', t: "      <Inspector collapsible />" },
        { o: 21, n: 22, k: 'context', t: "    </div>" },
      ] },
    ],
  },
  {
    f: 'Sidebar.tsx', dir: 'src/renderer/components', s: 'M', add: 42, del: 11,
    hunks: [
      { head: '@@ -3,6 +3,9 @@', lines: [
        { o: 3, n: 3, k: 'context', t: "import { useLayoutStore } from '../store/layout';" },
        { n: 4, k: 'add', t: "import { RailIcons } from './RailIcons';" },
        { n: 5, k: 'add', t: "import { useZoneHeaderTabs } from './zone';" },
        { o: 4, n: 6, k: 'context', t: "" },
        { o: 5, n: 7, k: 'context', t: "export function Sidebar() {" },
      ] },
      { head: '@@ -28,7 +31,18 @@ export function Sidebar()', lines: [
        { o: 28, n: 31, k: 'context', t: "  if (collapsed) {" },
        { o: 29, k: 'del', t: "    return null;" },
        { n: 32, k: 'add', t: "    return (" },
        { n: 33, k: 'add', t: "      <nav className=\"rail\" aria-label=\"Sidebar rail\">" },
        { n: 34, k: 'add', t: "        <RailIcons sections={sections} active={active} />" },
        { n: 35, k: 'add', t: "      </nav>" },
        { n: 36, k: 'add', t: "    );" },
        { o: 30, n: 37, k: 'context', t: "  }" },
      ] },
    ],
  },
  {
    f: 'theme.ts', dir: 'src/renderer/store', s: 'M', add: 6, del: 2,
    hunks: [
      { head: '@@ -6,4 +6,8 @@ export const THEMES', lines: [
        { o: 6, n: 6, k: 'context', t: "export const THEMES = [" },
        { o: 7, k: 'del', t: "  { id: 'dark-claude', label: 'Dark Claude' }," },
        { n: 7, k: 'add', t: "  { id: 'claude',   label: 'Claude',   accent: 'oklch(0.66 0.17 44)' }," },
        { n: 8, k: 'add', t: "  { id: 'codex',    label: 'Codex',    accent: 'oklch(0.64 0.15 163)' }," },
        { o: 8, n: 9, k: 'context', t: "];" },
      ] },
    ],
  },
  {
    f: 'RailIcons.tsx', dir: 'src/renderer/components', s: 'A', add: 33, del: 0,
    hunks: [
      { head: '@@ -0,0 +1,12 @@', lines: [
        { n: 1, k: 'add', t: "import React from 'react';" },
        { n: 2, k: 'add', t: "" },
        { n: 3, k: 'add', t: "export function RailIcons({ sections, active }) {" },
        { n: 4, k: 'add', t: "  return sections.map((s) => (" },
        { n: 5, k: 'add', t: "    <button key={s.id} className={cx('rail-icon', active === s.id && 'on')}>" },
        { n: 6, k: 'add', t: "      <Icon name={s.icon} />" },
        { n: 7, k: 'add', t: "    </button>" },
        { n: 8, k: 'add', t: "  ));" },
        { n: 9, k: 'add', t: "}" },
      ] },
    ],
  },
  {
    f: 'old-dock.ts', dir: 'src/renderer/legacy', s: 'D', add: 0, del: 96,
    hunks: [
      { head: '@@ -1,8 +0,0 @@', lines: [
        { o: 1, k: 'del', t: "// Legacy dock manager — superseded by zone tabs" },
        { o: 2, k: 'del', t: "export class DockManager {" },
        { o: 3, k: 'del', t: "  private panels = new Map();" },
        { o: 4, k: 'del', t: "  register(panel) { this.panels.set(panel.id, panel); }" },
        { o: 5, k: 'del', t: "}" },
      ] },
    ],
  },
];

const RV_STATUS = { M: { c: '#d97706', label: 'Modified' }, A: { c: '#28a745', label: 'Added' }, D: { c: '#dc3545', label: 'Deleted' } };

// Stacked bar of +/- proportion (GitHub-style 5-square meter).
function RvStat({ add, del }) {
  const total = add + del || 1;
  const sq = Array.from({ length: 5 }, (_, i) => {
    const frac = (i + 1) / 5;
    if (frac <= add / total) return T.green;
    if (frac <= (add + del) / total + 0.0001 && add / total < frac) return T.red;
    return T.chipBg;
  });
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {sq.map((c, i) => <span key={i} style={{ width: 7, height: 7, borderRadius: 2, background: c }}/>)}
    </span>
  );
}

function RvHunk({ hunk }) {
  return (
    <div style={{ borderTop: `0.5px solid ${T.hairline}` }}>
      <div style={{
        padding: '4px 14px', background: `${ACCENT}0c`, color: T.codeFn,
        fontFamily: MONO, fontSize: 11, letterSpacing: -0.1, userSelect: 'none',
      }}>{hunk.head}</div>
      <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: '19px' }}>
        {hunk.lines.map((l, i) => {
          const sign = l.k === 'add' ? '+' : l.k === 'del' ? '−' : '\u00A0';
          const bg = l.k === 'add' ? 'rgba(40,167,69,0.10)' : l.k === 'del' ? 'rgba(220,53,69,0.09)' : 'transparent';
          const signCol = l.k === 'add' ? T.green : l.k === 'del' ? T.red : 'transparent';
          return (
            <div key={i} style={{ display: 'flex', background: bg, minHeight: 19 }}>
              <span style={{ width: 38, flexShrink: 0, textAlign: 'right', paddingRight: 8, color: T.text4, fontSize: 10, userSelect: 'none' }}>{l.o ?? ''}</span>
              <span style={{ width: 38, flexShrink: 0, textAlign: 'right', paddingRight: 8, color: T.text4, fontSize: 10, userSelect: 'none' }}>{l.n ?? ''}</span>
              <span style={{ width: 16, flexShrink: 0, textAlign: 'center', color: signCol, fontWeight: 700, userSelect: 'none' }}>{sign}</span>
              <span style={{ flex: 1, whiteSpace: 'pre', paddingRight: 14, overflowX: 'hidden' }}>{rvTokens(l.t)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewModal({ open, onClose, onOpenInWorkspace }) {
  const [sel, setSel] = React.useState(RV_FILES[0].f);
  const [viewed, setViewed] = React.useState({});
  const [committed, setCommitted] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const scrollRef = React.useRef(null);

  React.useEffect(() => { if (open) { setSel(RV_FILES[0].f); setViewed({}); setCommitted(false); setMsg(''); } }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  const file = RV_FILES.find(f => f.f === sel) || RV_FILES[0];
  const totals = RV_FILES.reduce((a, f) => ({ add: a.add + f.add, del: a.del + f.del }), { add: 0, del: 0 });
  const viewedCount = Object.values(viewed).filter(Boolean).length;
  const allViewed = viewedCount === RV_FILES.length;

  const goFile = (f) => { setSel(f); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const toggleViewed = (f) => setViewed(v => ({ ...v, [f]: !v[f] }));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 4300, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,19,15,0.45)', backdropFilter: 'blur(3px)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '88%', height: '86%', maxWidth: 1180, maxHeight: 880, display: 'flex', flexDirection: 'column', background: T.windowBg, borderRadius: 13, overflow: 'hidden', boxShadow: T.shadow }}>
      {/* Header */}
      <div style={{
        height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px',
        borderBottom: `0.5px solid ${T.hairline}`, background: T.content,
      }}>
        <button onClick={onClose} title="Close review (Esc)" style={{
          width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon name="xmark" size={15} color={T.text2}/>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Icon name="diff" size={16} color={ACCENT}/>
          <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>Review Changes</span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 8, background: T.chipBg }}>
          <Icon name="branch" size={11} color={T.text3}/>
          <span style={{ fontFamily: MONO, fontSize: 11, color: T.text2 }}>feat/rail-collapse</span>
        </span>
        <div style={{ flex: 1 }}/>
        <span style={{ fontFamily: FONT, fontSize: 12, color: T.text3 }}>
          {RV_FILES.length} files · <span style={{ color: T.green, fontWeight: 600 }}>+{totals.add}</span> <span style={{ color: T.red, fontWeight: 600 }}>−{totals.del}</span>
        </span>
        <span style={{ fontFamily: FONT, fontSize: 12, color: allViewed ? T.green : T.text3, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {allViewed && <Icon name="checkmark" size={12} color={T.green} stroke={2.4}/>}
          {viewedCount}/{RV_FILES.length} viewed
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* File list */}
        <div style={{ width: 264, flexShrink: 0, background: T.content2, borderRight: `0.5px solid ${T.hairline}`, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px 6px', fontFamily: FONT, fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>Changed files</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
            {RV_FILES.map(f => {
              const st = RV_STATUS[f.s]; const active = f.f === sel; const isViewed = viewed[f.f];
              return (
                <button key={f.f} onClick={() => goFile(f.f)} style={{
                  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 8,
                  border: 'none', cursor: 'pointer', marginBottom: 1,
                  background: active ? `${ACCENT}16` : 'transparent', opacity: isViewed && !active ? 0.55 : 1,
                }} onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = T.rowHover; }}
                   onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ width: 16, height: 16, flexShrink: 0, borderRadius: 4, background: `${st.c}1f`, color: st.c, fontFamily: FONT, fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{f.s}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: active ? 600 : 500, color: T.text, letterSpacing: -0.1, textDecoration: isViewed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.f}</div>
                    <div style={{ fontFamily: FONT, fontSize: 10, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.dir}</div>
                  </div>
                  <RvStat add={f.add} del={f.del}/>
                </button>
              );
            })}
          </div>
        </div>

        {/* Diff viewer */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: T.content }}>
          {/* File toolbar */}
          <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderBottom: `0.5px solid ${T.hairline}`, background: T.content2 }}>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: T.text }}>{file.f}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: T.text4 }}>{file.dir}/</span>
            <span style={{ fontFamily: MONO, fontSize: 11, display: 'inline-flex', gap: 7 }}>
              <span style={{ color: T.green, fontWeight: 600 }}>+{file.add}</span>
              <span style={{ color: T.red, fontWeight: 600 }}>−{file.del}</span>
            </span>
            <div style={{ flex: 1 }}/>
            <button onClick={() => onOpenInWorkspace(file.f)} style={{
              height: 26, padding: '0 10px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.content, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: 11, fontWeight: 600, color: T.text2,
            }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = T.content}>
              <Icon name="pop" size={12} color={T.text2}/>Open in workspace
            </button>
            <label onClick={() => toggleViewed(file.f)} style={{
              height: 26, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: viewed[file.f] ? `${T.green}16` : T.content, border: `1px solid ${viewed[file.f] ? `${T.green}55` : T.border}`,
            }}>
              <span style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${viewed[file.f] ? T.green : T.text4}`, background: viewed[file.f] ? T.green : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {viewed[file.f] && <Icon name="checkmark" size={10} color="#fff" stroke={2.6}/>}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: viewed[file.f] ? T.green : T.text2 }}>Viewed</span>
            </label>
          </div>

          {/* Hunks */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
            {file.hunks.map((h, i) => <RvHunk key={i} hunk={h}/>)}
            <div style={{ height: 20 }}/>
          </div>
        </div>

        {/* Commit rail */}
        <div style={{ width: 280, flexShrink: 0, background: T.content2, borderLeft: `0.5px solid ${T.hairline}`, display: 'flex', flexDirection: 'column', padding: 16 }}>
          <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: -0.2, marginBottom: 12 }}>Commit</div>
          {committed ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, textAlign: 'center', gap: 10 }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: `${T.green}1a`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="checkmark" size={22} color={T.green} stroke={2.4}/>
              </span>
              <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: T.text }}>Changes committed</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: T.text3 }}>{RV_FILES.length} files · {totals.add + totals.del} lines</div>
              <button onClick={onClose} style={{ marginTop: 6, height: 30, padding: '0 14px', borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>Done</button>
            </div>
          ) : (
            <React.Fragment>
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Summary of changes…" spellCheck={false} style={{
                height: 76, resize: 'none', padding: '9px 11px', borderRadius: 8, border: `1px solid ${T.border}`, outline: 'none',
                background: T.content, color: T.text, fontFamily: FONT, fontSize: 12, lineHeight: 1.45, letterSpacing: -0.05, marginBottom: 8,
              }}/>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {['feat: collapsible rail', 'refactor: zone tabs', 'chore: drop legacy dock'].map(s => (
                  <button key={s} onClick={() => setMsg(s)} style={{
                    padding: '4px 9px', borderRadius: 13, border: `1px solid ${T.border}`, background: T.content, cursor: 'pointer',
                    fontFamily: FONT, fontSize: 10, color: T.text2, letterSpacing: -0.05,
                  }} onMouseEnter={(e) => e.currentTarget.style.borderColor = ACCENT} onMouseLeave={(e) => e.currentTarget.style.borderColor = T.border}>{s}</button>
                ))}
              </div>

              {!allViewed && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 10px', borderRadius: 8, background: `${T.amber}12`, border: `1px solid ${T.amber}30`, marginBottom: 12 }}>
                  <Icon name="exclamationmark.triangle" size={13} color={T.amber}/>
                  <span style={{ fontFamily: FONT, fontSize: 11, color: T.amber, lineHeight: 1.4 }}>{RV_FILES.length - viewedCount} file{RV_FILES.length - viewedCount > 1 ? 's' : ''} not yet reviewed.</span>
                </div>
              )}

              <div style={{ flex: 1 }}/>
              <button disabled={!msg.trim()} onClick={() => setCommitted(true)} style={{
                height: 36, borderRadius: 8, border: 'none', cursor: msg.trim() ? 'pointer' : 'default',
                background: msg.trim() ? ACCENT : T.chipBg, color: msg.trim() ? '#fff' : T.text3,
                fontFamily: FONT, fontSize: 13, fontWeight: 700, letterSpacing: -0.1,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                boxShadow: msg.trim() ? `0 1px 3px ${ACCENT}66` : 'none', marginBottom: 8,
              }}>
                <Icon name="checkmark" size={14} color={msg.trim() ? '#fff' : T.text3} stroke={2.4}/>
                Commit {RV_FILES.length} files
              </button>
              <button onClick={onClose} style={{ height: 30, borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: T.text2 }}>Cancel</button>
            </React.Fragment>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

window.ReviewModal = ReviewModal;
