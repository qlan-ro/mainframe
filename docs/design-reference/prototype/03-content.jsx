// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Content: chat, composer, code/diff/terminal/preview panes
// Loaded as an ordered <script type="text/babel"> after React. All module
// files share one global scope (Babel executes them in document order),
// so symbols defined earlier (tokens, Icon, data) are visible here.
// Depends on: 01-base, 02-chrome
// ════════════════════════════════════════════════════════════════

function ChatSessionBar() {
  const adapter = 'Claude';
  const model = 'Sonnet 4.5';
  const branch = 'test/all-prs-merged';
  const status = 'thinking'; // thinking | awaiting | compacting | idle | starting | error
  const contextPct = 38;
  const dotColor = ADAPTER_DOT[adapter] ?? T.text3;

  const statusMap = {
    thinking:   { l: 'Thinking',  c: T.text2, spinner: true },
    awaiting:   { l: 'Awaiting',  c: T.text2, pulse: true },
    compacting: { l: 'Compacting', c: T.text2, spinner: true },
    starting:   { l: 'Starting',  c: T.text2, spinner: true },
    error:      { l: 'Error',     c: T.red },
    idle:       null,
  };
  const st = statusMap[status];

  // 8-segment context progress (mirrors real PROGRESS_SEGMENTS = 8)
  const filled = Math.round((contextPct / 100) * 8);
  const progressColor = contextPct >= 90 ? T.red
    : contextPct >= 75 ? T.amber
    : contextPct >= 50 ? T.amber + '99'
    : T.text2 + 'aa';

  return (
    <div data-testid="session-bar" style={{
      height: 28, flexShrink: 0,
      background: T.content2,
      borderBottom: `0.5px solid ${T.hairline}`,
      display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10,
      fontFamily: FONT, fontSize: 11, color: T.text2, letterSpacing: -0.05,
      overflow: 'hidden',
    }}>
      {/* Adapter + selected model */}
      <span title={`${adapter} · ${model}`} style={{
        display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, flex: 1, minWidth: 0,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }}/>
        <span style={{ color: T.text, fontWeight: 600 }}>{adapter}</span>
        <span style={{ color: T.text4, fontWeight: 400 }}>·</span>
        <span style={{ color: T.text2, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model}</span>
      </span>

      {/* Branch lives in the toolbar breadcrumb — not duplicated here. */}

      {/* PR pill moved to the chat surface header (tab bar). */}

      {/* Status — centered */}
      {st && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          color: st.c, flexShrink: 0,
        }}>
          {st.spinner && (
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              border: `1.5px solid ${st.c}`, borderTopColor: 'transparent',
              animation: 'tw-spin 0.9s linear infinite',
            }}/>
          )}
          {st.pulse && (
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.c }} className="tw-pulse"/>
          )}
          <span>{st.l}</span>
        </span>
      )}

      {/* Right group: background tasks + context */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
      {/* Background tasks — small pill */}
      <span title="2 background tasks" style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        height: 16, padding: '0 6px', borderRadius: 8,
        background: T.chipBg, color: T.text2, fontSize: 10, fontWeight: 600,
        flexShrink: 0,
      }}>
        <Icon name="circle.dotted" size={11} color={T.text2}/>
        2
      </span>

      {/* Context: bar + percentage */}
      <span title={`Context: ${contextPct}% used`} style={{
        display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 1.5 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{
              width: 3, height: 9, borderRadius: 1.5,
              background: i < filled ? progressColor : T.text2 + '26',
            }}/>
          ))}
        </div>
        <span style={{ fontFamily: MONO, fontSize: 10, color: T.text3, fontVariantNumeric: 'tabular-nums' }}>
          {contextPct}%
        </span>
      </span>
      </span>
    </div>
  );
}

function ChatPane({ compact }) {
  const ws = React.useContext(WorkspaceCtx);
  const openFile = (f) => { if (ws) ws.openTarget({ kind: 'code', file: f.split('/').pop() }); };
  const paneRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  const [quotes, setQuotes] = React.useState([]);
  const [quoteBtn, setQuoteBtn] = React.useState(null); // { x, y, text }

  // Detect a text selection inside the transcript → show a floating Quote pill.
  const computeQuote = React.useCallback(() => {
    const sel = window.getSelection();
    const scrollEl = scrollRef.current, paneEl = paneRef.current;
    if (!sel || sel.isCollapsed || !scrollEl || !paneEl) { setQuoteBtn(null); return; }
    const text = sel.toString().trim();
    if (!text || !scrollEl.contains(sel.anchorNode)) { setQuoteBtn(null); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const paneRect = paneEl.getBoundingClientRect();
    const scale = paneRect.width / paneEl.offsetWidth || 1; // undo ZoomStage scale
    setQuoteBtn({
      x: (rect.left + rect.width / 2 - paneRect.left) / scale,
      y: (rect.top - paneRect.top) / scale,
      text,
    });
  }, []);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const up = () => computeQuote();
    const down = (e) => { if (!e.target.closest('[data-quote-btn]')) setQuoteBtn(null); };
    el.addEventListener('mouseup', up);
    el.addEventListener('mousedown', down);
    return () => { el.removeEventListener('mouseup', up); el.removeEventListener('mousedown', down); };
  }, [computeQuote]);
  const addQuote = () => {
    if (!quoteBtn) return;
    setQuotes(q => [...q, quoteBtn.text]);
    setQuoteBtn(null);
    const s = window.getSelection(); if (s) s.removeAllRanges();
  };

  return (
    <div ref={paneRef} style={{
      position: 'relative',
      flex: 1, minHeight: 0, background: T.content, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <ChatSessionBar/>
      <div ref={scrollRef}
        style={{ flex: 1, minHeight: 0, padding: '16px 22px 0', overflowY: 'auto' }}>
        {window.ChatTranscript
          ? <window.ChatTranscript onOpenFile={openFile}/>
          : <div style={{ fontFamily: FONT, fontSize: 13, color: T.text3 }}>Loading transcript…</div>}

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, margin: '6px 0 16px',
          padding: '5px 11px', borderRadius: 13, background: T.chipBg,
          border: `0.5px solid ${T.border}`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.amber }} className="tw-pulse"/>
          <span style={{ fontSize: 12, color: T.text2, fontWeight: 500 }}>Ready</span>
        </div>
      </div>

      <Composer quotes={quotes} onRemoveQuote={(i) => setQuotes(q => q.filter((_, j) => j !== i))}/>

      {quoteBtn && (
        <button data-quote-btn
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={addQuote}
          style={{
            position: 'absolute', left: quoteBtn.x, top: Math.max(2, quoteBtn.y - 40), transform: 'translateX(-50%)',
            zIndex: 60, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px 6px 9px',
            borderRadius: 8, border: 'none', cursor: 'pointer',
            background: T.text, color: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 600, letterSpacing: -0.1,
            boxShadow: '0 6px 18px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(0,0,0,0.2)', whiteSpace: 'nowrap',
            animation: 'tw-slidein 0.14s ease-out both',
          }}>
          <Icon name="quote" size={13} color="#fff"/>Quote
        </button>
      )}
    </div>
  );
}

// Provider + model registry for the composer selector.
// Per-model CAPABILITY data — the single source the composer reads to decide
// which effort levels + feature toggles to offer. Mirrors what each CLI adapter
// advertises (Claude `supportedEffortLevels`/`supportsFastMode`/`supportsAdaptiveThinking`;
// Codex `supportedReasoningEfforts`/`additionalSpeedTiers`/`supportsPersonality`).
// Nothing is hardcoded in the UI — options are a pure function of these fields.
//   supportsUltracode is DERIVED (supportedEfforts includes 'xhigh'), never probed.
const AI_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', dot: '#d97757', adapter: 'claude', models: [
    { id: 'opus-4.1',   name: 'Claude Opus 4.1', note: 'Most capable',
      supportedEfforts: ['low','medium','high','xhigh','max'], supportsFast: true, supportsAdaptiveThinking: true },
    { id: 'sonnet-4.5', name: 'Claude Sonnet 4.5', note: 'Balanced · default',
      supportedEfforts: ['low','medium','high'], supportsFast: true, supportsAdaptiveThinking: true },
    { id: 'haiku-4',    name: 'Claude Haiku 4', note: 'Fastest',
      supportedEfforts: [] },
  ] },
  { id: 'openai', name: 'OpenAI', dot: '#10a37f', adapter: 'codex', models: [
    { id: 'gpt-5',      name: 'GPT-5', note: 'Most capable',
      supportedEfforts: ['low','medium','high','xhigh'], defaultEffort: 'medium', supportsFast: true, supportsPersonality: true },
    { id: 'gpt-5-mini', name: 'GPT-5 mini', note: 'Fast',
      supportedEfforts: ['low','medium','high'], defaultEffort: 'low', supportsFast: true, supportsPersonality: true },
    { id: 'o4',         name: 'o4', note: 'Reasoning',
      supportedEfforts: ['low','medium','high','xhigh'], defaultEffort: 'medium', supportsPersonality: true },
  ] },
  { id: 'google', name: 'Google', dot: '#4285f4', adapter: 'gemini', models: [
    { id: 'gemini-2.5-pro',   name: 'Gemini 2.5 Pro', note: 'Most capable',
      supportedEfforts: ['low','medium','high'] },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', note: 'Fast',
      supportedEfforts: [] },
  ] },
];

// Stamp each model with its provider adapter so capability derivation can be
// adapter-aware (e.g. Ultracode is a Claude-only flag even though Codex also
// advertises an 'xhigh' effort level).
AI_PROVIDERS.forEach(p => p.models.forEach(m => { m.adapter = p.adapter; }));

// Display metadata for the closed EffortLevel union. The per-model
// `supportedEfforts` array is the runtime gate; this only supplies labels.
const EFFORT_META = {
  minimal: { label: 'Minimal', desc: 'Barely reason — fastest' },
  low:     { label: 'Low',     desc: 'Light reasoning' },
  medium:  { label: 'Medium',  desc: 'Balanced' },
  high:    { label: 'High',    desc: 'Thorough reasoning' },
  xhigh:   { label: 'Extra-high', desc: 'Deepest standard tier' },
  max:     { label: 'Maximum', desc: 'Unbounded — slowest' },
};

// Declarative feature table — one row per boolean capability. The composer's
// FeaturesPopover renders FEATURES.filter(f => model[f.cap]); per-provider
// gating falls out for free (Opus → all 3; Codex → Fast; Haiku → none).
//   `mfDerived` features compute their cap from the model instead of a flag.
const FEATURES = [
  { key: 'fast',             cap: 'supportsFast',             label: 'Fast mode',         desc: 'Lower latency, slightly less depth' },
  { key: 'ultracode',        cap: 'supportsUltracode',        label: 'Ultracode',         desc: 'xhigh effort + dynamic workflows' },
  { key: 'adaptiveThinking', cap: 'supportsAdaptiveThinking', label: 'Adaptive thinking', desc: 'Claude decides when & how much to think' },
];
// Capability resolver — derives supportsUltracode + normalizes the rest.
function modelCap(model, cap) {
  if (!model) return false;
  // Ultracode is a Claude-only harness flag, derived from xhigh support.
  if (cap === 'supportsUltracode') return model.adapter === 'claude' && (model.supportedEfforts || []).includes('xhigh');
  return !!model[cap];
}
const modelEfforts = (model) => (model && model.supportedEfforts) || [];

// Shared model+tuning state for the composer toolbar, so EffortPicker and
// FeaturesPopover read the SELECTED model's capabilities (single source).
const ComposerModelCtx = React.createContext(null);

// Composer model selector. Provider is free to change while the session is
// empty; once messages are sent the provider LOCKS and only models from that
// provider can be chosen (you can't swap mid-conversation).
function ModelSelector({ sessionEmpty }) {
  const ctx = React.useContext(ComposerModelCtx);
  const [iProviderId, setIProviderId] = React.useState('anthropic');
  const [iModelId, setIModelId] = React.useState('sonnet-4.5');
  const providerId = ctx ? ctx.providerId : iProviderId;
  const modelId = ctx ? ctx.modelId : iModelId;
  const [open, setOpen] = React.useState(false);
  const provider = AI_PROVIDERS.find(p => p.id === providerId);
  const model = provider.models.find(m => m.id === modelId) || provider.models[0];
  const locked = !sessionEmpty;

  const setProviderId = ctx ? ctx.setProviderId : setIProviderId;
  const setModelId = ctx ? ctx.setModelId : setIModelId;

  const pickProvider = (pid) => {
    if (locked) return;
    setProviderId(pid);
    const p = AI_PROVIDERS.find(x => x.id === pid);
    setModelId(p.models[0].id);
  };

  return (
    <span data-tut="model" style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen(o => !o)} title="Provider & model"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, height: 20,
          padding: '0 7px 0 8px', borderRadius: 11,
          border: `0.5px solid ${open ? ACCENT : T.border}`, cursor: 'pointer',
          background: open ? `${ACCENT}10` : 'transparent',
          fontSize: 11, color: T.text2, fontFamily: FONT,
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = T.rowHover; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: provider.dot, flexShrink: 0 }}/>
        <span style={{ fontWeight: 500 }}>{model.name}</span>
        <Icon name="chevron.down" size={9} color={T.text3}/>
      </button>
      {open && (<React.Fragment>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }}/>
        <div style={{
          position: 'absolute', bottom: 28, left: 0, zIndex: 61, width: 268,
          background: T.popBg, borderRadius: 11, padding: 5,
          boxShadow: '0 16px 40px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(0,0,0,0.14)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px 4px' }}>
            <span style={{ fontSize: 10, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Provider</span>
            {locked && (
              <span title="Locked once the session has messages" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: T.text3, fontWeight: 600 }}>
                <Icon name="lock" size={9} color={T.text3}/> Locked
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 3, padding: '0 4px 4px' }}>
            {AI_PROVIDERS.map(p => {
              const sel = p.id === providerId;
              const dim = locked && !sel;
              return (
                <button key={p.id} onClick={() => pickProvider(p.id)} disabled={dim}
                  title={dim ? 'Provider locked — already sent messages this session' : p.name}
                  style={{
                    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    height: 26, borderRadius: 6, cursor: dim ? 'default' : 'pointer',
                    border: `0.5px solid ${sel ? ACCENT : T.border}`,
                    background: sel ? `${ACCENT}12` : 'transparent',
                    opacity: dim ? 0.4 : 1,
                    fontSize: 11, fontWeight: sel ? 600 : 500, color: sel ? T.text : T.text2, fontFamily: FONT,
                  }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot }}/>
                  {p.name}
                  {dim && <Icon name="lock" size={8} color={T.text3}/>}
                </button>
              );
            })}
          </div>
          <div style={{ height: 1, background: T.hairline, margin: '2px 6px 4px' }}/>
          <div style={{ padding: '0 8px 4px', fontSize: 10, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
            {provider.name} models
          </div>
          {provider.models.map(m => {
            const sel = m.id === modelId;
            return (
              <button key={m.id} onClick={() => { setModelId(m.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', borderRadius: 6,
                  border: 'none', background: sel ? T.rowHover : 'transparent', cursor: 'pointer', textAlign: 'left',
                  fontFamily: FONT,
                }}
                onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = T.rowHover; }}
                onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
                  {sel && <Icon name="checkmark" size={11} color={ACCENT}/>}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: sel ? 600 : 500, color: T.text, letterSpacing: -0.1 }}>{m.name}</span>
                </span>
                <span style={{ fontSize: 10, color: T.text3 }}>{m.note}</span>
              </button>
            );
          })}
          <div style={{ padding: '6px 8px 3px', borderTop: `0.5px solid ${T.hairline}`, marginTop: 3, fontSize: 10, color: T.text4, letterSpacing: -0.05 }}>
            {locked ? 'Provider stays fixed for this session.' : 'Pick a provider before your first message.'}
          </div>
        </div>
      </React.Fragment>)}
    </span>
  );
}

// Generic composer dropdown chip: icon + label + chevron, opens a single-select
// popover. Used for permission mode and reasoning effort. Built on the canonical
// popover system (module 13): the chip is the trigger, PopSelectRow is the body.
// `inline` renders the open card alone (for Popovers Review.html).
function ComposerSelect({ icon, options, value, onChange, title, accentDot, inline }) {
  const cur = options.find(o => o.id === value) || options[0];
  const body = (close) => options.map(o => (
    <PopSelectRow key={o.id} selected={o.id === value} label={o.label} note={o.note}
      onClick={() => { onChange && onChange(o.id); close && close(); }}/>
  ));
  if (inline) return <PopCard minWidth={188}>{body(() => {})}</PopCard>;
  return (
    <Popover side="top" align="start" minWidth={188}
      trigger={({ toggle, open }) => (
        <button onClick={toggle} title={title}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, height: 20,
            padding: '0 7px', borderRadius: 11,
            border: `0.5px solid ${open ? ACCENT : T.border}`, cursor: 'pointer',
            background: open ? `${ACCENT}10` : 'transparent',
            fontSize: 11, color: T.text2, fontFamily: FONT,
          }}
          onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = T.rowHover; }}
          onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
          {accentDot
            ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: cur.color || T.text3, flexShrink: 0 }}/>
            : <Icon name={icon} size={11} color={T.text2}/>}
          <span style={{ fontWeight: 500 }}>{cur.label}</span>
          <Icon name="chevron.down" size={9} color={T.text3}/>
        </button>
      )}>
      {({ close }) => body(close)}
    </Popover>
  );
}

// Plan-mode toggle — icon button; tooltip reflects state, amber dot when on.
function PlanModeToggle() {
  const [on, setOn] = React.useState(true);
  return (
    <button onClick={() => setOn(v => !v)} title={`Plan mode: ${on ? 'on' : 'off'}`}
      style={{
        position: 'relative', width: 26, height: 20, borderRadius: 6,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: `0.5px solid ${on ? T.amber : T.border}`,
        background: on ? `${T.amber}14` : 'transparent', cursor: 'pointer',
      }}
      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = T.rowHover; }}
      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
      <Icon name="clipboard" size={12} color={on ? T.amber : T.text2}/>
    </button>
  );
}

// Effective effort for a model+tuning: explicit override → model default →
// 'medium', clamped to what the model actually supports.
function resolveEffort(model, tuning) {
  const efforts = modelEfforts(model);
  const want = (tuning && tuning.effort) || model.defaultEffort || 'medium';
  if (efforts.includes(want)) return want;
  return efforts.includes('medium') ? 'medium' : efforts[efforts.length - 1];
}

// Reasoning-effort picker — options are a pure function of the selected model's
// `supportedEfforts` (no hardcoded list). Hidden entirely when the model
// advertises none (e.g. Haiku). Ticking Ultracode locks this to xhigh.
function EffortPicker({ disabled }) {
  const ctx = React.useContext(ComposerModelCtx);
  if (!ctx) return null;
  const { model, tuning, setTuning } = ctx;
  const efforts = modelEfforts(model);
  if (efforts.length === 0) return null;
  const locked = !!tuning.ultracode;                  // ultracode forces xhigh
  const cur = locked ? 'xhigh' : resolveEffort(model, tuning);
  const curMeta = EFFORT_META[cur] || { label: cur };

  return (
    <Popover side="top" align="start" minWidth={200}
      trigger={({ toggle, open }) => (
        <button onClick={disabled ? undefined : toggle} title={locked ? 'Locked to Extra-high by Ultracode' : 'Reasoning effort'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, height: 20,
            padding: '0 7px', borderRadius: 11,
            border: `0.5px solid ${open ? ACCENT : T.border}`, cursor: disabled ? 'default' : 'pointer',
            background: open ? `${ACCENT}10` : 'transparent', opacity: disabled ? 0.45 : 1,
            fontSize: 11, color: T.text2, fontFamily: FONT,
          }}
          onMouseEnter={(e) => { if (!open && !disabled) e.currentTarget.style.background = T.rowHover; }}
          onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
          <Icon name="gauge" size={11} color={T.text2}/>
          <span style={{ fontWeight: 500 }}>{curMeta.label}</span>
          {locked && <Icon name="lock" size={9} color={T.text4}/>}
          <Icon name="chevron.down" size={9} color={T.text3}/>
        </button>
      )}>
      {({ close }) => (
        <PopCard minWidth={200}>
          {locked && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 9px 7px', fontFamily: FONT, fontSize: 10.5, color: T.text3, lineHeight: 1.4 }}>
              <Icon name="lock" size={10} color={T.text4}/>
              Ultracode is on — effort is held at Extra-high.
            </div>
          )}
          {efforts.map(e => {
            const m = EFFORT_META[e] || { label: e };
            return (
              <PopSelectRow key={e} selected={e === cur} label={m.label} note={m.desc}
                onClick={() => { if (!locked) { setTuning({ effort: e }); } close && close(); }}/>
            );
          })}
        </PopCard>
      )}
    </Popover>
  );
}

// Compact switch used inside the features popover (matches SwToggle visuals).
function FxSwitch({ on, tint = ACCENT }) {
  return (
    <span style={{
      width: 32, height: 19, flexShrink: 0, borderRadius: 10, padding: 2,
      background: on ? tint : 'rgba(0,0,0,0.16)', transition: 'background .18s', display: 'inline-block',
    }}>
      <span style={{
        display: 'block', width: 15, height: 15, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transform: on ? 'translateX(13px)' : 'translateX(0)', transition: 'transform .18s cubic-bezier(.3,.8,.3,1)',
      }}/>
    </span>
  );
}

// Harness feature toggles (⚙) — Fast / Ultracode / Adaptive thinking. Rows come
// from the declarative FEATURES table gated by the selected model's capabilities,
// so per-provider visibility falls out for free (Opus → 3, Codex → Fast, Haiku → 0).
// When NO feature is supported the whole control hides. Ultracode ↔ xhigh couples.
function FeaturesPopover({ disabled }) {
  const ctx = React.useContext(ComposerModelCtx);
  if (!ctx) return null;
  const { model, tuning, setTuning } = ctx;
  const rows = FEATURES.filter(f => modelCap(model, f.cap));
  if (rows.length === 0) return null;

  const toggle = (key) => {
    if (key === 'ultracode') {
      const next = !tuning.ultracode;
      setTuning(next ? { ultracode: true, effort: 'xhigh' } : { ultracode: false });
    } else {
      setTuning({ [key]: !tuning[key] });
    }
  };

  return (
    <Popover side="top" align="start" minWidth={244}
      trigger={({ toggle: tg, open }) => (
        <button onClick={disabled ? undefined : tg} title="Harness features"
          style={{
            width: 26, height: 20, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `0.5px solid ${open ? ACCENT : T.border}`, background: open ? `${ACCENT}10` : 'transparent',
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, position: 'relative',
          }}
          onMouseEnter={(e) => { if (!open && !disabled) e.currentTarget.style.background = T.rowHover; }}
          onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
          <Icon name="sliders" size={12} color={T.text2}/>
          {rows.some(r => tuning[r.key]) && (
            <span style={{ position: 'absolute', top: 1, right: 1, width: 5, height: 5, borderRadius: '50%', background: ACCENT }}/>
          )}
        </button>
      )}>
      {({ close }) => (
        <PopCard minWidth={244}>
          <div style={{ padding: '4px 10px 5px', fontFamily: FONT, fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {model.name} features
          </div>
          {rows.map(f => {
            const on = f.key === 'ultracode' ? !!tuning.ultracode : !!tuning[f.key];
            return (
              <div key={f.key} data-testid={`composer-feature-${f.key}`} onClick={() => toggle(f.key)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 7, cursor: 'pointer' }}
                onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: T.text, letterSpacing: -0.05 }}>{f.label}</div>
                  <div style={{ fontFamily: FONT, fontSize: 10.5, color: T.text3, lineHeight: 1.35, marginTop: 1, letterSpacing: -0.05 }}>{f.desc}</div>
                </div>
                <FxSwitch on={on}/>
              </div>
            );
          })}
        </PopCard>
      )}
    </Popover>
  );
}

// Worktree button — opens a popover to run the session in an isolated worktree
// on an existing or new branch.
function WorktreeButton() {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState('new');
  const [base, setBase] = React.useState('feat/tech-debt-all');
  const [branch, setBranch] = React.useState('feat/my-branch');
  const BRANCHES = ['feat/tech-debt-all', 'main', 'test/all-prs-merged', 'release/0.20'];
  const Tab = ({ id, children }) => (
    <button onClick={() => setMode(id)} style={{
      flex: 1, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: FONT,
      fontSize: 12, fontWeight: mode === id ? 600 : 500,
      color: mode === id ? T.text : T.text3,
      background: mode === id ? T.tabBarActive : 'transparent',
      boxShadow: mode === id ? `0 0.5px 0 ${T.border}, 0 1px 2px rgba(0,0,0,0.06)` : 'none',
    }}>{children}</button>
  );
  const fieldLabel = { fontSize: 10, color: T.text3, fontWeight: 600, letterSpacing: 0.2, marginBottom: 4, display: 'block' };
  const field = {
    width: '100%', height: 30, borderRadius: 8, border: `0.5px solid ${T.border}`,
    background: T.content, padding: '0 9px', fontFamily: MONO, fontSize: 11, color: T.text,
    outline: 'none', boxSizing: 'border-box',
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen(o => !o)} title="Run in worktree"
        style={{
          width: 26, height: 20, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: `0.5px solid ${open ? ACCENT : T.border}`, background: open ? `${ACCENT}10` : 'transparent', cursor: 'pointer',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = T.rowHover; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
        <Icon name="folder.git" size={13} color={T.text2}/>
      </button>
      {open && (<React.Fragment>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }}/>
        <div style={{
          position: 'absolute', bottom: 28, right: 0, zIndex: 61, width: 300,
          background: T.popBg, borderRadius: 11, padding: 12,
          boxShadow: '0 16px 44px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.14)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 10px', borderRadius: 8,
            background: `${T.amber}14`, marginBottom: 12,
          }}>
            <Icon name="exclamationmark.triangle" size={13} color={T.amber}/>
            <span style={{ fontSize: 11, lineHeight: 1.4, color: '#8a5a12', letterSpacing: -0.05 }}>
              Session will be paused and resumed in the worktree.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 3, padding: 2, borderRadius: 8, background: T.chipBg, marginBottom: 12 }}>
            <Tab id="existing">Existing</Tab>
            <Tab id="new">New</Tab>
          </div>
          <label style={fieldLabel}>Base branch</label>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <select value={base} onChange={(e) => setBase(e.target.value)} style={{ ...field, appearance: 'none', cursor: 'pointer' }}>
              {BRANCHES.map(b => <option key={b} value={b}>{b}{b === 'feat/tech-debt-all' ? ' (current)' : ''}</option>)}
            </select>
            <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <Icon name="chevron.down" size={10} color={T.text3}/>
            </span>
          </div>
          {mode === 'new' && (<React.Fragment>
            <label style={fieldLabel}>Branch name</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} style={{ ...field, marginBottom: 12 }} spellCheck={false}/>
          </React.Fragment>)}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => setOpen(false)} style={{
              height: 28, padding: '0 12px', borderRadius: 8, border: 'none', background: 'transparent',
              cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 500, color: T.text2,
            }}>Cancel</button>
            <button onClick={() => setOpen(false)} style={{
              height: 28, padding: '0 13px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: ACCENT, color: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <Icon name="checkmark" size={11} color="#fff" stroke={2.4}/> Enable
            </button>
          </div>
        </div>
      </React.Fragment>)}
    </span>
  );
}

function Composer({ sessionEmpty = false, quotes = [], onRemoveQuote, value, captures = [], embedded = false, initialProvider = 'anthropic', initialModel = 'sonnet-4.5', initialTuning }) {
  const UMScreenshot = window.UMCaptureScreenshot, UMInspect = window.UMInspectChip, UMFile = window.UMFileChip;
  // Shared model + tuning state so EffortPicker / FeaturesPopover read the
  // selected model's capabilities. Tuning merges so each control writes one key.
  const [providerId, setProviderId] = React.useState(initialProvider);
  const [modelId, setModelId] = React.useState(initialModel);
  const [tuning, setTuningRaw] = React.useState({ effort: null, fast: false, ultracode: false, adaptiveThinking: false, ...(initialTuning || {}) });
  const provider = AI_PROVIDERS.find(p => p.id === providerId);
  const model = provider.models.find(m => m.id === modelId) || provider.models[0];
  const setTuning = (patch) => setTuningRaw(t => ({ ...t, ...patch }));
  // When the model changes, drop tuning that the new model can't honor.
  const selectModel = (mid) => {
    setModelId(mid);
    const m = provider.models.find(x => x.id === mid);
    setTuningRaw(t => ({
      effort: (modelEfforts(m).includes(t.effort) ? t.effort : null),
      fast: modelCap(m, 'supportsFast') ? t.fast : false,
      ultracode: modelCap(m, 'supportsUltracode') ? t.ultracode : false,
      adaptiveThinking: modelCap(m, 'supportsAdaptiveThinking') ? t.adaptiveThinking : false,
    }));
  };
  const ctxValue = {
    providerId, setProviderId, modelId, setModelId: selectModel,
    model, tuning, setTuning,
  };
  return (
    <ComposerModelCtx.Provider value={ctxValue}>
    {ComposerBody({ sessionEmpty, quotes, onRemoveQuote, value, captures, embedded, UMScreenshot, UMInspect, UMFile })}
    </ComposerModelCtx.Provider>
  );
}

function ComposerBody({ sessionEmpty, quotes, onRemoveQuote, value, captures, embedded, UMScreenshot, UMInspect, UMFile }) {
  return (
    <div data-tut="composer" style={{
      margin: embedded ? 0 : '8px 22px 16px', flexShrink: 0,
      borderRadius: 13, background: T.content,
      border: `0.5px solid ${T.borderH}`,
      boxShadow: `0 1px 0 ${T.hairline}, 0 8px 22px rgba(0,0,0,0.05)`,
    }}>
      {captures.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '9px 12px 0' }}>
          {captures.map((c, i) => {
            if (c.kind === 'screenshot' && UMScreenshot) return <UMScreenshot key={i}/>;
            if (c.kind === 'element' && UMInspect) return <UMInspect key={i} selector={c.selector} hue={c.hue}/>;
            if (c.kind === 'file' && UMFile) return <UMFile key={i} name={c.name} hue={c.hue}/>;
            return null;
          })}
        </div>
      )}
      {quotes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px 0' }}>
          {quotes.map((q, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 9px', borderRadius: 8, background: T.content2, border: `0.5px solid ${T.border}`, animation: 'tw-slidein 0.18s ease-out both' }}>
              <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: ACCENT, flexShrink: 0 }}/>
              <span style={{ flex: 1, minWidth: 0, fontFamily: FONT, fontSize: 12, color: T.text2, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{q}</span>
              <button title="Remove quote" onClick={() => onRemoveQuote && onRemoveQuote(i)} style={{
                width: 18, height: 18, flexShrink: 0, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
                onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <Icon name="xmark" size={11} color={T.text3}/>
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ padding: '10px 14px 4px', minHeight: 32 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: value ? T.text : T.text3 }}>{value || (quotes.length ? 'Add a message…' : 'Reply to Mainframe…')}</div>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
        padding: '4px 6px 6px 10px',
      }}>
        <button style={{ ...gActionStyle(), width: 22, height: 22 }}>
          <Icon name="paperclip" size={12} color={T.text2}/>
        </button>
        <button style={{ ...gActionStyle(), width: 22, height: 22 }}>
          <Icon name="at" size={12} color={T.text2}/>
        </button>
        <div style={{ width: 1, height: 12, background: T.border, margin: '0 4px' }}/>
        <ModelSelector sessionEmpty={sessionEmpty}/>
        <ComposerSelect title="Permission mode" icon="shield" value="unattended"
          onChange={() => {}}
          options={[
            { id: 'interactive', label: 'Interactive', note: 'Approve every action' },
            { id: 'auto-edits',  label: 'Auto-Edits',  note: 'Edits auto-applied; commands ask' },
            { id: 'unattended',  label: 'Unattended',  note: 'Runs without prompts' },
          ]}/>
        <PlanModeToggle/>
        <EffortPicker disabled={false}/>
        <FeaturesPopover disabled={false}/>
        <WorktreeButton/>
        <div style={{ flex: 1, minWidth: 8 }}/>
        <button style={{
          width: 26, height: 26, borderRadius: 8, background: ACCENT,
          border: 'none', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="arrow.up" size={13} color="#fff" stroke={2.2}/></button>
      </div>
    </div>
  );
}

// ── Editor: inline agent-context comment widget (view-zone equivalent) ──
// Mirrors the desktop Monaco InlineCommentWidget: a card rendered in the code
// flow that pushes lines down, with an edit state and a submitted (read) state.
function EditorCommentWidget({ comment, onChange, onSubmit, onRemove }) {
  const ref = React.useRef(null);
  React.useEffect(() => { if (!comment.submitted && ref.current) ref.current.focus(); }, [comment.submitted]);
  const ghost = { height: 24, padding: '0 10px', borderRadius: RADIUS.sm, border: `0.5px solid ${T.border}`, background: 'transparent', color: T.text2, fontFamily: FONT, fontSize: FS.label, fontWeight: FW.medium, cursor: 'pointer' };
  const prim = (on) => ({ height: 24, padding: '0 11px', borderRadius: RADIUS.sm, border: 'none', background: on ? ACCENT : T.chipBg, color: on ? '#fff' : T.text4, fontFamily: FONT, fontSize: FS.label, fontWeight: FW.semibold, cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.6 });
  return (
    <div style={{ display: 'flex', fontFamily: FONT }}>
      <div style={{ width: 44, flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: 9 }}>
        <Icon name="chat" size={12} color={ACCENT}/>
      </div>
      <div style={{ flex: 1, margin: '5px 14px 7px 0', background: T.popBg, border: `0.5px solid ${comment.submitted ? T.border : ACCENT + '66'}`, borderRadius: RADIUS.md, boxShadow: T.popShadow, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 10px', borderBottom: `0.5px solid ${T.hairline}` }}>
          <Icon name="sparkles" size={11} color={ACCENT}/>
          <span style={{ fontFamily: FONT, fontSize: FS.caption, fontWeight: FW.semibold, color: T.text2 }}>Agent context</span>
          <span style={{ fontFamily: MONO, fontSize: FS.micro, color: T.text4 }}>line {comment.line}</span>
          <div style={{ flex: 1 }}/>
          <button onClick={onRemove} title="Remove" style={{ width: 18, height: 18, border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
            onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="xmark" size={10} color={T.text3}/>
          </button>
        </div>
        {comment.submitted ? (
          <div style={{ padding: '8px 11px', fontFamily: FONT, fontSize: FS.body, color: T.text, lineHeight: LH.normal }}>{comment.text}</div>
        ) : (
          <React.Fragment>
            <textarea ref={ref} value={comment.text} onChange={(e) => onChange(e.target.value)} data-noring
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (comment.text.trim()) onSubmit(); } }}
              placeholder="Describe what the agent should know about this line…"
              style={{ width: '100%', minHeight: 52, resize: 'none', border: 'none', outline: 'none', background: 'transparent', padding: '9px 11px', fontFamily: FONT, fontSize: FS.body, color: T.text, lineHeight: LH.normal, boxSizing: 'border-box' }}/>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px', borderTop: `0.5px solid ${T.hairline}` }}>
              <span style={{ fontFamily: MONO, fontSize: FS.micro, color: T.text4 }}>⌘↩ to add</span>
              <div style={{ flex: 1 }}/>
              <button onClick={onRemove} style={ghost}>Cancel</button>
              <button onClick={() => comment.text.trim() && onSubmit()} disabled={!comment.text.trim()} style={prim(comment.text.trim())}>Add context</button>
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

// ── Editor: right-click context menu (token-styled; replaces Monaco's) ──
function EditorContextMenu({ x, y, items, onClose }) {
  React.useEffect(() => {
    const close = () => onClose();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const W = 232;
  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 1280) - W - 8);
  const top = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 240);
  return (
    <div onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'fixed', left, top, zIndex: 9999, width: W, background: T.popBg, border: `0.5px solid ${T.border}`, borderRadius: RADIUS.md, boxShadow: T.popShadow, padding: 5, fontFamily: FONT }}>
      {items.map((it, i) => it.sep ? (
        <div key={i} style={{ height: 1, background: T.hairline, margin: '5px 6px' }}/>
      ) : (
        <button key={i} onClick={() => { if (it.onClick) it.onClick(); onClose(); }}
          onMouseEnter={(e) => e.currentTarget.style.background = it.accent ? `${ACCENT}14` : T.rowHover}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: RADIUS.sm, cursor: 'pointer', textAlign: 'left' }}>
          <Icon name={it.icon} size={13} color={it.accent ? ACCENT : T.text2}/>
          <span style={{ flex: 1, fontFamily: FONT, fontSize: FS.label, fontWeight: FW.medium, color: it.accent ? ACCENT : T.text }}>{it.label}</span>
          {it.kbd && <span style={{ fontFamily: MONO, fontSize: FS.micro, color: T.text4 }}>{it.kbd}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Code editor pane ──────────────────────────────────────────────────
function CodePane({ filename = 'Layout.tsx' }) {
  // Hand-rolled syntax-highlighted code (TSX-ish)
  const Kw = ({ children }) => <span style={{ color: T.codeKw }}>{children}</span>;
  const Str = ({ children }) => <span style={{ color: T.codeStr }}>{children}</span>;
  const Fn = ({ children }) => <span style={{ color: T.codeFn }}>{children}</span>;
  const Ty = ({ children }) => <span style={{ color: T.codeType }}>{children}</span>;
  const Cm = ({ children }) => <span style={{ color: T.codeCmt }}>{children}</span>;
  const Num = ({ children }) => <span style={{ color: T.codeNum }}>{children}</span>;

  const lines = [
    [<><Kw>import</Kw> React, {'{'} useCallback, useState {'}'} <Kw>from</Kw> <Str>'react'</Str>;</>],
    [<><Kw>import</Kw> {'{'} PanelLeftOpen {'}'} <Kw>from</Kw> <Str>'lucide-react'</Str>;</>],
    [<><Kw>import</Kw> {'{'} Sidebar {'}'} <Kw>from</Kw> <Str>'./Sidebar'</Str>;</>],
    [<><Kw>import</Kw> {'{'} useLayoutStore {'}'} <Kw>from</Kw> <Str>'../store/layout'</Str>;</>],
    [''],
    [<><Cm>// 50/50 — the agent has its own editor group, you have yours.</Cm></>],
    [<><Cm>// Either can be torn off, split, or focused.</Cm></>],
    [<><Kw>export function</Kw> <Fn>Layout</Fn>(): <Ty>JSX.Element</Ty> {'{'}</>],
    [<>  <Kw>const</Kw> collapsed = <Fn>useLayoutStore</Fn>((s) <Kw>{'=>'}</Kw> s.collapsed);</>],
    [<>  <Kw>const</Kw> setCollapsed = <Fn>useLayoutStore</Fn>((s) <Kw>{'=>'}</Kw> s.setCollapsed);</>],
    [''],
    [<>  <Kw>return</Kw> (</>],
    [<>    <Kw>{'<'}</Kw><Ty>div</Ty> className=<Str>"flex h-full"</Str><Kw>{'>'}</Kw></>],
    [<>      <Kw>{'<'}</Kw><Ty>Sidebar</Ty> collapsed={'{'}collapsed{'}'} <Kw>{'/>'}</Kw></>],
    [<>      <Kw>{'<'}</Kw><Ty>WorkspaceArea</Ty> <Kw>{'/>'}</Kw></>],
    [<>      <Kw>{'<'}</Kw><Ty>Inspector</Ty> <Kw>{'/>'}</Kw></>],
    [<>    <Kw>{'</'}</Kw><Ty>div</Ty><Kw>{'>'}</Kw></>],
    [<>  );</>],
    [<>{'}'}</>],
  ];

  // ── Inline agent-context comments + right-click menu state ──
  const [comments, setComments] = React.useState([]);
  const [hoverLine, setHoverLine] = React.useState(null);
  const [menu, setMenu] = React.useState(null);
  const [flash, setFlash] = React.useState(null);
  const seq = React.useRef(1);
  const flashRef = React.useRef(null);
  const addComment = (line) => setComments((cs) => cs.some((c) => c.line === line) ? cs : [...cs, { id: seq.current++, line, text: '', submitted: false }].sort((a, b) => a.line - b.line));
  const setText = (id, text) => setComments((cs) => cs.map((c) => c.id === id ? { ...c, text } : c));
  const removeComment = (id) => setComments((cs) => cs.filter((c) => c.id !== id));
  const submitOne = (id) => setComments((cs) => cs.map((c) => c.id === id ? { ...c, submitted: true } : c));
  const doFlash = (msg) => { setFlash(msg); clearTimeout(flashRef.current); flashRef.current = setTimeout(() => setFlash(null), 1700); };
  const menuItems = (line) => [
    { icon: 'copy', label: 'Copy', kbd: '⌘C', onClick: () => doFlash('Copied') },
    { icon: 'quote', label: 'Copy Reference', kbd: '⌥⇧⌘C', onClick: () => doFlash(`Reference copied · ${filename}:${line}`) },
    { sep: true },
    { icon: 'code', label: 'Go to Definition', kbd: 'F12', onClick: () => doFlash('Jumped to definition') },
    { icon: 'magnifyingglass', label: 'Find All References', kbd: '⇧F12', onClick: () => doFlash('3 references in 2 files') },
    { sep: true },
    { icon: 'chat', label: 'Add Agent Context', accent: true, onClick: () => addComment(line) },
  ];

  return (
    <div style={{
      flex: 1, minHeight: 0, background: T.codeBg, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Breadcrumb / file path */}
      <div style={{
        height: 24, flexShrink: 0, padding: '0 6px 0 12px',
        display: 'flex', alignItems: 'center', gap: 4,
        fontFamily: FONT, fontSize: 11, color: T.text3,
        borderBottom: `0.5px solid ${T.hairline}`,
      }}>
        <Icon name="folder" size={10} color={T.text3}/>
        <span>desktop</span><Icon name="chevron.right" size={8} color={T.text4}/>
        <span>src</span><Icon name="chevron.right" size={8} color={T.text4}/>
        <span>renderer</span><Icon name="chevron.right" size={8} color={T.text4}/>
        <span>components</span><Icon name="chevron.right" size={8} color={T.text4}/>
        <Icon name="doc" size={10} color={T.text3}/>
        <span style={{ color: T.text2, fontWeight: 600 }}>{filename}</span>
        <div style={{ flex: 1 }}/>
        <span style={{
          fontFamily: MONO, fontSize: 10, color: T.green,
          padding: '1px 5px', borderRadius: 4, background: 'rgba(40,167,69,0.1)',
        }}>● saved</span>
        <div style={{ width: 1, height: 13, background: T.border, margin: '0 2px' }}/>
        <button title="Reveal in file tree" style={{
          width: 22, height: 20, borderRadius: 6, border: 'none', background: 'transparent',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon name="locate" size={12} color={T.text2}/>
        </button>
      </div>
      {/* Submit-review bar — appears when agent-context comments exist */}
      {comments.length > 0 && (
        <div style={{ flexShrink: 0, height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 12px', borderBottom: `0.5px solid ${T.hairline}`, background: T.content2 }}>
          <Icon name="chat" size={11} color={ACCENT}/>
          <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text2 }}>{comments.length} agent {comments.length === 1 ? 'note' : 'notes'}</span>
          <div style={{ flex: 1 }}/>
          <button onClick={() => setComments((cs) => cs.map((c) => c.text.trim() ? { ...c, submitted: true } : c))} disabled={!comments.some((c) => c.text.trim())}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 9px', borderRadius: RADIUS.sm, border: 'none', background: comments.some((c) => c.text.trim()) ? `${ACCENT}14` : 'transparent', color: ACCENT, fontFamily: FONT, fontSize: FS.label, fontWeight: FW.semibold, cursor: comments.some((c) => c.text.trim()) ? 'pointer' : 'default', opacity: comments.some((c) => c.text.trim()) ? 1 : 0.4 }}>
            <Icon name="arrow.up" size={11} color={ACCENT}/>
            Submit review ({comments.length})
          </button>
        </div>
      )}
      <div onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, line: hoverLine || 1 }); }} style={{
        flex: 1, minHeight: 0, fontFamily: MONO, fontSize: FS.label, lineHeight: 1.55,
        padding: '8px 0', overflowY: 'auto',
      }}>
        {lines.map((l, i) => {
          const ln = i + 1;
          const cmt = comments.find((c) => c.line === ln);
          return (
            <React.Fragment key={i}>
              <div onMouseEnter={() => setHoverLine(ln)} onMouseLeave={() => setHoverLine((h) => h === ln ? null : h)}
                style={{ display: 'flex', minHeight: 18.5, background: hoverLine === ln ? T.rowHover : (i === 13 ? `${ACCENT}0d` : 'transparent') }}>
                <div style={{ width: 44, flexShrink: 0, position: 'relative', userSelect: 'none' }}>
                  {hoverLine === ln && !cmt && (
                    <button title="Add agent context" onClick={() => addComment(ln)}
                      style={{ position: 'absolute', left: 4, top: 1.5, width: 15, height: 15, padding: 0, border: 'none', borderRadius: 4, background: ACCENT, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="chat" size={9} color="#fff"/>
                    </button>
                  )}
                  <div style={{ textAlign: 'right', paddingRight: 12, lineHeight: '18.5px', fontFamily: MONO, fontSize: FS.caption, color: cmt ? ACCENT : T.text4, fontWeight: cmt ? FW.semibold : FW.normal }}>{ln}</div>
                </div>
                <div style={{ color: T.codeFg, paddingRight: 14, flex: 1, whiteSpace: 'pre' }}>{l[0]}</div>
              </div>
              {cmt && (
                <EditorCommentWidget comment={cmt} onChange={(t) => setText(cmt.id, t)} onSubmit={() => submitOne(cmt.id)} onRemove={() => removeComment(cmt.id)}/>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {menu && (
        <EditorContextMenu x={menu.x} y={menu.y} items={menuItems(menu.line)} onClose={() => setMenu(null)}/>
      )}
      {/* Status row */}
      <div style={{
        height: 20, flexShrink: 0, borderTop: `0.5px solid ${T.hairline}`,
        display: 'flex', alignItems: 'center', padding: '0 10px', gap: 10,
        fontFamily: MONO, fontSize: 10, color: T.text3,
      }}>
        <span>TSX · UTF-8</span>
        <span>Ln 14, Col 8</span>
        <div style={{ flex: 1 }}/>
        {flash ? (
          <span style={{ color: T.green, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="checkmark" size={10} color={T.green}/>
            {flash}
          </span>
        ) : (
          <span style={{ color: ACCENT, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="sparkles" size={10} color={ACCENT}/>
            Mainframe is editing
          </span>
        )}
      </div>
    </div>
  );
}

// ── Terminal pane ─────────────────────────────────────────────────────
function TerminalPane() {
  const Gn = ({ children }) => <span style={{ color: T.termGreen }}>{children}</span>;
  const Cy = ({ children }) => <span style={{ color: T.termCyan }}>{children}</span>;
  const Am = ({ children }) => <span style={{ color: T.termAmber }}>{children}</span>;
  const Cm = ({ children }) => <span style={{ color: T.termCmt }}>{children}</span>;
  const lines = [
    [<><Cy>~/Projects/qlan/mainframe/.worktrees/test-all-prs</Cy></>],
    [<>$ pnpm test --filter @mainframe/desktop</>],
    [''],
    [<><Cm>{`>`} @mainframe/desktop@0.19.0 test</Cm></>],
    [<><Cm>{`>`} vitest run</Cm></>],
    [''],
    [<><Gn>PASS</Gn>  src/store/sessions.test.ts <Cm>(4 tests, 142ms)</Cm></>],
    [<><Gn>PASS</Gn>  src/store/terminal.test.ts <Cm>(7 tests, 88ms)</Cm></>],
    [<><Gn>PASS</Gn>  src/store/zones.test.ts <Cm>(12 tests, 211ms)</Cm></>],
    [<><Am>RUNS</Am>  src/components/zone/zone-layout.test.ts</>],
    [<>      <Cm>{`›`} should compute split ratios for nested groups</Cm></>],
    [''],
    [<><Cm>Test Files  3 passed, 1 running (4)</Cm></>],
    [<><Cm>     Tests  23 passed (23)</Cm></>],
    [<>      Time  <Gn>1.84s</Gn></>],
    [<>▎</>],
  ];
  return (
    <div style={{
      flex: 1, minHeight: 0, background: T.termBg, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Tab strip (terminal sub-tabs) */}
      <div style={{
        height: 24, flexShrink: 0, padding: '0 8px',
        display: 'flex', alignItems: 'center', gap: 4,
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.025)',
      }}>
        {[
          { l: 'zsh · tests', a: true, dot: T.termGreen },
          { l: 'zsh · daemon', dot: T.termAmber },
          { l: 'pnpm dev' },
        ].map((s, i) => (
          <div key={i} style={{
            padding: '2px 8px', fontFamily: MONO, fontSize: 10,
            borderRadius: 4, background: s.a ? 'rgba(255,255,255,0.1)' : 'transparent',
            color: s.a ? '#fff' : '#9b9aa0',
            display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
          }}>
            {s.dot && <span style={{ width: 4.5, height: 4.5, borderRadius: '50%', background: s.dot }}/>}
            {s.l}
          </div>
        ))}
        <button style={{
          width: 18, height: 18, border: 'none', background: 'transparent', borderRadius: 4,
          cursor: 'pointer', color: '#9b9aa0',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="plus" size={11} color="#9b9aa0"/></button>
        <div style={{ flex: 1 }}/>
        <span style={{ fontFamily: MONO, fontSize: 10, color: '#9b9aa0' }}>
          80 × 24 · zsh · 1.84s
        </span>
      </div>
      <div style={{
        flex: 1, padding: '8px 12px', fontFamily: MONO, fontSize: 11,
        lineHeight: 1.55, overflow: 'hidden', color: T.termFg,
      }}>
        {lines.map((l, i) => (
          <div key={i} style={{ whiteSpace: 'pre', minHeight: 17 }}>{l[0]}</div>
        ))}
      </div>
    </div>
  );
}

// ── Launch configs + Preview/Run pane ─────────────────────────────────
// Mirrors the real sandbox PreviewTab: a set of typed launch configurations,
// each a process. `preview: true` configs render a webview + capture toolbar
// above a console; `preview: false` configs are console-only (just run/stop).
const LAUNCH_CONFIGS = [
  { name: 'Setup Worktree', preview: false },
  { name: 'Core Daemon',    preview: false },
  { name: 'Preview',        preview: true,  url: 'localhost:5173' },
  { name: 'Electron App',   preview: true,  url: 'localhost:5173' },
  { name: 'Expo iOS',       preview: true,  url: 'localhost:8081' },
];
const LaunchCtx = React.createContext(null);

function PvToolBtn({ icon, title, on, danger, onClick }) {
  return (
    <button title={title} onClick={onClick} style={{
      width: 24, height: 22, borderRadius: 6, border: 'none', cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      background: on ? T.chipBg : 'transparent',
    }}
    onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = T.rowHover; }}
    onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
      <Icon name={icon} size={13} color={on ? ACCENT : danger ? T.red : T.text2}/>
    </button>
  );
}

function PreviewPane({ configName = 'Preview' }) {
  const configs = LAUNCH_CONFIGS;
  const selected = configName;
  const cfg = configs.find(c => c.name === selected) || configs[0];
  const hasPreview = cfg.preview === true;

  const lc = React.useContext(LaunchCtx) || {};
  const status = (lc.status && lc.status[selected]) || 'stopped'; // stopped | starting | running
  const start = () => (lc.start ? lc.start(selected) : null);
  const stop = () => (lc.stop ? lc.stop(selected) : null);
  const restart = () => (lc.restart ? lc.restart(selected) : null);

  const [mobile, setMobile] = React.useState(false);
  const [inspecting, setInspecting] = React.useState(false);
  const [region, setRegion] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);     // smart drawer — collapsed by default for previews

  const isRunning = status === 'running';
  const starting = status === 'starting';

  // mock log lines for the drawer tail / expanded view
  const logLines = isRunning ? [
    { t: `$ ${cfg.name === 'Preview' ? 'pnpm dev' : cfg.name === 'Core Daemon' ? 'mainframe daemon' : cfg.name.toLowerCase().replace(/\s+/g, '-')}`, c: T.text2 },
    hasPreview ? { t: `  ➜  Local:   http://${cfg.url}/`, c: T.green } : { t: '  ready · listening on :7842', c: T.text3 },
    { t: '  watching for changes…', c: T.text3 },
  ] : [];
  const tail = logLines.length ? logLines[logLines.length - 1].t.trim() : 'No output yet.';

  const STATUS_META = {
    stopped:  { dot: T.text4, label: 'Stopped' },
    starting: { dot: T.amber, label: 'Starting…' },
    running:  { dot: T.green, label: 'Running' },
    failed:   { dot: T.red,   label: 'Failed' },
  }[status];

  // ── primary run/stop control (state baked in, never ambiguous) ──
  const PrimaryRun = () => {
    if (status === 'stopped' || status === 'failed') {
      return (
        <button onClick={start} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 11px 0 9px',
          borderRadius: 8, border: 'none', cursor: 'pointer', background: T.green, color: '#fff',
          fontFamily: FONT, fontSize: 12, fontWeight: 600, letterSpacing: -0.1, flexShrink: 0,
        }}>
          <Icon name="play.fill" size={11} color="#fff"/>Run
        </button>
      );
    }
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <button onClick={stop} title="Stop" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px 0 8px',
          borderRadius: 8, border: `0.5px solid ${T.border}`, cursor: 'pointer', background: T.content2, color: T.text,
          fontFamily: FONT, fontSize: 12, fontWeight: 600, letterSpacing: -0.1,
        }}>
          <Icon name="stop.fill" size={10} color={T.red}/>Stop
        </button>
        <PvToolBtn icon="arrow.clockwise" title="Restart" onClick={restart}/>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, background: T.content2, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Run bar — primary control + status; browser-style URL for previews */}
      <div style={{ minHeight: 38, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 8, borderBottom: `0.5px solid ${T.hairline}`, background: T.content }}>
        <PrimaryRun/>
        {hasPreview ? (
          // browser-style address bar = the running identity
          <div style={{
            flex: 1, minWidth: 0, height: 26, borderRadius: 8,
            border: `0.5px solid ${T.border}`, background: T.content2,
            display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px 0 2px',
          }}>
            <button title="Reload" onClick={restart} disabled={!isRunning} style={{
              width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent',
              cursor: isRunning ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isRunning ? 1 : 0.4,
            }}
            onMouseEnter={(e) => { if (isRunning) e.currentTarget.style.background = T.rowHover; }}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <Icon name="refresh" size={13} color={T.text2}/>
            </button>
            <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginLeft: 2, background: STATUS_META.dot }} className={isRunning ? 'tw-pulse' : ''}/>
            <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 11, color: isRunning ? T.text2 : T.text4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' }}>
              {isRunning ? `localhost${cfg.url.replace(/^localhost/, '').length ? cfg.url.replace('localhost','') : ''}` : cfg.url}{isRunning ? '' : ''}
            </span>
            <button title="Open in browser" disabled={!isRunning} style={{
              width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent',
              cursor: isRunning ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isRunning ? 1 : 0.4,
            }}
            onMouseEnter={(e) => { if (isRunning) e.currentTarget.style.background = T.rowHover; }}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <Icon name="pop" size={12} color={T.text3}/>
            </button>
            <button title="Clear cache & session data" onClick={() => restart()} disabled={!isRunning} style={{
              width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent',
              cursor: isRunning ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isRunning ? 1 : 0.4,
            }}
            onMouseEnter={(e) => { if (isRunning) e.currentTarget.style.background = T.rowHover; }}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <Icon name="eraser" size={13} color={T.text3}/>
            </button>
          </div>
        ) : (
          // console-only configs: just status text, console owns the surface
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.text3, flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_META.dot }} className={isRunning ? 'tw-pulse' : ''}/>
            {STATUS_META.label}
          </span>
        )}

        {/* device toggle + capture cluster — only meaningful for a running preview */}
        {hasPreview && (
          <React.Fragment>
            <div style={{ display: 'flex', gap: 1, padding: 2, borderRadius: 6, background: T.chipBg, flexShrink: 0 }}>
              {[['desktop', 'frame'], ['mobile', 'smartphone']].map(([m, ic]) => (
                <button key={m} title={m === 'mobile' ? 'Mobile (390×844)' : 'Desktop'} onClick={() => setMobile(m === 'mobile')} style={{
                  width: 24, height: 20, borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: (mobile ? m === 'mobile' : m === 'desktop') ? T.tabBarActive : 'transparent',
                  boxShadow: (mobile ? m === 'mobile' : m === 'desktop') ? `0 0.5px 0 ${T.border}, 0 1px 2px rgba(0,0,0,0.06)` : 'none',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name={ic} size={12} color={(mobile ? m === 'mobile' : m === 'desktop') ? T.text : T.text3}/>
                </button>
              ))}
            </div>
            {/* capture cluster — the unique value: feeds the chat. Labeled, grouped, accent-tinted. */}
            <div title="Capture for chat" style={{
              display: 'flex', alignItems: 'center', gap: 1, padding: '1px 4px 1px 7px', borderRadius: 8,
              background: isRunning ? `${ACCENT}0e` : 'transparent', border: `0.5px solid ${isRunning ? ACCENT + '33' : 'transparent'}`,
              flexShrink: 0, opacity: isRunning ? 1 : 0.4, pointerEvents: isRunning ? 'auto' : 'none',
            }}>
              <Icon name="arrow.up" size={9} color={ACCENT} stroke={2.4}/>
              <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT, letterSpacing: 0.3, textTransform: 'uppercase', marginRight: 2 }}>Chat</span>
              <PvToolBtn icon="locate" title="Pick element" on={inspecting} onClick={() => setInspecting(v => !v)}/>
              <PvToolBtn icon="camera" title="Screenshot" onClick={() => {}}/>
              <PvToolBtn icon="frame" title="Region capture" on={region} onClick={() => setRegion(v => !v)}/>
            </div>
          </React.Fragment>
        )}
      </div>

      {/* Webview region — only for preview configs */}
      {hasPreview && (
        <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, overflow: 'hidden' }}>
          {status === 'stopped' && (
            <button onClick={start} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '20px 26px',
              borderRadius: 13, border: 'none', background: 'transparent', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.rowHover; e.currentTarget.querySelector('.pv-run-ring').style.borderColor = T.green; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.querySelector('.pv-run-ring').style.borderColor = T.border; }}>
              <span className="pv-run-ring" style={{ width: 40, height: 40, borderRadius: '50%', border: `1px solid ${T.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 120ms ease' }}>
                <Icon name="play.fill" size={15} color={T.green}/>
              </span>
              <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: T.text2, letterSpacing: -0.1 }}>Run {cfg.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4 }}>launches {cfg.url}</span>
            </button>
          )}
          {starting && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.text3 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', border: `1.5px solid ${T.text3}`, borderTopColor: 'transparent', animation: 'tw-spin 0.9s linear infinite' }}/>
              Waiting for {cfg.url}…
            </span>
          )}
          {isRunning && (
            <div style={{
              width: mobile ? 230 : '100%', height: '100%', maxHeight: mobile ? 420 : 'none',
              borderRadius: mobile ? 22 : 8, overflow: 'hidden', background: '#fff',
              border: `0.5px solid ${T.border}`, boxShadow: mobile ? '0 12px 32px rgba(0,0,0,0.22)' : 'none',
              outline: inspecting ? `2px solid ${ACCENT}` : 'none', outlineOffset: -2, position: 'relative',
            }}>
              {inspecting && <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, fontFamily: MONO, fontSize: 10, fontWeight: 700, color: '#fff', background: ACCENT, padding: '2px 7px', borderRadius: 6 }}>CLICK AN ELEMENT</div>}
              <div style={{ padding: '22px 20px' }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>Mainframe</div>
                <div style={{ fontSize: 11, color: T.text3, fontFamily: MONO, marginTop: 2 }}>{cfg.name} · running</div>
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {['Prepare PR Test Worktree', 'Generate Code Insights', 'Execute Plan Mode'].map((t, i) => (
                    <div key={i} style={{ padding: '9px 11px', background: T.content2, borderRadius: 8, border: `0.5px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 600, color: T.text }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: i === 0 ? ACCENT : T.text4 }} className={i === 0 ? 'tw-pulse' : ''}/>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Console — smart drawer for previews (collapsed tail), full panel for console-only configs */}
      {hasPreview ? (
        <div style={{ flexShrink: 0, borderTop: `0.5px solid ${T.hairline}`, display: 'flex', flexDirection: 'column' }}>
          <button onClick={() => setLogOpen(v => !v)} style={{
            height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 12px',
            border: 'none', background: 'transparent', cursor: 'pointer', width: '100%', textAlign: 'left',
          }}>
            <Icon name="chevron.down" size={11} color={T.text3} style={{ transform: logOpen ? 'none' : 'rotate(-90deg)', flexShrink: 0 }}/>
            <span style={{ fontSize: 11, color: T.text2, fontWeight: 600, flexShrink: 0 }}>Console</span>
            {isRunning && <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4, background: T.chipBg, padding: '1px 6px', borderRadius: 8, flexShrink: 0 }}>{logLines.length} logs</span>}
            {!logOpen && (
              <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 10, color: T.text4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tail}</span>
            )}
            <div style={{ flex: logOpen ? 1 : 0 }}/>
            <span onClick={(e) => { e.stopPropagation(); }} style={{ display: 'inline-flex', flexShrink: 0 }}>
              <PvToolBtn icon="trash" title="Clear logs" onClick={() => {}}/>
            </span>
          </button>
          {logOpen && (
            <div style={{ height: 110, overflowY: 'auto', padding: '0 12px 10px', fontFamily: MONO, fontSize: 11, lineHeight: 1.6 }}>
              {logLines.length ? logLines.map((l, i) => <div key={i} style={{ color: l.c }}>{l.t}</div>) : <span style={{ color: T.text3 }}>No output yet.</span>}
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: 'none' }}>
          <div style={{ height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 0 12px' }}>
            <span style={{ fontSize: 11, color: T.text2, fontWeight: 600 }}>Console{isRunning && <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4, background: T.chipBg, padding: '1px 6px', borderRadius: 8, marginLeft: 8 }}>{logLines.length} logs</span>}</span>
            <PvToolBtn icon="trash" title="Clear logs" onClick={() => {}}/>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 10px', fontFamily: MONO, fontSize: 11, lineHeight: 1.6 }}>
            {logLines.length ? logLines.map((l, i) => <div key={i} style={{ color: l.c }}>{l.t}</div>) : <span style={{ color: T.text3 }}>No output yet.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Diff pane ─────────────────────────────────────────────────────────
function DiffPane() {
  const lines = [
    { n: 23, t: <>      <span style={{ color: T.codeFg }}>{`<Sidebar />`}</span></>, k: 'context' },
    { n: 24, t: <>      <span style={{ color: T.codeKw }}>{`<WorkspaceArea`}</span> <span style={{ color: T.codeFg }}>/{`>`}</span></>, k: 'context' },
    { o: 25, t: <>-     <span style={{ color: T.codeKw }}>{`<Inspector`}</span> <span style={{ color: T.codeFg }}>/{`>`}</span></>, k: 'del' },
    { n: 25, t: <>+     <span style={{ color: T.codeKw }}>{`<Inspector`}</span> collapsible <span style={{ color: T.codeFg }}>/{`>`}</span></>, k: 'add' },
    { n: 26, t: <>    <span style={{ color: T.codeFg }}>{`</div>`}</span></>, k: 'context' },
  ];
  return (
    <div style={{
      flex: 1, minHeight: 0, background: T.content, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', fontFamily: MONO, fontSize: 11,
    }}>
      <div style={{
        height: 28, flexShrink: 0, padding: '0 6px 0 12px',
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: FONT, fontSize: 11, color: T.text2,
        borderBottom: `0.5px solid ${T.hairline}`, background: T.content2,
      }}>
        <Icon name="branch" size={11} color={T.text3}/>
        <span style={{ color: T.text, fontWeight: 600, flexShrink: 0 }}>Layout.tsx</span>
        <span style={{
          color: T.text4, fontFamily: MONO, fontSize: 10, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>src/renderer/components/</span>
        <div style={{ flex: 1, minWidth: 8 }}/>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, fontFamily: MONO, fontSize: 10 }}>
          <span style={{ color: T.green, fontWeight: 600 }}>+1</span>
          <span style={{ color: T.red, fontWeight: 600 }}>−1</span>
        </span>
        <div style={{ width: 1, height: 13, background: T.border, margin: '0 1px' }}/>
        <button title="Reveal in file tree" style={{
          width: 22, height: 20, borderRadius: 6, border: 'none', background: 'transparent',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon name="locate" size={12} color={T.text2}/>
        </button>
      </div>
      <div style={{ padding: '6px 0' }}>
        {lines.map((l, i) => (
          <div key={i} style={{
            display: 'flex', minHeight: 18,
            background: l.k === 'add' ? 'rgba(40,167,69,0.08)'
              : l.k === 'del' ? 'rgba(220,53,69,0.08)' : 'transparent',
          }}>
            <div style={{ width: 30, textAlign: 'right', paddingRight: 6,
              color: T.text4, fontSize: 10 }}>{l.o ?? ''}</div>
            <div style={{ width: 30, textAlign: 'right', paddingRight: 8,
              color: T.text4, fontSize: 10 }}>{l.n ?? ''}</div>
            <div style={{ flex: 1, color: T.codeFg }}>{l.t}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
