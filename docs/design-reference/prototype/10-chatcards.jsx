// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Interactive chat-flow cards
// Four stateful cards the assistant injects mid-conversation:
//   · ThinkingBlock      — collapsible reasoning ("Thought for Ns")
//   · AskUserQuestionCard — assistant asks; user picks an option
//   · PermissionCard     — tool/command needs approval (allow/deny)
//   · PlanApprovalCard    — multi-step plan; approve & run / keep planning
// All warm-chrome (T.* tokens), all locally stateful. Loaded after 09.
// Exposed on window so ChatTranscript (09) can weave them in.
// ════════════════════════════════════════════════════════════════

// ── Small shared bits ──────────────────────────────────────────────
function CardShell({ accent, children, resolved }) {
  return (
    <div style={{
      maxWidth: 680, borderRadius: 13, background: T.content,
      border: `0.5px solid ${resolved ? T.border : T.borderH}`,
      boxShadow: resolved ? 'none' : `0 1px 0 rgba(0,0,0,0.02), 0 6px 22px -12px ${accent}55`,
      overflow: 'hidden', transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
    }}>{children}</div>
  );
}

function CardHead({ icon, accent, eyebrow, title, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px 9px' }}>
      <span style={{
        width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: `${accent}18`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={15} color={accent}/>
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
        <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: accent }}>{eyebrow}</span>
        <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: -0.15, lineHeight: 1.3 }}>{title}</span>
      </div>
      {right}
    </div>
  );
}

function ResolvedPill({ tone, label, icon }) {
  const c = tone === 'good' ? T.green : tone === 'bad' ? T.red : T.text3;
  return (
    <span className="tw-slidein" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      fontFamily: FONT, fontSize: 11, fontWeight: 600, color: c,
      background: `${c}14`, padding: '3px 9px 3px 7px', borderRadius: 20,
    }}>
      <Icon name={icon} size={11} color={c} stroke={2.2}/>{label}
    </span>
  );
}

// A pressable button used across the cards.
function CardBtn({ kind = 'ghost', accent = ACCENT, children, onClick, icon, flex, style }) {
  const [hov, setHov] = React.useState(false);
  const primary = kind === 'primary';
  const danger = kind === 'danger';
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    fontFamily: FONT, fontSize: 12, fontWeight: 600, letterSpacing: -0.1,
    padding: '7px 14px', borderRadius: 8, cursor: 'pointer', userSelect: 'none',
    border: '0.5px solid transparent', whiteSpace: 'nowrap', flex: flex ? 1 : 'none',
    transition: 'background 0.12s, border-color 0.12s, transform 0.06s',
  };
  let st;
  if (primary) st = { ...base, background: hov ? accent : accent, color: '#fff', boxShadow: hov ? `0 2px 10px -2px ${accent}88` : 'none', filter: hov ? 'brightness(1.06)' : 'none' };
  else if (danger) st = { ...base, background: hov ? `${T.red}12` : 'transparent', color: T.red, borderColor: hov ? `${T.red}40` : T.border };
  else st = { ...base, background: hov ? T.rowHover : T.content, color: T.text, borderColor: T.border };
  return (
    <button onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.97)'}
      onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
      onClick={onClick} style={{ ...st, ...style }}>
      {icon && <Icon name={icon} size={13} color={primary ? '#fff' : danger ? T.red : T.text2} stroke={2}/>}
      {children}
    </button>
  );
}

// ── 1. ThinkingBlock ───────────────────────────────────────────────
function ThinkingBlock({ seconds = 7, paragraphs = [], live, defaultOpen }) {
  const [open, setOpen] = React.useState(defaultOpen || false);
  return (
    <div style={{ maxWidth: 680, margin: '0 0 14px' }}>
      <div onClick={() => !live && setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, cursor: live ? 'default' : 'pointer',
        padding: '3px 4px', borderRadius: 8, userSelect: 'none',
      }}
        onMouseEnter={(e) => { if (!live) e.currentTarget.style.background = T.rowHover; }}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <Icon name="sparkles" size={13} color={live ? ACCENT : T.text3}/>
        {live
          ? <span className="tw-shimmer" style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>Thinking…</span>
          : <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: T.text2 }}>Thought for {seconds} seconds</span>}
        {!live && <Icon name={open ? 'chevron.down' : 'chevron.right'} size={10} color={T.text3}/>}
      </div>
      {open && !live && (
        <div className="tw-slidein" style={{ marginTop: 6, marginLeft: 10, paddingLeft: 14, borderLeft: `2px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
          {paragraphs.map((p, i) => (
            <p key={i} style={{ margin: 0, fontFamily: FONT, fontSize: 12, lineHeight: 1.6, color: T.text3, letterSpacing: -0.05 }}>{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 2. AskUserQuestionCard ─────────────────────────────────────────
// options: [{ label, hint }]. Props:
//   · multi      — checkbox multi-select (needs Submit). Default single-select.
//   · allowOther — append an "Other…" row with a free-text input.
// Single-select resolves on click (unless "Other"); multi/Other resolve on
// Submit. Once resolved the card is frozen in its answered state.
function AskUserQuestionCard({ question, context, options = [], multi = false, allowOther = false, defaultAnswer = null, onAnswer }) {
  const OTHER = options.length;                 // synthetic index for the Other row
  const rows = allowOther ? [...options, { label: 'Other', other: true }] : options;
  const [sel, setSel] = React.useState(defaultAnswer != null ? (multi ? defaultAnswer : defaultAnswer) : (multi ? [] : null));
  const [otherText, setOtherText] = React.useState('');
  const [done, setDone] = React.useState(defaultAnswer != null);
  const inputRef = React.useRef(null);

  const isSel = (i) => multi ? sel.includes(i) : sel === i;
  const otherActive = allowOther && isSel(OTHER);
  const trimmed = otherText.trim();

  const labelFor = (i) => (i === OTHER ? trimmed : options[i].label);
  const canSubmit = multi
    ? sel.length > 0 && (!otherActive || trimmed)
    : sel != null && (sel !== OTHER || trimmed);
  // A persistent submit row is shown for multi, or single-select once "Other" is picked.
  const needsSubmit = multi || otherActive;

  const focusOther = () => setTimeout(() => inputRef.current && inputRef.current.focus(), 0);

  const finish = (answer) => { if (done) return; setDone(true); onAnswer && onAnswer(answer); };

  const click = (i) => {
    if (done) return;
    if (multi) {
      setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
      if (i === OTHER) focusOther();
    } else {
      setSel(i);
      if (i === OTHER) focusOther();
      else finish(options[i].label);          // single non-Other resolves immediately
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    finish(multi ? sel.map(labelFor) : labelFor(sel));
  };

  // Answer summary shown in the resolved pill area / footer.
  const chosenLabels = multi ? sel.map(labelFor) : (sel != null ? [labelFor(sel)] : []);

  return (
    <div style={{ margin: '0 0 16px' }}>
      <CardShell accent={ACCENT} resolved={done}>
        <CardHead icon="chat" accent={ACCENT}
          eyebrow={multi ? 'Question · select all that apply' : 'Question'} title={question}
          right={done ? <ResolvedPill tone="neutral" icon="checkmark" label="Answered"/> : null}/>
        {context && (
          <div style={{ padding: '0 14px 4px 49px', marginTop: -4 }}>
            <span style={{ fontFamily: FONT, fontSize: 12, color: T.text3, lineHeight: 1.5 }}>{context}</span>
          </div>
        )}
        <div style={{ padding: '6px 11px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((o, i) => {
            const sof = isSel(i);
            const dim = done && !sof;
            const showInput = o.other && otherActive;        // reveal text field
            return (
              <div key={i} style={{
                borderRadius: 8, background: sof ? T.selBg : 'transparent',
                border: `0.5px solid ${sof ? ACCENT : T.border}`,
                opacity: dim ? 0.45 : 1, transition: 'background 0.15s, border-color 0.15s, opacity 0.2s',
              }}>
                <button onClick={() => click(i)} disabled={done} style={{
                  display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
                  padding: '9px 11px', background: 'transparent', border: 'none',
                  borderRadius: 8, cursor: done ? 'default' : 'pointer',
                }}
                  onMouseEnter={(e) => { if (!done) e.currentTarget.parentNode.style.background = sof ? T.selBg : T.rowHover; }}
                  onMouseLeave={(e) => { if (!done) e.currentTarget.parentNode.style.background = sof ? T.selBg : 'transparent'; }}>
                  {multi ? (
                    <span style={{
                      width: 17, height: 17, borderRadius: 5, flexShrink: 0,
                      border: `${sof ? 0 : 1.5}px solid ${T.text4}`, background: sof ? ACCENT : 'transparent',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.12s, border-color 0.12s',
                    }}>{sof && <Icon name="checkmark" size={11} color="#fff" stroke={2.6}/>}</span>
                  ) : (
                    <span style={{
                      width: 17, height: 17, borderRadius: '50%', flexShrink: 0,
                      border: `${sof ? 5 : 1.5}px solid ${sof ? ACCENT : T.text4}`,
                      transition: 'border-width 0.15s, border-color 0.15s',
                    }}/>
                  )}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                    <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: -0.1 }}>
                      {o.other ? (done && trimmed ? trimmed : 'Other…') : o.label}
                    </span>
                    {!o.other && o.hint && <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3, lineHeight: 1.4 }}>{o.hint}</span>}
                    {o.other && !done && !showInput && <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3, lineHeight: 1.4 }}>Write your own answer</span>}
                  </span>
                </button>
                {showInput && !done && (
                  <div className="tw-slidein" style={{ padding: '0 11px 10px 39px' }}>
                    <input ref={inputRef} value={otherText} onChange={(e) => setOtherText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !multi && canSubmit) submit(); }}
                      placeholder="Type your answer…" style={{
                        width: '100%', boxSizing: 'border-box', fontFamily: FONT, fontSize: 13, color: T.text,
                        padding: '7px 10px', borderRadius: 7, background: T.content,
                        border: `1px solid ${T.borderH}`, outline: 'none',
                      }}
                      onFocus={(e) => { e.target.style.borderColor = ACCENT; e.target.style.boxShadow = T.focusRing; }}
                      onBlur={(e) => { e.target.style.borderColor = T.borderH; e.target.style.boxShadow = 'none'; }}/>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Submit row — multi-select always; single-select only when Other is active */}
        {needsSubmit && !done && (
          <div className="tw-slidein" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 13px 13px' }}>
            <CardBtn kind="primary" icon="checkmark" onClick={submit}
              style={canSubmit ? null : { opacity: 0.45, pointerEvents: 'none' }}>
              {multi ? `Submit${sel.length ? ` · ${sel.length}` : ''}` : 'Submit answer'}
            </CardBtn>
            {multi && <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3 }}>Choose one or more</span>}
          </div>
        )}
        {/* Resolved footer — echoes the answer the assistant received */}
        {done && (
          <div className="tw-slidein" style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '0 14px 12px 49px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: T.text3 }}>You answered</span>
            <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: ACCENT, lineHeight: 1.4 }}>{chosenLabels.join(', ')}</span>
          </div>
        )}
      </CardShell>
    </div>
  );
}

// ── 3. PermissionCard ──────────────────────────────────────────────
// Mirrors the real ControlRequest: { toolName, input, suggestions }.
//   · toolName    — bare tool name (e.g. 'Bash', 'WriteFile').
//   · input       — raw tool params object; shown pretty-printed under "Details".
//   · suggestions — always-allow rules; when present, an "Always allow" button
//                   appears (otherwise just Deny · Allow once).
// No risk / scope / cwd / branch — none of that exists on the request.
function PermissionCard({ toolName = 'Bash', input = {}, suggestions = [], defaultOpen = false, onResolve }) {
  const [state, setState] = React.useState(null);   // 'once' | 'always' | 'deny'
  const [open, setOpen] = React.useState(defaultOpen);
  const resolve = (s) => { if (state) return; setState(s); onResolve && onResolve(s); };
  const denied = state === 'deny';
  const inputJson = JSON.stringify(input, null, 2);
  return (
    <div style={{ margin: '0 0 16px' }}>
      <CardShell accent={T.amber} resolved={!!state}>
        <CardHead icon="shield" accent={T.amber} eyebrow="Permission required" title="Permission Required"
          right={state ? (
            denied
              ? <ResolvedPill tone="bad" icon="xmark" label="Denied"/>
              : <ResolvedPill tone="good" icon="checkmark" label={state === 'always' ? 'Always allowed' : 'Allowed once'}/>
          ) : null}/>
        {/* Tool name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 8px 49px', marginTop: -4 }}>
          <Icon name="terminal" size={13} color={T.text3}/>
          <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: T.text2 }}>{toolName}</span>
        </div>
        {/* Details disclosure — pretty-printed raw input */}
        <div style={{ padding: '0 14px 12px 49px' }}>
          <button onClick={() => setOpen(o => !o)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 2px', border: 'none',
            background: 'transparent', cursor: 'pointer', fontFamily: FONT, fontSize: 12, color: T.text3,
          }}
            onMouseEnter={(e) => e.currentTarget.style.color = T.text}
            onMouseLeave={(e) => e.currentTarget.style.color = T.text3}>
            <Icon name={open ? 'chevron.down' : 'chevron.right'} size={11} color="currentColor"/>Details
          </button>
          {open && (
            <pre className="tw-slidein" style={{
              margin: '8px 0 0', padding: '9px 12px', borderRadius: 8, background: T.termBg,
              fontFamily: MONO, fontSize: 11.5, lineHeight: 1.55, color: T.termFg,
              whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 240, overflowY: 'auto',
            }}>{inputJson}</pre>
          )}
        </div>
        {!state && (
          <div style={{ display: 'flex', gap: 8, padding: '0 13px 13px', alignItems: 'center' }}>
            <CardBtn kind="danger" onClick={() => resolve('deny')}>Deny</CardBtn>
            <div style={{ flex: 1 }}/>
            <CardBtn onClick={() => resolve('once')}>Allow once</CardBtn>
            {suggestions.length > 0 && (
              <CardBtn kind="primary" accent={T.amber} onClick={() => resolve('always')}>Always allow</CardBtn>
            )}
          </div>
        )}
      </CardShell>
    </div>
  );
}

// ── 4. PlanApprovalCard ────────────────────────────────────────────
// steps: [{ text, files? }]. Approve runs; keep-planning dismisses to edit.
// Footer carries an exec-mode selector + a "clear context" checkbox, mirroring
// the source card's run controls (Interactive / Auto-edits / Unattended).
const EXEC_MODES = [
  { id: 'default',     label: 'Interactive', icon: 'shield', desc: 'Ask before each tool' },
  { id: 'acceptEdits', label: 'Auto-edits',  icon: 'pencil', desc: 'Apply edits, ask to run' },
  { id: 'yolo',        label: 'Unattended',  icon: 'bolt',   desc: 'Run everything, no prompts' },
];

function ExecModeSeg({ value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', padding: 2, gap: 2, background: T.raised, borderRadius: 8, border: `0.5px solid ${T.border}` }}>
      {EXEC_MODES.map((m) => {
        const on = value === m.id;
        const danger = m.id === 'yolo';
        const c = danger ? T.red : ACCENT;
        return (
          <button key={m.id} onClick={() => onChange(m.id)} title={m.desc} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 6,
            border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: -0.1,
            background: on ? T.content : 'transparent', color: on ? (danger ? T.red : T.text) : T.text3,
            boxShadow: on ? '0 1px 2px rgba(0,0,0,0.10)' : 'none', transition: 'background 0.12s, color 0.12s',
          }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = T.text2; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = T.text3; }}>
            <Icon name={m.icon} size={12} color={on ? c : T.text4}/>{m.label}
          </button>
        );
      })}
    </div>
  );
}

function ClearContextCheck({ checked, onChange }) {
  return (
    <label onClick={() => onChange(!checked)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }} title="Drop the current chat context before executing — the run starts fresh from the plan">
      <span style={{
        width: 16, height: 16, borderRadius: 6, flexShrink: 0,
        border: `1.5px solid ${checked ? ACCENT : T.text4}`, background: checked ? ACCENT : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.12s, border-color 0.12s',
      }}>
        {checked && <Icon name="checkmark" size={10} color="#fff" stroke={2.6}/>}
      </span>
      <span style={{ fontFamily: FONT, fontSize: 12, color: T.text2, fontWeight: 500 }}>Clear context</span>
    </label>
  );
}

function PlanApprovalCard({ title = 'Ready to implement', summary, steps = [], onResolve }) {
  const [state, setState] = React.useState(null); // 'approve' | 'revise'
  const [execMode, setExecMode] = React.useState('default');
  const [clearContext, setClearContext] = React.useState(false);
  const resolve = (s) => { if (state) return; setState(s); onResolve && onResolve(s, { execMode, clearContext }); };
  const modeLabel = (EXEC_MODES.find((m) => m.id === execMode) || EXEC_MODES[0]).label;
  return (
    <div style={{ margin: '0 0 16px' }}>
      <CardShell accent={ACCENT} resolved={!!state}>
        <CardHead icon="checklist.box" accent={ACCENT} eyebrow={`Plan · ${steps.length} steps`} title={title}
          right={state ? (
            state === 'approve'
              ? <ResolvedPill tone="good" icon="play.fill" label="Running"/>
              : <ResolvedPill tone="neutral" icon="pencil" label="Revising"/>
          ) : null}/>
        {summary && (
          <div style={{ padding: '0 14px 6px 49px', marginTop: -4 }}>
            <span style={{ fontFamily: FONT, fontSize: 12, color: T.text2, lineHeight: 1.55 }}>{summary}</span>
          </div>
        )}
        <div style={{ padding: '6px 14px 4px', display: 'flex', flexDirection: 'column' }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 11, padding: '7px 0', borderTop: i ? `0.5px solid ${T.hairline}` : 'none' }}>
              <span style={{
                width: 19, height: 19, flexShrink: 0, marginTop: 1, borderRadius: '50%',
                background: state === 'approve' ? `${ACCENT}1a` : T.raised, color: state === 'approve' ? ACCENT : T.text2,
                fontFamily: MONO, fontSize: 11, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, paddingTop: 1 }}>
                <span style={{ fontFamily: FONT, fontSize: 12, color: T.text, lineHeight: 1.45, letterSpacing: -0.1 }}>{s.text}</span>
                {s.files && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {s.files.map((f, j) => (
                      <code key={j} style={{ fontFamily: MONO, fontSize: 10, color: T.codeFn, background: T.content2, border: `0.5px solid ${T.border}`, padding: '1px 6px', borderRadius: 6 }}>{f}</code>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {!state && (
          <div style={{ padding: '8px 14px 13px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, background: T.content2, border: `0.5px solid ${T.border}` }}>
              <ExecModeSeg value={execMode} onChange={setExecMode}/>
              <div style={{ flex: 1, minWidth: 8 }}/>
              <ClearContextCheck checked={clearContext} onChange={setClearContext}/>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <CardBtn kind="primary" icon="play.fill" onClick={() => resolve('approve')} flex>Approve &amp; run</CardBtn>
              <CardBtn icon="pencil" onClick={() => resolve('revise')}>Keep planning</CardBtn>
            </div>
          </div>
        )}
        {state === 'approve' && (
          <div className="tw-slidein" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 13px', borderTop: `0.5px solid ${T.hairline}` }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: execMode === 'yolo' ? T.red : ACCENT }} className="tw-pulse"/>
            <span style={{ fontFamily: FONT, fontSize: 12, color: T.text3 }}>Executing in <b style={{ color: execMode === 'yolo' ? T.red : T.text2, fontWeight: 600 }}>{modeLabel}</b> mode{clearContext ? ' · context cleared' : ''} — starting step 1.</span>
          </div>
        )}
      </CardShell>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// System markers — centered pills the assistant emits mid-stream for
// out-of-band events (skill loads, worktree moves, schedules, MCP calls,
// context compaction). Redesigned as one cohesive warm-chrome "marker"
// family (not a per-card re-skin of the source): a quiet pill on the
// chat spine, accent token for the meaningful name, a pulsing dot while
// pending / red dot on error, and an optional disclosure body.
// Plus two inline cards: TaskGroupCard (subagent run) + TaskProgressCard.
// ════════════════════════════════════════════════════════════════

// Centered column that holds a marker pill (+ optional body card).
function MarkerWrap({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, maxWidth: 680, margin: '10px 0' }}>
      {children}
    </div>
  );
}

// The pill itself. state: undefined|'done'|'pending'|'error'.
function MarkerPill({ icon, iconColor, state = 'done', expandable, open, onClick, title, children }) {
  const [hov, setHov] = React.useState(false);
  const errored = state === 'error';
  const pending = state === 'pending';
  const clickable = expandable && !pending && !errored;
  return (
    <button title={title} disabled={!clickable} onClick={clickable ? onClick : undefined}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: '100%',
        padding: '4px 11px 4px 9px', borderRadius: 20, cursor: clickable ? 'pointer' : 'default',
        border: `0.5px solid ${errored ? `${T.red}45` : T.border}`,
        background: errored ? `${T.red}0c` : (hov && clickable ? T.rowHover : T.content2),
        fontFamily: MONO, fontSize: 11, color: T.text3, userSelect: 'none',
        whiteSpace: 'nowrap', overflow: 'hidden', transition: 'background 0.12s, border-color 0.12s',
      }}>
      <Icon name={icon} size={12} color={errored ? T.red : (iconColor || T.text4)}/>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{children}</span>
      {pending && <span className="tw-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: T.text4, flexShrink: 0 }}/>}
      {errored && <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.red, flexShrink: 0 }}/>}
      {clickable && <Icon name={open ? 'chevron.down' : 'chevron.right'} size={11} color={T.text4}/>}
    </button>
  );
}

// Disclosure body under a marker pill.
function MarkerBody({ children, pad = '10px 13px' }) {
  return (
    <div className="tw-slidein" style={{ width: '100%', borderRadius: 11, border: `0.5px solid ${T.border}`, background: T.content2, padding: pad, overflow: 'hidden' }}>
      {children}
    </div>
  );
}

function MarkerCapsLabel({ children }) {
  return <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: T.text3, marginBottom: 4 }}>{children}</div>;
}
function MarkerPre({ children, tone = T.text2 }) {
  return <pre style={{ margin: 0, fontFamily: MONO, fontSize: 11, lineHeight: 1.55, color: tone, whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>{children}</pre>;
}
const Accent = ({ children }) => <span style={{ color: ACCENT }}>{children}</span>;
const Faint = ({ children }) => <span style={{ color: T.text4 }}>{children}</span>;

// ── Compaction ─────────────────────────────────────────────────────
function CompactionPill() {
  return <MarkerWrap><MarkerPill icon="layers">Context compacted</MarkerPill></MarkerWrap>;
}

// ── Skill loaded (centered, expandable to its Markdown body) ────────
function SkillLoadedCard({ skillName, path, content, defaultOpen }) {
  const [open, setOpen] = React.useState(defaultOpen || false);
  const MDc = window.MD;
  return (
    <MarkerWrap>
      <MarkerPill icon="bolt" iconColor={ACCENT} expandable={!!content} open={open} onClick={() => setOpen(o => !o)} title={path}>
        Using skill: <Accent>{skillName}</Accent>
      </MarkerPill>
      {open && content && (
        <MarkerBody>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {MDc ? <MDc text={content}/> : <MarkerPre>{content}</MarkerPre>}
          </div>
        </MarkerBody>
      )}
    </MarkerWrap>
  );
}

// ── Slash command (inline line — assistant invoking a /skill) ───────
function SlashCommandCard({ skill, args }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 2px', margin: '2px 0 10px', maxWidth: 680 }}>
      <Icon name="bolt" size={13} color={ACCENT}/>
      <span style={{ fontFamily: MONO, fontSize: 12, color: ACCENT, flexShrink: 0 }}>/{skill}</span>
      {args && <span title={args} style={{ fontFamily: MONO, fontSize: 11, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{args}</span>}
    </div>
  );
}

// ── Worktree status ─────────────────────────────────────────────────
// action: 'enter'|'exit'; state: 'pending'|'done'|'error'; removed (exit only).
function WorktreeStatusPill({ action = 'enter', name, path, removed, state = 'done' }) {
  const isEnter = action === 'enter';
  let label;
  if (state === 'error') label = isEnter ? 'Failed to enter worktree' : 'Failed to exit worktree';
  else if (state === 'pending') label = isEnter ? 'Entering worktree…' : 'Exiting worktree…';
  else if (isEnter) label = <>Entered worktree: <Accent>{name}</Accent></>;
  else label = removed ? 'Removed worktree' : 'Exited worktree (kept)';
  return <MarkerWrap><MarkerPill icon="worktree" state={state} title={path}>{label}</MarkerPill></MarkerWrap>;
}

// ── Schedule / cron / monitor ───────────────────────────────────────
// kind: 'wakeup'|'create'|'delete'|'list'|'monitor'. state: 'pending'|'done'|'error'.
function SchedulePill(props) {
  const { kind = 'wakeup', state = 'done', delay, reason, schedule, recurring, durable, id, desc, jobs = [], monitorOut, defaultOpen } = props;
  const [open, setOpen] = React.useState(defaultOpen || false);
  const icons = { wakeup: 'clock', create: 'calendar', delete: 'calendar', list: 'calendar', monitor: 'activity' };
  let label = '', body = null;
  if (state === 'error') {
    label = `Failed: ${kind} schedule`;
  } else if (state === 'pending') {
    label = kind === 'wakeup' ? 'Scheduling wakeup…'
      : kind === 'create' ? 'Creating schedule…'
      : kind === 'delete' ? 'Removing schedule…'
      : kind === 'list' ? 'Listing schedules…'
      : <>Monitoring: <Accent>{desc}</Accent></>;
  } else if (kind === 'wakeup') {
    label = <>Will resume in <Accent>{delay}</Accent>{reason ? ` · ${reason}` : ''}</>;
  } else if (kind === 'create') {
    label = <>Scheduled: <Accent>{schedule}</Accent> · <Faint>{recurring ? 'recurring' : 'one-shot'}</Faint>{durable === false ? <Faint> · session-only</Faint> : null}</>;
  } else if (kind === 'delete') {
    label = <>Removed schedule · <Accent>{id}</Accent></>;
  } else if (kind === 'list') {
    label = <>Listed <Accent>{jobs.length}</Accent> scheduled job{jobs.length === 1 ? '' : 's'}</>;
    if (jobs.length) body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontFamily: MONO, fontSize: 11, color: T.text3, maxHeight: 280, overflowY: 'auto' }}>
        {jobs.map((j, i) => (
          <div key={i}>
            <div>• <Accent>{j.id}</Accent> {j.schedule} <Faint>({j.recurring ? 'recurring' : 'one-shot'}{j.durable === false ? ', session-only' : ''})</Faint></div>
            {j.prompt && <div style={{ paddingLeft: 12, color: T.text4 }}>prompt: {j.prompt}</div>}
          </div>
        ))}
      </div>
    );
  } else if (kind === 'monitor') {
    label = <>Stopped monitoring: <Accent>{desc}</Accent></>;
    if (monitorOut) body = <MarkerPre tone={T.text3}>{monitorOut}</MarkerPre>;
  }
  const expandable = !!body && state === 'done';
  return (
    <MarkerWrap>
      <MarkerPill icon={icons[kind]} state={state} expandable={expandable} open={open} onClick={() => setOpen(o => !o)}>{label}</MarkerPill>
      {open && expandable && <MarkerBody>{body}</MarkerBody>}
    </MarkerWrap>
  );
}

// ── MCP tool call ───────────────────────────────────────────────────
function MCPToolCard({ server, tool, args, result, state = 'done', defaultOpen }) {
  const [open, setOpen] = React.useState(defaultOpen || false);
  const verb = state === 'error' ? 'failed:' : state === 'pending' ? 'executing' : 'executed';
  const expandable = state === 'done';
  const argText = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
  return (
    <MarkerWrap>
      <MarkerPill icon="plug" state={state} expandable={expandable} open={open} onClick={() => setOpen(o => !o)} title={`${server} · ${tool}`}>
        {server} {verb} <Accent>{tool}</Accent>
      </MarkerPill>
      {open && expandable && (
        <MarkerBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div>
              <MarkerCapsLabel>Arguments</MarkerCapsLabel>
              <MarkerPre tone={T.text3}>{argText}</MarkerPre>
            </div>
            {result && (
              <div>
                <MarkerCapsLabel>Result</MarkerCapsLabel>
                <MarkerPre>{result}</MarkerPre>
              </div>
            )}
          </div>
        </MarkerBody>
      )}
    </MarkerWrap>
  );
}

// ── Task subagent group (inline, collapsible) ───────────────────────
function TaskGroupCard({ agent = 'Task', model, description, summary, prompt, result, state = 'done', defaultOpen, children }) {
  const [open, setOpen] = React.useState(defaultOpen || false);
  const [hov, setHov] = React.useState(false);
  return (
    <div style={{ maxWidth: 680, margin: '2px 0 14px' }}>
      <button onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
          padding: '7px 10px', borderRadius: 11, cursor: 'pointer',
          border: `0.5px solid ${T.border}`, background: open || hov ? T.content2 : T.content,
          transition: 'background 0.12s',
        }}>
        <span style={{ width: 24, height: 24, borderRadius: 8, flexShrink: 0, background: `${ACCENT}18`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bot" size={14} color={ACCENT}/>
        </span>
        <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: ACCENT, flexShrink: 0 }}>{agent}</span>
        {model && <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4, flexShrink: 0 }}>{model}</span>}
        <span style={{ fontFamily: FONT, fontSize: 12, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{description}</span>
        <span style={{ flex: 1, minWidth: 8 }}/>
        {state === 'error' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.red, flexShrink: 0 }}/>}
        {summary && <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4, flexShrink: 0, whiteSpace: 'nowrap' }}>{summary}</span>}
        <Icon name={open ? 'chevron.down' : 'chevron.right'} size={12} color={T.text4}/>
      </button>
      {open && (
        <div className="tw-slidein" style={{ marginLeft: 12, paddingLeft: 14, borderLeft: `2px solid ${T.border}`, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {prompt && <div style={{ fontFamily: FONT, fontSize: 12, fontStyle: 'italic', color: T.text3, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{prompt}</div>}
          {children}
          {result && <div style={{ fontFamily: FONT, fontSize: 12, color: T.text2, lineHeight: 1.55, whiteSpace: 'pre-wrap', paddingTop: 2 }}>{result}</div>}
        </div>
      )}
    </div>
  );
}

// ── Task progress checklist (inline) ────────────────────────────────
function TaskStatusIcon({ status }) {
  if (status === 'completed') return (
    <span style={{ width: 15, height: 15, borderRadius: 6, flexShrink: 0, background: `${T.green}22`, border: `1px solid ${T.green}66`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="checkmark" size={10} color={T.green} stroke={2.4}/>
    </span>
  );
  if (status === 'in_progress') return <span className="tw-pulse" style={{ width: 15, height: 15, borderRadius: 6, flexShrink: 0, background: ACCENT, border: `1px solid ${ACCENT}` }}/>;
  return <span style={{ width: 15, height: 15, borderRadius: 6, flexShrink: 0, border: `1.5px solid ${T.text4}` }}/>;
}

function TaskProgressCard({ items = [] }) {
  return (
    <div style={{ maxWidth: 680, margin: '6px 0 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((t, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '1px 2px' }}>
          <TaskStatusIcon status={t.status}/>
          <span style={{
            fontFamily: FONT, fontSize: 12, lineHeight: 1.4,
            color: t.status === 'completed' ? T.text4 : t.status === 'in_progress' ? T.text : T.text3,
            textDecoration: t.status === 'completed' ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{t.subject}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, {
  ThinkingBlock, AskUserQuestionCard, PermissionCard, PlanApprovalCard, CardBtn,
  CompactionPill, SkillLoadedCard, SlashCommandCard, WorktreeStatusPill,
  SchedulePill, MCPToolCard, TaskGroupCard, TaskProgressCard,
});
