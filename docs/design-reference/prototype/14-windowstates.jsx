// ════════════════════════════════════════════════════════════════════
// MODULE 14 — WINDOW-LEVEL STATES (warm-chrome redesigns)
// Toaster · ConnectionOverlay · TutorialOverlay · ErrorState/Boundary
// Source specs: components/{Toaster,ConnectionOverlay,TutorialOverlay,
// ErrorBoundary}.tsx — REBUILT for warm-chrome, not transcribed.
//   • Toaster      → window.MfToaster + window.mfToast({type,title,description})
//   • Connection   → window.ConnectionOverlay   (embedded | portal)
//   • Tutorial     → window.TutorialOverlay      (run | embedded coachmark tour)
//   • Error        → window.MfErrorBoundary (real class) + window.ErrorState (fallback)
// ════════════════════════════════════════════════════════════════════

// ── shared status palette ────────────────────────────────────────────
const WS_STATUS = {
  success: { ink: T.green, tint: 'rgba(40,167,69,0.10)',  icon: 'checkmark' },
  error:   { ink: T.red,   tint: 'rgba(220,53,69,0.10)',  icon: 'exclamationmark.triangle' },
  warning: { ink: T.amber, tint: 'rgba(217,119,6,0.12)',  icon: 'exclamationmark.triangle' },
  info:    { ink: ACCENT,  tint: 'rgba(10,132,255,0.10)', icon: 'info' },
};

// tiny inline info glyph (not in the base Icon set)
function WsInfoGlyph({ size = 13, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke={color}
         strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="6.5"/><path d="M9 8.2v4"/><circle cx="9" cy="5.8" r="0.5" fill={color}/>
    </svg>
  );
}
function WsStatusIcon({ type, size = 13, color }) {
  if (type === 'info') return <WsInfoGlyph size={size} color={color}/>;
  return <Icon name={WS_STATUS[type].icon} size={size} color={color}/>;
}

// ════════════════════════════════════════════════════════════════════
// TOASTER — bottom-right stack. Event-bus driven so any code can fire one
// via window.mfToast(...). Auto-dismiss (4s) with a thin countdown rail;
// errors persist until dismissed. Warm white cards, tinted status chip.
// ════════════════════════════════════════════════════════════════════
const WS_TOAST_MS = 4200;
let _wsToastSeq = 0;

window.mfToast = function (arg, b, c) {
  // mfToast('success','Title','desc')  OR  mfToast({type,title,description,chatId})
  const t = typeof arg === 'string' ? { type: arg, title: b, description: c } : (arg || {});
  window.dispatchEvent(new CustomEvent('mf:toast', { detail: {
    id: 'ts' + (++_wsToastSeq), type: t.type || 'info', title: t.title || '', description: t.description, chatId: t.chatId,
  } }));
};

function WsToast({ toast, onDismiss, noAuto = false }) {
  const st = WS_STATUS[toast.type] || WS_STATUS.info;
  const auto = toast.type !== 'error' && !noAuto;
  const [hover, setHover] = React.useState(false);
  // Entrance via post-mount transition (NOT a keyframe class): a CSS animation on
  // a node portaled to <body> can stay 'pending' and hold its from-state opacity:0
  // forever. Base state is visible (inline opacity:1); we slide in after mount.
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
  React.useEffect(() => {
    if (!auto || hover) return;
    const t = setTimeout(() => onDismiss(toast.id), WS_TOAST_MS);
    return () => clearTimeout(t);
  }, [auto, hover, toast.id, onDismiss]);
  return (
    <div role="alert"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', width: 332, display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '11px 12px 12px', borderRadius: 11, background: T.content,
        border: `0.5px solid ${T.borderH}`,
        boxShadow: '0 10px 30px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.03)',
        cursor: toast.chatId ? 'pointer' : 'default', overflow: 'hidden',
        opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(6px)',
        transition: 'opacity 0.24s ease, transform 0.24s cubic-bezier(0.22,1,0.36,1)',
      }}>
      <span style={{
        width: 24, height: 24, flexShrink: 0, borderRadius: 8, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', background: st.tint, color: st.ink, marginTop: 1,
      }}>
        <WsStatusIcon type={toast.type} size={14} color={st.ink}/>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: -0.1 }}>{toast.title}</div>
        {toast.description && (
          <div style={{ fontFamily: FONT, fontSize: 12, lineHeight: 1.45, color: T.text2, marginTop: 3, maxHeight: 88, overflow: 'auto', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{toast.description}</div>
        )}
        {toast.chatId && (
          <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 550, color: ACCENT, marginTop: 6 }}>Open session →</div>
        )}
      </div>
      <button title="Dismiss" onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }} style={{
        width: 20, height: 20, flexShrink: 0, borderRadius: 6, border: 'none', cursor: 'pointer',
        background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        opacity: hover ? 0.85 : 0.4, transition: 'opacity 0.12s, background 0.12s',
      }}
        onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <Icon name="xmark" size={11} color={T.text2}/>
      </button>
      {auto && !hover && (
        <span key={toast.id} style={{
          position: 'absolute', left: 0, bottom: 0, height: 2.5, background: st.ink, opacity: 0.5,
          borderBottomLeftRadius: 11, animation: `ws-toast-rail ${WS_TOAST_MS}ms linear forwards`,
        }}/>
      )}
    </div>
  );
}

function MfToaster({ embedded = false, seed = null }) {
  const [toasts, setToasts] = React.useState(seed || []);
  const dismiss = React.useCallback((id) => setToasts(ts => ts.filter(t => t.id !== id)), []);
  React.useEffect(() => {
    if (embedded) return;
    const onToast = (e) => setToasts(ts => [...ts, e.detail].slice(-5));
    window.addEventListener('mf:toast', onToast);
    return () => window.removeEventListener('mf:toast', onToast);
  }, [embedded]);
  const visible = toasts.slice(-5);
  const stack = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'flex-end' }}>
      {visible.map(t => <WsToast key={t.id} toast={t} onDismiss={dismiss} noAuto={embedded}/>)}
    </div>
  );
  if (embedded) return stack;
  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 12000, pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}>{stack}</div>
    </div>,
    document.body,
  );
}

// ════════════════════════════════════════════════════════════════════
// CONNECTION OVERLAY — daemon disconnected. Redesigned: a calm warm scrim
// + a centred card with an orbiting indicator, a reassuring secondary line,
// and an indeterminate progress rail. Honest: no fake "reconnect" button.
// ════════════════════════════════════════════════════════════════════
function ConnectionOverlay({ open = true, embedded = false }) {
  if (!open) return null;
  const body = (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 11000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(233,231,226,0.62)', backdropFilter: 'blur(10px) saturate(120%)',
      WebkitBackdropFilter: 'blur(10px) saturate(120%)',
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        padding: '30px 38px 26px', borderRadius: 13, background: T.content,
        border: `0.5px solid ${T.borderH}`, minWidth: 320,
        boxShadow: '0 30px 80px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(0,0,0,0.06)',
      }}>
        <div style={{ position: 'relative', width: 46, height: 46 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${T.hairline}` }}/>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid transparent', borderTopColor: ACCENT, borderRightColor: ACCENT, animation: 'tw-spin 0.9s linear infinite' }}/>
          <div style={{ position: 'absolute', top: '50%', left: '50%', width: 7, height: 7, marginTop: -3.5, marginLeft: -3.5, borderRadius: '50%', background: ACCENT, animation: 'twPulse 1.4s ease-in-out infinite' }}/>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: T.text, letterSpacing: -0.15 }}>Reconnecting to daemon…</div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: T.text2, marginTop: 5, lineHeight: 1.5, maxWidth: 248 }}>Your sessions are safe. Work resumes automatically the moment the connection is back.</div>
        </div>
        <div style={{ width: 200, height: 3, borderRadius: 2, background: T.hairline, overflow: 'hidden' }}>
          <div style={{ width: '40%', height: '100%', borderRadius: 2, background: ACCENT, animation: 'ws-indeterminate 1.5s ease-in-out infinite' }}/>
        </div>
      </div>
    </div>
  );
  if (embedded) return body;
  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 11000 }}>{body}</div>,
    document.body,
  );
}

// ════════════════════════════════════════════════════════════════════
// TUTORIAL OVERLAY — first-run spotlight coachmark tour. Redesigned to
// warm-chrome: a soft scrim cut-out (box-shadow ring), an accent halo on
// the target, and a LIGHT label card (not the source's dark popover) with
// Back / Next / Skip + a step-dot rail. Steps target real chrome via
// [data-tut]. Live → portals to <body>, measures with getBoundingClientRect
// (transform-aware, lines up under the ZoomStage scale). Embedded → renders
// its own mock workspace strip + measures with the offset chain (scale-safe).
// ════════════════════════════════════════════════════════════════════
const WS_TOUR_STEPS = [
  { target: 'sessions', side: 'right', title: 'Start a session', body: 'Spin up a fresh agent session for any project. Every task gets its own conversation and worktree.' },
  { target: 'composer', side: 'above', title: 'Hand work to your agent', body: 'Describe a task in plain language and press ⏎. Mainframe plans, edits across your repo, and runs commands for you.' },
  { target: 'model',    side: 'above', title: 'Pick your model', body: 'Claude, Codex, or Gemini — choose per session. The provider locks once the conversation starts.' },
  { target: 'run',      side: 'below', title: 'Run & preview', body: 'Launch a dev server and preview your app live, right beside the chat. Capture the screen straight back into context.' },
];

function WsTourLabel({ step, idx, total, onBack, onNext, onSkip, style }) {
  return (
    <div style={{ position: 'absolute', width: 268, zIndex: 3, pointerEvents: 'auto', ...style }}>
      <div style={{
        background: T.content, border: `0.5px solid ${T.borderH}`, borderRadius: 13, padding: '14px 15px 13px',
        boxShadow: '0 18px 48px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
          <span style={{ display: 'inline-flex', width: 20, height: 20, borderRadius: 6, background: 'rgba(10,132,255,0.12)', color: ACCENT, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkles" size={12} color={ACCENT}/>
          </span>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Step {idx + 1} of {total}</span>
        </div>
        <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: T.text, letterSpacing: -0.15 }}>{step.title}</div>
        <div style={{ fontFamily: FONT, fontSize: 12, lineHeight: 1.5, color: T.text2, marginTop: 5 }}>{step.body}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13 }}>
          <div style={{ display: 'flex', gap: 5, flex: 1 }}>
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} style={{ width: i === idx ? 16 : 6, height: 6, borderRadius: 4, background: i === idx ? ACCENT : T.text4, transition: 'all 0.2s' }}/>
            ))}
          </div>
          {idx > 0 && (
            <button onClick={onBack} style={wsGhostBtn}>Back</button>
          )}
          <button onClick={onNext} style={wsPrimaryBtn}>{idx < total - 1 ? 'Next' : 'Done'}</button>
        </div>
      </div>
    </div>
  );
}
const wsGhostBtn = {
  height: 28, padding: '0 12px', borderRadius: 8, border: `0.5px solid ${T.border}`, background: T.content,
  color: T.text2, fontFamily: FONT, fontSize: 12, fontWeight: 550, cursor: 'pointer',
};
const wsPrimaryBtn = {
  height: 28, padding: '0 14px', borderRadius: 8, border: 'none', background: ACCENT,
  color: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

function WsTourCore({ frameRef, measure, steps, onClose, framePad = 0 }) {
  const [idx, setIdx] = React.useState(0);
  const [rect, setRect] = React.useState(null);
  const step = steps[idx];

  const remeasure = React.useCallback(() => {
    if (!step) return;
    setRect(measure(step.target));
  }, [step, measure]);

  React.useEffect(() => {
    remeasure();
    const ro = () => remeasure();
    window.addEventListener('resize', ro);
    const id = setTimeout(remeasure, 30); // after layout settles
    return () => { window.removeEventListener('resize', ro); clearTimeout(id); };
  }, [remeasure]);

  if (!step) return null;
  const PAD = 6;
  const next = () => (idx < steps.length - 1 ? setIdx(i => i + 1) : onClose && onClose());
  const back = () => setIdx(i => Math.max(0, i - 1));

  let labelStyle = { opacity: 0 };
  if (rect) {
    const h = { top: rect.top - PAD, left: rect.left - PAD, w: rect.width + PAD * 2, height: rect.height + PAD * 2 };
    const LW = 268, GAP = 18;
    if (step.side === 'right') labelStyle = { top: Math.max(framePad + 8, h.top), left: h.left + h.w + GAP };
    else if (step.side === 'above') labelStyle = { top: h.top - GAP, left: Math.max(framePad + 8, h.left + h.w / 2 - LW / 2), transform: 'translateY(-100%)' };
    else labelStyle = { top: h.top + h.height + GAP, left: Math.max(framePad + 8, h.left + h.w / 2 - LW / 2) };
  }

  return (
    <>
      {/* click-catcher: blocks the dimmed app underneath */}
      <div onClick={() => {}} style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'auto', cursor: 'default' }}/>
      {/* scrim cut-out + accent halo around the target */}
      {rect && (
        <div style={{
          position: 'absolute', zIndex: 2, pointerEvents: 'none',
          top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2,
          borderRadius: 8, boxShadow: '0 0 0 9999px rgba(28,28,30,0.50)',
          outline: `2px solid ${ACCENT}`, outlineOffset: 2,
          transition: 'top 0.28s cubic-bezier(0.22,1,0.36,1), left 0.28s cubic-bezier(0.22,1,0.36,1), width 0.28s, height 0.28s',
        }}>
          <div style={{ position: 'absolute', inset: -2, borderRadius: 8, animation: 'twPulse 1.8s ease-in-out infinite', boxShadow: `0 0 0 4px rgba(10,132,255,0.18)` }}/>
        </div>
      )}
      <WsTourLabel step={step} idx={idx} total={steps.length} onBack={back} onNext={next} onSkip={onClose} style={labelStyle}/>
      <button onClick={onClose} style={{
        position: 'absolute', bottom: 16, right: 18, zIndex: 3, pointerEvents: 'auto',
        background: 'rgba(255,255,255,0.9)', border: `0.5px solid ${T.border}`, borderRadius: 8,
        padding: '6px 12px', color: T.text2, fontFamily: FONT, fontSize: 12, fontWeight: 550, cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.10)',
      }}>Skip tour</button>
    </>
  );
}

function TutorialOverlay({ run = false, embedded = false, onClose }) {
  const frameRef = React.useRef(null);

  // LIVE: portal to body, fixed frame at viewport origin → getBoundingClientRect
  // gives correct coords under the ZoomStage transform.
  const liveMeasure = React.useCallback((target) => {
    const el = document.querySelector(`[data-tut="${target}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }, []);

  // EMBEDDED: measure within our own mock frame via the offset chain (scale-safe).
  const embedMeasure = React.useCallback((target) => {
    const frame = frameRef.current;
    if (!frame) return null;
    const el = frame.querySelector(`[data-tut="${target}"]`);
    if (!el) return null;
    return { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight };
  }, []);

  if (embedded) {
    const steps = WS_TOUR_STEPS.slice(0, 3);
    return (
      <div ref={frameRef} style={{ position: 'relative', width: 560, height: 360, borderRadius: 13, overflow: 'hidden', background: T.windowBg, border: `0.5px solid ${T.border}` }}>
        {/* mock workspace strip providing real [data-tut] targets */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', padding: 12, gap: 10 }}>
          <div style={{ width: 150, borderRadius: 11, background: T.glass, border: `0.5px solid ${T.border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: T.text3 }}>Sessions</span>
              <span data-tut="sessions" style={{ width: 22, height: 22, borderRadius: 6, background: T.content, border: `0.5px solid ${T.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={12} color={T.text2}/></span>
            </div>
            {['Refactor auth flow', 'Fix flaky tests', 'Add CSV export'].map((s, i) => (
              <div key={i} style={{ padding: '6px 8px', borderRadius: 8, background: i === 0 ? T.content : 'transparent', border: i === 0 ? `0.5px solid ${T.border}` : '0.5px solid transparent', fontFamily: FONT, fontSize: 11, color: T.text2 }}>{s}</div>
            ))}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 11, background: T.content, border: `0.5px solid ${T.border}`, overflow: 'hidden' }}>
            <div style={{ flex: 1 }}/>
            <div data-tut="composer" style={{ margin: 10, borderRadius: 11, border: `0.5px solid ${T.borderH}`, background: T.content, padding: 9 }}>
              <div style={{ fontFamily: FONT, fontSize: 12, color: T.text3 }}>Reply to Mainframe…</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                <span data-tut="model" style={{ height: 22, padding: '0 8px', borderRadius: 6, background: T.chipBg, color: T.text2, display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT, fontSize: 11, fontWeight: 500 }}>Claude Sonnet 4.5<Icon name="chevron.down" size={8} color={T.text3}/></span>
              </div>
            </div>
          </div>
        </div>
        <WsTourCore frameRef={frameRef} measure={embedMeasure} steps={steps} onClose={onClose} framePad={0}/>
      </div>
    );
  }

  if (!run) return null;
  return ReactDOM.createPortal(
    <div ref={frameRef} style={{ position: 'fixed', inset: 0, zIndex: 11500, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
        <WsTourCore frameRef={frameRef} measure={liveMeasure} steps={WS_TOUR_STEPS} onClose={onClose}/>
      </div>
    </div>,
    document.body,
  );
}

// ════════════════════════════════════════════════════════════════════
// ERROR STATE — boundary fallback. Redesigned: calm centred panel, mono
// detail block, primary "Try again" + secondary "Reload" / "Copy details".
// ════════════════════════════════════════════════════════════════════
function ErrorState({ error, onRetry, embedded = false }) {
  const [copied, setCopied] = React.useState(false);
  const msg = (error && error.message) || 'An unexpected error occurred while rendering this view.';
  const copy = () => {
    try { navigator.clipboard.writeText(msg); } catch (e) {}
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div style={{
      position: embedded ? 'relative' : 'absolute', inset: embedded ? undefined : 0,
      width: embedded ? '100%' : undefined, height: embedded ? '100%' : undefined,
      display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.windowBg, padding: 28,
    }}>
      <div style={{
        width: 420, maxWidth: '100%', background: T.content, borderRadius: 13, border: `0.5px solid ${T.borderH}`,
        boxShadow: '0 24px 64px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.05)', padding: '26px 24px 22px', textAlign: 'center',
      }}>
        <div style={{ width: 44, height: 44, margin: '0 auto', borderRadius: 13, background: 'rgba(220,53,69,0.10)', color: T.red, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="exclamationmark.triangle" size={22} color={T.red}/>
        </div>
        <div style={{ fontFamily: FONT, fontSize: 17, fontWeight: 600, color: T.text, marginTop: 14, letterSpacing: -0.2 }}>Something went wrong</div>
        <div style={{ fontFamily: FONT, fontSize: 12, color: T.text2, marginTop: 5, lineHeight: 1.5 }}>This view hit an error and stopped rendering. Your session and files are unaffected.</div>
        <div style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 8, background: T.codeBg, border: `0.5px solid ${T.border}`,
          fontFamily: MONO, fontSize: 11, color: T.text2, textAlign: 'left', lineHeight: 1.5,
          maxHeight: 96, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        }}>{msg}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
          <button onClick={copy} style={wsGhostBtn}>{copied ? 'Copied ✓' : 'Copy details'}</button>
          <button onClick={() => window.location.reload()} style={wsGhostBtn}>Reload</button>
          <button onClick={onRetry} style={wsPrimaryBtn}>Try again</button>
        </div>
      </div>
    </div>
  );
}

class MfErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { /* would log */ }
  reset = () => { this.setState({ hasError: false, error: null }); if (this.props.onReset) this.props.onReset(); };
  render() {
    if (this.state.hasError) {
      return <ErrorState error={this.state.error} onRetry={this.reset}/>;
    }
    return this.props.children;
  }
}

// component that throws on render — wire a dev tweak to it to demo the boundary
function WsBoom({ when }) {
  if (when) throw new Error("Cannot read properties of undefined (reading 'messages')\n    at SessionView (renderer/components/center/SessionView.tsx:142)");
  return null;
}

// ── keyframes used only by this module (review pages replicate these) ──
(function ensureWsKeyframes() {
  if (document.getElementById('ws-window-keyframes')) return;
  const s = document.createElement('style');
  s.id = 'ws-window-keyframes';
  s.textContent = `
    @keyframes ws-toast-rail { from { width: 100% } to { width: 0% } }
    @keyframes ws-indeterminate { 0% { transform: translateX(-120%) } 100% { transform: translateX(420%) } }
  `;
  document.head.appendChild(s);
})();

Object.assign(window, {
  MfToaster, ConnectionOverlay, TutorialOverlay, ErrorState, MfErrorBoundary, WsBoom,
});
