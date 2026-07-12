// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Automations v2 · RUNTIME SURFACES
// Library (list · trigger summary · last-run · on/off · Run now) + blank
// state with the two creation paths + the Describe-it (NL→blocks) flow,
// the Run view (timeline · paused-on-form · failed) and Notifications.
// Feature label stays "Workflows". Depends on: 01-base, wf2-base,
// wf2-fields, wf2-seeds, wf2-editor (WfChipText, WfEditor).
// → window.WfLibrary, WfBlankState, WfDescribeFlow, WfRunView, WfNotifications
// ════════════════════════════════════════════════════════════════

function wf2TriggerSummary(triggers) {
  return (triggers || []).map((t, i) => {
    const m = WF2_TRIGGER_META[t.kind];
    const label = t.kind === 'schedule' ? (t.label || 'On a schedule') : t.kind === 'event' ? ((WF2_EVENTS.find(e => e.id === t.event) || {}).label || 'On an event') : m.label;
    return (
      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: RADIUS.full, background: wf2Rgba(m.color, 0.1), color: m.color, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}>
        <Icon name={m.icon} size={10} color={m.color}/>{label}
      </span>
    );
  });
}
function WfLastRunPill({ run }) {
  if (!run) return <span style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text4 }}>Never run</span>;
  const s = WF2_RUN_STATUS[run.status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, color: s.color }}>
      {run.status === 'running' ? <span style={{ width: 8, height: 8, borderRadius: '50%', border: `1.5px solid ${s.color}`, borderTopColor: 'transparent', animation: 'tw-spin .9s linear infinite' }}/> : <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }}/>}
      {s.label} <span style={{ color: T.text4, fontWeight: 500 }}>· {run.started}</span>
    </span>
  );
}

// ── Library ───────────────────────────────────────────────────────────
function WfLibrary({ automations = WF2_AUTOMATIONS, runs = WF2_RUNS_SEED, onNew, onEdit, onRun, onOpenRun }) {
  const [list, setList] = React.useState(automations);
  const lastRun = (id) => runs.find(r => r.automationId === id);
  const toggle = (id) => setList(l => l.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: T.content }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `0.5px solid ${T.hairline}` }}>
        <Icon name="bolt" size={16} color={ACCENT}/>
        <span style={{ flex: 1, fontFamily: FONT, fontSize: FS.title, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>Workflows</span>
        <button onClick={onNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', borderRadius: RADIUS.md, border: 'none', background: ACCENT, cursor: 'pointer', color: '#fff', fontFamily: FONT, fontSize: FS.label, fontWeight: 600 }}><Icon name="plus" size={12} color="#fff" stroke={2.2}/>New</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {list.map(a => (
          <WfLibraryRow key={a.id} a={a} run={lastRun(a.id)} onToggle={() => toggle(a.id)} onEdit={() => onEdit && onEdit(a)} onRun={() => onRun && onRun(a)} onOpenRun={onOpenRun}/>
        ))}
      </div>
    </div>
  );
}
function WfLibraryRow({ a, run, onToggle, onEdit, onRun, onOpenRun }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 16px', borderBottom: `0.5px solid ${T.hairline}`, background: hover ? T.rowHover : 'transparent', opacity: a.enabled ? 1 : 0.62 }}>
      <span style={{ width: 34, height: 34, borderRadius: RADIUS.md, background: wf2Rgba(ACCENT, 0.1), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="bolt" size={16} color={ACCENT}/></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: FONT, fontSize: FS.body, fontWeight: 600, color: T.text, letterSpacing: -0.1 }}>{a.name}</span>
          <span style={{ height: 16, padding: '0 6px', borderRadius: RADIUS.xs, background: T.chipBg, color: T.text3, fontFamily: FONT, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, display: 'inline-flex', alignItems: 'center' }}>{a.scope === 'global' ? 'Global' : 'Project'}</span>
        </div>
        <div style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, flexWrap: 'wrap' }}>{wf2TriggerSummary(a.triggers)}<span style={{ marginLeft: 2 }} onClick={() => run && onOpenRun && onOpenRun(run)}><WfLastRunPill run={run}/></span></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button onClick={onRun} title="Run now" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 11px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: hover ? T.content : 'transparent', cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}><Icon name="play.fill" size={10} color={ACCENT}/>Run</button>
        <WfIconBtn icon="pencil" onClick={onEdit}/>
        <WfToggle on={a.enabled} onChange={onToggle}/>
      </div>
    </div>
  );
}

// ── Blank state — two creation paths ──────────────────────────────────
function WfBlankState({ onDescribe, onBuild }) {
  const Card = ({ icon, color, title, body, cta, onClick }) => (
    <button onClick={onClick} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, padding: 22, borderRadius: RADIUS.xl, border: `0.5px solid ${T.border}`, background: T.content, cursor: 'pointer', textAlign: 'left', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = wf2Rgba(color, 0.5); e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)'; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)'; }}>
      <span style={{ width: 42, height: 42, borderRadius: RADIUS.lg, background: wf2Rgba(color, 0.12), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={21} color={color}/></span>
      <span style={{ fontFamily: FONT, fontSize: FS.heading, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>{title}</span>
      <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text2, lineHeight: 1.5, flex: 1 }}>{body}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color, fontFamily: FONT, fontSize: FS.label, fontWeight: 600 }}>{cta}<Icon name="chevron.right" size={11} color={color}/></span>
    </button>
  );
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, background: T.content, padding: 32 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: RADIUS.xl, background: wf2Rgba(ACCENT, 0.1), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><Icon name="bolt" size={26} color={ACCENT}/></div>
        <div style={{ fontFamily: FONT, fontSize: FS.title, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>Create a workflow</div>
        <div style={{ fontFamily: FONT, fontSize: FS.body, color: T.text3, marginTop: 4 }}>Automate the repetitive parts of your day.</div>
      </div>
      <div style={{ display: 'flex', gap: 16, width: '100%', maxWidth: 620 }}>
        <Card icon="wand.sparkles" color={ACCENT} title="Describe it" body="Say what you want in plain English. I’ll draft the When and Do steps — you tweak from there." cta="Describe" onClick={onDescribe}/>
        <Card icon="sliders" color="#7a4d9e" title="Build it" body="Start from a trigger and add steps yourself from the menu and action catalog." cta="Build" onClick={onBuild}/>
      </div>
    </div>
  );
}

// ── Describe-it (NL → drafted blocks) ─────────────────────────────────
function WfDescribeFlow({ onOpenEditor }) {
  const [text, setText] = React.useState('Every evening ask me about the kid’s health and log it to Notion');
  const [drafted, setDrafted] = React.useState(false);
  const draft = WF2_AUTOMATIONS[0]; // health-log mock
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.content, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '18px 20px 14px', borderBottom: `0.5px solid ${T.hairline}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
          <Icon name="wand.sparkles" size={16} color={ACCENT}/>
          <span style={{ fontFamily: FONT, fontSize: FS.heading, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>Describe your workflow</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minHeight: 54, resize: 'none', boxSizing: 'border-box', padding: '10px 12px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content2, outline: 'none', fontFamily: FONT, fontSize: FS.body, lineHeight: 1.5, color: T.text }}/>
          <button onClick={() => setDrafted(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, padding: '0 15px', borderRadius: RADIUS.md, border: 'none', background: ACCENT, cursor: 'pointer', color: '#fff', fontFamily: FONT, fontSize: FS.label, fontWeight: 600, flexShrink: 0 }}><Icon name="wand.sparkles" size={13} color="#fff"/>Draft it</button>
        </div>
      </div>
      {drafted ? (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '16px 20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, fontFamily: FONT, fontSize: FS.caption, color: T.text3 }}><Icon name="sparkles" size={12} color={ACCENT}/>Here’s a draft. Open it to tweak anything.</div>
          <WfDraftPreview automation={draft}/>
          <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
            <button onClick={() => onOpenEditor && onOpenEditor(draft)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 15px', borderRadius: RADIUS.md, border: 'none', background: ACCENT, cursor: 'pointer', color: '#fff', fontFamily: FONT, fontSize: FS.label, fontWeight: 600 }}><Icon name="sliders" size={12} color="#fff"/>Open in editor</button>
            <button onClick={() => setDrafted(false)} style={{ height: 34, padding: '0 14px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: 'transparent', cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: FS.label, fontWeight: 500 }}>Try a different description</button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: T.text3, padding: 24 }}>
          <Icon name="lightbulb" size={22} color={T.text4}/>
          <div style={{ fontFamily: FONT, fontSize: FS.caption, textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>The artifact is always an editable block list — never a buried prompt. Try “When a PR opens, review it and post a summary.”</div>
        </div>
      )}
    </div>
  );
}
// Read-only draft preview (When + Do block list).
function WfDraftPreview({ automation }) {
  const line = (verb, title, sub) => {
    const v = WF2_VERB[verb];
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content }}>
        <span style={{ width: 24, height: 24, borderRadius: RADIUS.sm, background: wf2Rgba(v.color, 0.13), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={v.icon} size={12} color={v.color}/></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: FS.label, fontWeight: 600, color: T.text }}>{title}</div>
          {sub && <div style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text3, marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ ...wf2Lbl, marginBottom: 7 }}>When</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{wf2TriggerSummary(automation.triggers)}</div>
      </div>
      <div>
        <div style={{ ...wf2Lbl, marginBottom: 7 }}>Do</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {automation.steps.map((s, i) => line(s.kind, s.title, s.kind === 'askme' ? (s.fields || []).map(f => f.label).filter(Boolean).join(', ') : s.kind === 'action' ? (wf2ActionById(s.actionId) || {}).name : ''))}
        </div>
      </div>
    </div>
  );
}

// ── Run view ──────────────────────────────────────────────────────────
function WfRunView({ run, onBack }) {
  const auto = WF2_AUTOMATIONS.find(a => a.id === run.automationId);
  const s = WF2_RUN_STATUS[run.status];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: T.content }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 11, padding: '13px 16px', borderBottom: `0.5px solid ${T.hairline}` }}>
        {onBack && <WfIconBtn icon="chevron.left" size={15} onClick={onBack}/>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: FS.heading, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>{run.name}</div>
          <div style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text3, marginTop: 1 }}>{run.trigger} · {run.started}</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 11px', borderRadius: RADIUS.full, background: wf2Rgba(s.color, 0.12), color: s.color, fontFamily: FONT, fontSize: FS.micro, fontWeight: 700 }}>
          {run.status === 'running' ? <span style={{ width: 8, height: 8, borderRadius: '50%', border: `1.5px solid ${s.color}`, borderTopColor: 'transparent', animation: 'tw-spin .9s linear infinite' }}/> : <Icon name={s.icon} size={11} color={s.color}/>}{s.label}
        </span>
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 12px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: 'transparent', cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}><Icon name="play.fill" size={10} color={ACCENT}/>Run again</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '14px 16px 22px' }}>
        {run.timeline.map((st, i) => <WfRunStep key={i} step={st} auto={auto} last={i === run.timeline.length - 1}/>)}
      </div>
    </div>
  );
}
function WfRunStep({ step, auto, last, nested }) {
  const v = WF2_VERB[step.kind] || WF2_VERB.action;
  const st = WF2_RUN_STATUS[step.status] || WF2_RUN_STATUS.skipped;
  const [open, setOpen] = React.useState(step.status === 'waiting' || step.status === 'failed');
  const formStep = step.form && auto ? (auto.steps || []).find(x => x.id === step.form) : null;
  return (
    <div style={{ display: 'flex', gap: 11, position: 'relative' }}>
      {!nested && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%', background: wf2Rgba(st.color, 0.14), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
          {step.status === 'running' ? <span style={{ width: 10, height: 10, borderRadius: '50%', border: `1.5px solid ${st.color}`, borderTopColor: 'transparent', animation: 'tw-spin .9s linear infinite' }}/> : <Icon name={st.icon} size={11} color={st.color}/>}
        </span>
        {!last && <span style={{ flex: 1, width: 2, background: T.hairline, marginTop: 3, minHeight: 14 }}/>}
      </div>}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name={v.icon} size={13} color={v.color}/>
          <span style={{ flex: 1, fontFamily: FONT, fontSize: FS.body, fontWeight: 600, color: step.status === 'skipped' ? T.text3 : T.text }}>{step.title}</span>
          {step.continued && <span title="This step failed but the automation kept going" style={{ display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 8px', borderRadius: RADIUS.full, background: wf2Rgba(T.amber, 0.15), color: T.amber, fontFamily: FONT, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>Kept going</span>}
          {step.duration && <span style={{ fontFamily: MONO, fontSize: FS.micro, color: T.text3 }}>{step.duration}</span>}
          {(step.output || step.error || step.chat) && <WfIconBtn icon={open ? 'chevron.down' : 'chevron.right'} size={11} onClick={() => setOpen(o => !o)}/>}
        </div>
        {step.status === 'waiting' && formStep && (
          <div style={{ marginTop: 9 }}><WfRunForm step={formStep}/></div>
        )}
        {open && step.output && <div style={{ marginTop: 7, padding: '8px 11px', borderRadius: RADIUS.md, background: T.content2, border: `0.5px solid ${T.hairline}`, fontFamily: MONO, fontSize: FS.micro, color: T.text2, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{step.output}</div>}
        {open && step.error && <div style={{ marginTop: 7, padding: '9px 11px', borderRadius: RADIUS.md, background: wf2Rgba(T.red, 0.07), border: `0.5px solid ${wf2Rgba(T.red, 0.3)}`, fontFamily: FONT, fontSize: FS.caption, color: T.red, lineHeight: 1.5 }}><Icon name="exclamationmark.triangle" size={11} color={T.red}/> {step.error}</div>}
        {open && step.chat && <button style={{ marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 11px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: 'transparent', cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}><Icon name="chat" size={11} color={ACCENT}/>Open agent chat</button>}
        {step.children && (
          <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: `2px solid ${wf2Rgba(v.color, 0.3)}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {step.children.map((c, i) => <WfRunStep key={i} step={c} auto={auto} nested last/>)}
          </div>
        )}
      </div>
    </div>
  );
}
// Inline answer form for a paused Ask-me step.
function WfRunForm({ step }) {
  const [vals, setVals] = React.useState({});
  const set = (k, v) => setVals(s => ({ ...s, [k]: v }));
  const visible = (step.fields || []).filter(f => !f.when || vals[f.when.key] === f.when.equals);
  return (
    <div style={{ padding: 13, borderRadius: RADIUS.lg, border: `0.5px solid ${wf2Rgba(T.amber, 0.35)}`, background: wf2Rgba(T.amber, 0.05), display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ fontFamily: FONT, fontSize: FS.label, fontWeight: 700, color: T.text }}>{step.title}</div>
      {visible.map(f => (
        <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontFamily: FONT, fontSize: FS.caption, fontWeight: 600, color: T.text2 }}>{f.label || f.key}{f.required && <span style={{ color: T.red }}> *</span>}</label>
          {(f.type === 'choice') && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{f.options.map(o => <button key={o} onClick={() => set(f.key, o)} style={{ height: 28, padding: '0 12px', borderRadius: RADIUS.full, border: `0.5px solid ${vals[f.key] === o ? ACCENT : T.border}`, background: vals[f.key] === o ? wf2Rgba(ACCENT, 0.1) : T.content, color: vals[f.key] === o ? ACCENT : T.text2, cursor: 'pointer', fontFamily: FONT, fontSize: FS.caption, fontWeight: 600 }}>{o}</button>)}</div>}
          {(f.type === 'multi') && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{f.options.map(o => { const on = (vals[f.key] || []).includes(o); return <button key={o} onClick={() => set(f.key, on ? (vals[f.key] || []).filter(x => x !== o) : [...(vals[f.key] || []), o])} style={{ height: 28, padding: '0 12px', borderRadius: RADIUS.full, border: `0.5px solid ${on ? ACCENT : T.border}`, background: on ? wf2Rgba(ACCENT, 0.1) : T.content, color: on ? ACCENT : T.text2, cursor: 'pointer', fontFamily: FONT, fontSize: FS.caption, fontWeight: 600 }}>{o}</button>; })}</div>}
          {(f.type === 'number' || f.type === 'text') && <input value={vals[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} type={f.type === 'number' ? 'number' : 'text'} style={wf2Field({ height: 30 })}/>}
          {f.type === 'textarea' && <textarea value={vals[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} style={wf2Field({ minHeight: 52, resize: 'vertical' })}/>}
        </div>
      ))}
      <button style={{ alignSelf: 'flex-start', height: 30, padding: '0 15px', borderRadius: RADIUS.md, border: 'none', background: ACCENT, cursor: 'pointer', color: '#fff', fontFamily: FONT, fontSize: FS.label, fontWeight: 600 }}>Submit</button>
    </div>
  );
}

// ── Notifications ─────────────────────────────────────────────────────
function WfNotifications({ notifs = WF2_NOTIFS }) {
  const meta = { form: { icon: 'chat', color: T.amber }, done: { icon: 'checkmark', color: T.green }, failed: { icon: 'exclamationmark.triangle', color: T.red } };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 18, background: T.windowBg, height: '100%', boxSizing: 'border-box' }}>
      {notifs.map(n => {
        const m = meta[n.type];
        return (
          <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: RADIUS.lg, background: T.content, boxShadow: '0 8px 28px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.08)' }}>
            <span style={{ width: 34, height: 34, borderRadius: RADIUS.md, background: wf2Rgba(ACCENT, 0.1), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
              <Icon name="bolt" size={16} color={ACCENT}/>
              <span style={{ position: 'absolute', right: -3, bottom: -3, width: 16, height: 16, borderRadius: '50%', background: m.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${T.content}` }}><Icon name={m.icon} size={8} color="#fff" stroke={2.4}/></span>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: FONT, fontSize: FS.label, fontWeight: 700, color: T.text }}>{n.title}</span>
                <span style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text4, marginLeft: 'auto' }}>{n.when}</span>
              </div>
              <div style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text2, marginTop: 3, lineHeight: 1.45 }}>{n.body}</div>
              <button style={{ marginTop: 9, height: 26, padding: '0 12px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: 'transparent', cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}>{n.action}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { WfLibrary, WfLibraryRow, WfBlankState, WfDescribeFlow, WfDraftPreview, WfRunView, WfRunStep, WfRunForm, WfNotifications, wf2TriggerSummary });
