// ════════════════════════════════════════════════════════════════
// Mainframe prototype — User-turn system (redesigned, not a copy)
// A considered visual language for everything a user turn can carry.
// Functionality mirrors the source; the design is fresh:
//   · text turns as calm cool-ink cards (no candy bubble / tail)
//   · /command · /skill as leading token tags
//   · "Plan" card with numbered step pills
//   · queued as a quiet animated footer
//   · attachments as rich type-colored file pills + image tiles
//   · sandbox context as "pinned" capture cards carrying a CSS path
// Warm-chrome tokens; exported to window for the review canvas. After 10.
// ════════════════════════════════════════════════════════════════

const UINK = T.umInk;
const UCARD = T.umCard;
const UEDGE = T.umEdge;

// Right-aligned turn column.
function UMRow({ children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }}>{children}</div>;
}

function umMentions(text) {
  return String(text).split(/(@[\w./-]+)/g).map((p, i) => p.startsWith('@')
    ? <span key={i} style={{ color: ACCENT, fontWeight: 600 }}>{p}</span>
    : <React.Fragment key={i}>{p}</React.Fragment>);
}

// Base text turn — a cool card (no decorative spine).
function UMBubble({ children, maxWidth = 470 }) {
  return (
    <div style={{ position: 'relative', maxWidth, background: UCARD, border: `0.5px solid ${UEDGE}`, borderRadius: 13, padding: '10px 15px', fontFamily: FONT, fontSize: 13, color: UINK, lineHeight: 1.58, letterSpacing: -0.1, boxShadow: '0 1px 2px rgba(30,50,120,0.05)' }}>
      {children}
    </div>
  );
}

// Canonical text turn (used by the live transcript AND the review canvas):
// the redesigned bubble + Read more / Show less clamp for long messages.
function UMTextTurn({ children, clampLines = 4, maxWidth = 470 }) {
  const [expanded, setExpanded] = React.useState(false);
  const [clamped, setClamped] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => { const el = ref.current; if (el) setClamped(el.scrollHeight - el.clientHeight > 2); }, []);
  const clampStyle = expanded ? {} : { display: '-webkit-box', WebkitLineClamp: clampLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
        <div style={{ position: 'relative', overflow: 'hidden', maxWidth, background: UCARD, border: `0.5px solid ${UEDGE}`, borderRadius: 13, padding: '10px 15px', boxShadow: '0 1px 2px rgba(30,50,120,0.05)' }}>
          <div ref={ref} style={{ fontFamily: FONT, fontSize: 13, color: UINK, lineHeight: 1.58, letterSpacing: -0.1, ...clampStyle }}>{children}</div>
          {clamped && !expanded && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, pointerEvents: 'none', background: `linear-gradient(to bottom, transparent, ${T.umFade})` }}/>
          )}
        </div>
        {clamped && (
          <button onClick={() => setExpanded(e => !e)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 2px', fontFamily: FONT, fontSize: 11, fontWeight: 600, color: ACCENT, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}>
            {expanded ? 'Show less' : 'Read more'}
            <Icon name={expanded ? 'chevron.up.down' : 'chevron.down'} size={10} color={ACCENT}/>
          </button>
        )}
      </div>
    </div>
  );
}

// /command (wrench) or /skill (zap) — a leading token tag on its own line.
function UMSlashBubble({ kind = 'command', name, children }) {
  const c = kind === 'command' ? ACCENT : '#7a4dd0';
  return (
    <UMBubble>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, verticalAlign: '1px', padding: '2px 8px 2px 6px', borderRadius: 8, background: `${c}14`, marginRight: 8 }}>
        <Icon name={kind === 'command' ? 'wrench' : 'bolt'} size={12} color={c}/>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: c }}>/{name}</span>
      </span>
      {children}
    </UMBubble>
  );
}

// "Plan" turn — the FIRST message of a new session that implements an
// already-approved plan (not the interactive approval card). Body is
// free-form Markdown (prose, lists, code), rendered via window.MD.
function UMPlanBubble({ md, children }) {
  return (
    <div style={{ maxWidth: 530, background: UCARD, border: `0.5px solid ${UEDGE}`, borderRadius: 13, overflow: 'hidden', boxShadow: '0 1px 2px rgba(30,50,120,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 9px' }}>
        <span style={{ width: 20, height: 20, borderRadius: 6, background: `${T.green}1c`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="checklist.box" size={12} color={T.green}/></span>
        <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: UINK, letterSpacing: -0.1 }}>Implementing plan</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT, fontSize: 10, fontWeight: 600, color: T.green, background: `${T.green}14`, padding: '2px 8px', borderRadius: 20 }}><Icon name="checkmark" size={10} color={T.green} stroke={2.4}/>Approved</span>
      </div>
      <div style={{ borderTop: `0.5px solid ${UEDGE}`, padding: '4px 16px 12px', color: UINK }}>
        {md && window.MD ? <window.MD text={md} size={13}/> : children}
      </div>
    </div>
  );
}

// Queued — a quiet animated footer line (sits under the turn).
function UMQueuedBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 10, color: T.text3, letterSpacing: -0.1, marginRight: 2 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', border: `1.5px solid ${T.amber}`, borderTopColor: 'transparent', display: 'inline-block', animation: 'tw-spin 1.1s linear infinite' }}/>
      Queued · sends after the current run
    </span>
  );
}

// ── Attachments — rich type-colored pills + image tiles ────────────
const UM_FILE = {
  tsx: { c: '#2f74c0', l: 'TypeScript' }, ts: { c: '#2f74c0', l: 'TypeScript' },
  js:  { c: '#c79a16', l: 'JavaScript' }, json: { c: '#c2851a', l: 'JSON' },
  log: { c: '#7a7a82', l: 'Log file' },   md: { c: '#6b5bd0', l: 'Markdown' },
  css: { c: '#2f9d8a', l: 'Stylesheet' }, png: { c: '#1f9d6b', l: 'Image' },
};
function umFileMeta(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return { ext, ...(UM_FILE[ext] || { c: '#7a7a82', l: 'File' }) };
}

function UMThumbRow({ children }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 470, justifyContent: 'flex-end' }}>{children}</div>;
}

function UMFileThumb({ name, size = '4.2 KB' }) {
  const m = umFileMeta(name);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '6px 12px 6px 6px', borderRadius: 11, background: T.content, border: `0.5px solid ${T.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <span style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: `${m.c}16`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: m.c }}>.{m.ext}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: UINK, letterSpacing: -0.1, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontFamily: FONT, fontSize: 10, color: T.text3 }}>{m.l} · {size}</span>
      </span>
    </div>
  );
}

function UMImageThumb({ hue = 210 }) {
  return (
    <div style={{ width: 64, height: 64, borderRadius: 11, overflow: 'hidden', border: `0.5px solid ${T.border}`, background: `linear-gradient(135deg, hsl(${hue} 58% 80%), hsl(${(hue + 45) % 360} 52% 60%))`, position: 'relative', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}>
      <div style={{ position: 'absolute', left: 9, bottom: 8, width: 20, height: 13, borderRadius: 4, background: 'rgba(255,255,255,0.55)' }}/>
      <div style={{ position: 'absolute', right: 10, top: 10, width: 11, height: 11, borderRadius: '50%', background: 'rgba(255,255,255,0.72)' }}/>
    </div>
  );
}

// ── Sandbox context — compact chips with a small preview ───────────
const UM_CTX = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 9px 4px 4px', borderRadius: 8, background: T.content2, border: `0.5px solid ${T.border}`, fontFamily: FONT, fontSize: 11, color: T.text2, maxWidth: 250 };
function UMCtxRemove() {
  return <span style={{ display: 'inline-flex', marginLeft: 1, opacity: 0.55 }}><Icon name="xmark" size={10} color={T.text3}/></span>;
}

// 40px screenshot preview.
function UMScreenshotMini() {
  return (
    <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 6, overflow: 'hidden', border: `0.5px solid ${T.border}`, background: '#fff' }}>
      <div style={{ height: 8, background: T.content2, display: 'flex', alignItems: 'center', gap: 1.5, padding: '0 3px' }}>
        {[0, 1, 2].map(i => <span key={i} style={{ width: 2, height: 2, borderRadius: '50%', background: T.text4 }}/>)}
      </div>
      <div style={{ padding: '3px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ height: 3, borderRadius: 1, background: 'hsl(210 60% 80%)', width: '60%' }}/>
        <div style={{ height: 3, borderRadius: 1, background: T.raised, width: '100%' }}/>
        <div style={{ height: 3, borderRadius: 1, background: T.raised, width: '80%' }}/>
      </div>
    </div>
  );
}

// Screenshot chip — small preview + label.
function UMCaptureScreenshot() {
  return (
    <span style={UM_CTX}>
      <UMScreenshotMini/>
      <span style={{ fontWeight: 500 }}>Screenshot</span>
      <UMCtxRemove/>
    </span>
  );
}

// Inspected-element chip — 40px element preview + CSS selector path.
function UMInspectChip({ selector = 'nav.sidebar > .rail-icon', hue = 150 }) {
  return (
    <span style={UM_CTX}>
      <span style={{ position: 'relative', width: 40, height: 40, flexShrink: 0, borderRadius: 6, overflow: 'hidden', border: `0.5px solid ${T.border}`, background: `linear-gradient(135deg, hsl(${hue} 45% 86%), hsl(${hue} 40% 72%))` }}>
        <span style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 0 1.5px ${ACCENT}`, borderRadius: 6 }}/>
        <span style={{ position: 'absolute', left: -2, top: -2, width: 6, height: 6, borderRadius: '50%', background: ACCENT, border: '1.5px solid #fff' }}/>
      </span>
      <code style={{ fontFamily: MONO, fontSize: 11, color: '#326d74', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selector}</code>
      <UMCtxRemove/>
    </span>
  );
}

// Small file/image chip for the composer context row — matches the file
// design language: ext-tile for files, a thumbnail for images.
function UMFileChip({ name, hue = 25 }) {
  const m = umFileMeta(name);
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(m.ext);
  return (
    <span style={{ ...UM_CTX, paddingLeft: 4 }}>
      {isImg
        ? <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 6, overflow: 'hidden', border: `0.5px solid ${T.border}`, background: `linear-gradient(135deg, hsl(${hue} 58% 80%), hsl(${(hue + 45) % 360} 52% 60%))` }}/>
        : <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 6, background: `${m.c}16`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: m.c }}>.{m.ext}</span></span>}
      <span style={{ fontWeight: 500 }}>{name}</span>
      <UMCtxRemove/>
    </span>
  );
}

// Faux composer shell. `value` shows real typed prompt text (dark, dominant);
// otherwise the muted placeholder.
function UMComposer({ children, placeholder = 'Reply to Mainframe…', value }) {
  const mini = { width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  return (
    <div style={{ borderRadius: 13, background: T.content, border: `0.5px solid ${T.borderH}`, boxShadow: `0 1px 0 ${T.hairline}, 0 8px 22px rgba(0,0,0,0.05)`, width: '100%' }}>
      {children && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '9px 13px 0' }}>{children}</div>}
      <div style={{ padding: '10px 15px 6px' }}>
        <div style={{ fontFamily: FONT, fontSize: 13, lineHeight: 1.5, letterSpacing: -0.1, color: value ? UINK : T.text3 }}>{value || placeholder}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px 9px 11px' }}>
        <span style={mini}><Icon name="paperclip" size={12} color={T.text2}/></span>
        <span style={mini}><Icon name="at" size={12} color={T.text2}/></span>
        <div style={{ flex: 1 }}/>
        <span style={{ width: 24, height: 24, borderRadius: 8, background: ACCENT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow.up" size={12} color="#fff" stroke={2.2}/></span>
      </div>
    </div>
  );
}

// Right-aligned context row for a SENT message (echoes composer context).
function UMContextRow({ children }) {
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 470, justifyContent: 'flex-end' }}>{children}</div>;
}

// Code-reference turn — review sent from the file editor: file + line range
// header, then the referenced snippet. `lines: [{ n, t }]` (t = string|node).
// Big snippets clamp to `collapsedLines` with a fade + "Show all N lines"
// expander (scrollable when expanded).
function UMCodeRef({ file = 'Layout.tsx', range = 'L42–48', lines = [], collapsedLines = 7 }) {
  const big = lines.length > collapsedLines;
  const [expanded, setExpanded] = React.useState(false);
  const shown = (!big || expanded) ? lines : lines.slice(0, collapsedLines);
  return (
    <div style={{ maxWidth: 480, borderRadius: 11, overflow: 'hidden', border: `0.5px solid ${T.border}`, background: T.codeBg, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', background: T.content2, borderBottom: `0.5px solid ${T.border}` }}>
        <Icon name="code" size={12} color={ACCENT}/>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: T.text2 }}>{file}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4 }}>{range}</span>
        <div style={{ flex: 1 }}/>
        <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4 }}>{lines.length} lines</span>
        <Icon name="quote" size={11} color={T.text4}/>
      </div>
      <div style={{ position: 'relative' }}>
        <div style={{ padding: '7px 0', fontFamily: MONO, fontSize: 11, lineHeight: '18px', maxHeight: expanded ? 240 : 'none', overflowY: expanded ? 'auto' : 'visible' }}>
          {shown.map((l, i) => (
            <div key={i} style={{ display: 'flex', minHeight: 18 }}>
              <span style={{ width: 40, flexShrink: 0, textAlign: 'right', paddingRight: 12, color: T.text4, fontSize: 10, userSelect: 'none' }}>{l.n}</span>
              <span style={{ flex: 1, whiteSpace: 'pre', paddingRight: 12, color: T.codeFg }}>{l.t}</span>
            </div>
          ))}
        </div>
        {big && !expanded && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, pointerEvents: 'none', background: `linear-gradient(to bottom, rgba(251,250,247,0), ${T.codeBg})` }}/>
        )}
      </div>
      {big && (
        <button onClick={() => setExpanded(e => !e)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, width: '100%',
          padding: '7px 0', border: 'none', borderTop: `0.5px solid ${T.border}`, cursor: 'pointer',
          background: T.content2, fontFamily: FONT, fontSize: 11, fontWeight: 600, color: ACCENT,
        }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.raised}
          onMouseLeave={(e) => e.currentTarget.style.background = T.content2}>
          {expanded ? 'Collapse' : `Show all ${lines.length} lines`}
          <Icon name={expanded ? 'chevron.up.down' : 'chevron.down'} size={10} color={ACCENT}/>
        </button>
      )}
    </div>
  );
}

Object.assign(window, {
  UMRow, UMBubble, UMTextTurn, UMSlashBubble, UMPlanBubble, UMQueuedBadge,
  UMThumbRow, UMFileThumb, UMImageThumb,
  UMCaptureScreenshot, UMInspectChip, UMFileChip, UMComposer, umMentions,
  UMContextRow, UMCodeRef,
});
