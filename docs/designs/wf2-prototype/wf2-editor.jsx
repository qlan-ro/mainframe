// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Automations v2 · EDITOR
// The authoring surface: a When section (curated triggers) over a linear
// Do list. Steps are the four verbs; If/Repeat are blocks that nest a
// child Do list inline. Token scope is computed as the recipe renders and
// threaded into every card so the picker only ever offers in-scope values.
// Validation is plain-language and pinned to the offending step.
// Depends on: 01-base, wf2-base, wf2-fields, wf2-stepconfig.
// → window.WfEditor, WfRecipe, WfStepCard, wf2Validate
// ════════════════════════════════════════════════════════════════

let _wfsid = 0; const wf2sid = (k) => k + '_' + Date.now().toString(36) + (_wfsid++);
function wf2NewStep(kind) {
  const base = { id: wf2sid(kind), kind, title: WF2_VERB[kind].label };
  if (kind === 'agent') return { ...base, prompt: [], model: 'Claude Opus 4.6' };
  if (kind === 'askme') return { ...base, title: 'Ask me', fields: [{ key: 'answer', label: 'Answer', type: 'text' }] };
  if (kind === 'action') return { ...base, title: 'Run an action', actionId: null, args: {} };
  if (kind === 'notify') return { ...base, title: 'Notify me', message: [] };
  if (kind === 'if') return { ...base, title: 'If … otherwise', match: 'all', conditions: [{ token: null, comparator: 'is', value: '' }], then: [], else: null };
  if (kind === 'repeat') return { ...base, title: 'Repeat for each', list: [], steps: [] };
  return base;
}

// ── Validation (plain-language, scope-aware) ──────────────────────────
function wf2Validate(a) {
  const issues = [];
  if (!a.name || !a.name.trim()) issues.push({ level: 'error', msg: 'Give your automation a name.' });
  if (!a.steps || !a.steps.length) issues.push({ level: 'error', msg: 'Add at least one step under “Do”.' });
  const scanTokens = (step) => {
    const out = [];
    const eat = (v) => (v || []).forEach(p => { if (p && p.tok) out.push(p); });
    eat(step.prompt); eat(step.message); eat(step.list);
    if (step.args) Object.values(step.args).forEach(v => { if (Array.isArray(v)) eat(v); else if (v && typeof v === 'object') Object.values(v).forEach(x => Array.isArray(x) && eat(x)); });
    (step.conditions || []).forEach(c => { if (c.token && c.token.tok) out.push(c.token); });
    return out;
  };
  // Preorder walk: a step may use any token produced ABOVE it in document
  // order — including inside an earlier If branch (its results may or may
  // not be present at runtime; substitution is literal). An If shares the
  // running scope (branch results leak to later siblings); a Repeat gets an
  // isolated child scope so ⟨Current item⟩ never escapes the bracket.
  const walk = (steps, avail) => {
    (steps || []).forEach(s => {
      const label = s.title || WF2_VERB[s.kind].label;
      scanTokens(s).forEach(t => { const src = t.source || 'Other'; if (src !== 'Trigger' && src !== 'Built-in' && src !== 'Repeat' && !avail.has(src)) issues.push({ level: 'error', msg: `This step uses ⟨${t.label}⟩ from “${src}”, which comes later — move it below.`, where: label, stepId: s.id }); });
      if (s.kind === 'askme') (s.fields || []).forEach(f => { if (!f.label && !f.key) issues.push({ level: 'error', msg: 'A form field needs a label.', where: label, stepId: s.id }); if ((f.type === 'choice' || f.type === 'multi') && !(f.options && f.options.length)) issues.push({ level: 'error', msg: `“${f.label || 'A field'}” is a choice with no options.`, where: label, stepId: s.id }); });
      if (s.kind === 'action' && !s.actionId) issues.push({ level: 'error', msg: 'Choose an action for this step.', where: label, stepId: s.id });
      avail.add(label);
      if (s.kind === 'if') { walk(s.then, avail); if (s.else) walk(s.else, avail); }
      if (s.kind === 'repeat') { const inner = new Set(avail); inner.add('Repeat'); walk(s.steps, inner); }
    });
  };
  walk(a.steps, new Set(['Trigger', 'Built-in']));
  return issues;
}

// ── The recipe (recursive) ────────────────────────────────────────────
function WfRecipe({ steps, onChange, tokens, depth = 0, issues }) {
  const [drag, setDrag] = React.useState(null);
  const setAt = (i, next) => { const arr = steps.slice(); if (next == null) arr.splice(i, 1); else arr[i] = next; onChange(arr); };
  const move = (from, to) => { if (from === to || from == null) return; const arr = steps.slice(); const [x] = arr.splice(from, 1); arr.splice(to, 0, x); onChange(arr); };
  const add = (kind) => onChange([...steps, wf2NewStep(kind)]);
  let running = (tokens || []).slice();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((s, i) => {
        const before = running.slice();
        wf2StepProduces(s).forEach(t => running.push(t));
        return (
          <div key={s.id || i}
            onDragOver={(e) => { if (drag != null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
            onDrop={(e) => { if (drag != null) { e.preventDefault(); move(drag, i); setDrag(null); } }}
            style={{ opacity: drag === i ? 0.4 : 1 }}>
            <WfStepCard step={s} onChange={(n) => setAt(i, n)} tokens={before} depth={depth} index={i} issues={issues}
              onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)}/>
          </div>
        );
      })}
      <WfAddMenu onAdd={add}/>
    </div>
  );
}

function WfStepCard({ step, onChange, tokens, depth, onDragStart, onDragEnd, issues }) {
  const v = WF2_VERB[step.kind];
  const isBlock = WF2_BLOCK.has(step.kind);
  const [open, setOpen] = React.useState(false);
  const patch = (p) => onChange({ ...step, ...p });
  const myIssues = (issues || []).filter(i => i.stepId === step.id);
  const bad = myIssues.length > 0;
  const issueStrip = bad ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '7px 12px 8px 12px', background: wf2Rgba(T.red, 0.06), borderTop: `0.5px solid ${wf2Rgba(T.red, 0.2)}` }}>
      {myIssues.map((iss, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, color: T.red, lineHeight: 1.4 }}><Icon name="exclamationmark.triangle" size={11} color={T.red} style={{ flexShrink: 0, marginTop: 1 }}/>{iss.msg}</span>)}
    </div>
  ) : null;

  const summary = (
    step.kind === 'agent' ? <WfChipText value={step.prompt} empty="No prompt yet"/>
    : step.kind === 'notify' ? <WfChipText value={step.message} empty="No message yet"/>
    : step.kind === 'askme' ? <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text3 }}>{(step.fields || []).length} field{(step.fields || []).length === 1 ? '' : 's'}{(step.fields || []).length ? ' · ' + (step.fields || []).map(f => f.label || f.key).filter(Boolean).slice(0, 4).join(', ') : ''}</span>
    : step.kind === 'action' ? (step.actionId ? <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text3 }}>{(wf2ActionById(step.actionId) || {}).name}</span> : <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.amber }}>Pick an action</span>)
    : null
  );

  const header = (
    <div style={{ display: 'flex', alignItems: isBlock ? 'center' : 'flex-start', gap: 9, padding: isBlock ? '9px 10px' : '9px 10px' }}>
      <span draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Drag to reorder" style={{ cursor: 'grab', display: 'inline-flex', flexShrink: 0, marginTop: isBlock ? 0 : 2 }}><Icon name="grip" size={14} color={T.text4}/></span>
      <span style={{ width: 27, height: 27, borderRadius: RADIUS.sm, background: wf2Rgba(v.color, 0.13), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={v.icon} size={14} color={v.color}/></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <input value={step.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder={v.label}
          style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT, fontSize: FS.body, fontWeight: 600, color: T.text, letterSpacing: -0.1, padding: 0 }}/>
        {!isBlock && <div style={{ marginTop: 2 }}>{summary}</div>}
      </div>
      {!isBlock && (
        <button onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', borderRadius: RADIUS.sm, border: `0.5px solid ${open ? wf2Rgba(v.color, 0.4) : T.border}`, background: open ? wf2Rgba(v.color, 0.08) : 'transparent', cursor: 'pointer', color: open ? v.color : T.text2, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, flexShrink: 0, marginTop: 1 }}>
          <Icon name="sliders" size={11} color={open ? v.color : T.text3}/>{open ? 'Done' : 'Set up'}
        </button>
      )}
      <button onClick={() => onChange(null)} title="Remove" style={{ width: 28, height: 28, borderRadius: RADIUS.sm, border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }} onMouseEnter={(e) => e.currentTarget.style.background = T.chipBg} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><Icon name="trash" size={12} color={T.text3}/></button>
    </div>
  );

  if (isBlock) {
    return (
      <div style={{ borderRadius: RADIUS.lg, border: `0.5px solid ${bad ? wf2Rgba(T.red, 0.55) : wf2Rgba(v.color, 0.32)}`, background: wf2Rgba(v.color, 0.045), overflow: 'hidden' }}>
        {header}
        {issueStrip}
        <div style={{ padding: '0 10px 11px 12px' }}>
          <div style={{ borderLeft: `2px solid ${wf2Rgba(v.color, 0.35)}`, paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {step.kind === 'if' && <WfIfBody step={step} patch={patch} tokens={tokens} depth={depth} issues={issues}/>}
            {step.kind === 'repeat' && <WfRepeatBody step={step} patch={patch} tokens={tokens} depth={depth} issues={issues}/>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ borderRadius: RADIUS.md, border: `0.5px solid ${bad ? wf2Rgba(T.red, 0.55) : T.border}`, background: T.content, overflow: 'hidden' }}>
      {header}
      {issueStrip}
      {open && (
        <div style={{ padding: '2px 12px 14px 46px', borderTop: `0.5px solid ${T.hairline}` }}>
          <div style={{ marginTop: 12 }}>
            {step.kind === 'agent' && <WfAgentConfig step={step} patch={patch} tokens={tokens}/>}
            {step.kind === 'askme' && <WfAskMeConfig step={step} patch={patch}/>}
            {step.kind === 'action' && <WfActionConfig step={step} patch={patch} tokens={tokens}/>}
            {step.kind === 'notify' && <WfNotifyConfig step={step} patch={patch} tokens={tokens}/>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── If … otherwise ────────────────────────────────────────────────────
function WfIfBody({ step, patch, tokens, depth, issues }) {
  const conds = step.conditions || [];
  const setCond = (i, p) => { const c = conds.slice(); c[i] = { ...c[i], ...p }; patch({ conditions: c }); };
  const addCond = () => patch({ conditions: [...conds, { token: null, comparator: 'is', value: '' }] });
  const rmCond = (i) => patch({ conditions: conds.filter((_, k) => k !== i) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {conds.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {i > 0 && <span style={{ fontFamily: FONT, fontSize: FS.micro, fontWeight: 700, color: WF2_VERB.if.color, width: 30 }}>{step.match === 'any' ? 'or' : 'and'}</span>}
            <WfConditionRow cond={c} tokens={tokens} onChange={(p) => setCond(i, p)}/>
            {conds.length > 1 && <WfIconBtn icon="xmark" size={11} onClick={() => rmCond(i)}/>}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={addCond} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, padding: 0 }}>+ Add condition</button>
          {conds.length > 1 && <WfSeg size="sm" value={step.match || 'all'} options={[{ id: 'all', label: 'Match all' }, { id: 'any', label: 'Match any' }]} onChange={(v) => patch({ match: v })}/>}
        </div>
      </div>
      <div>
        <div style={{ fontFamily: FONT, fontSize: FS.micro, fontWeight: 700, color: WF2_VERB.if.color, marginBottom: 6 }}>Then</div>
        <WfRecipe steps={step.then || []} onChange={(then) => patch({ then })} tokens={tokens} depth={depth + 1} issues={issues}/>
      </div>
      {step.else != null ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: FONT, fontSize: FS.micro, fontWeight: 700, color: WF2_VERB.if.color }}>Otherwise</span>
            <WfIconBtn icon="xmark" size={10} onClick={() => patch({ else: null })}/>
          </div>
          <WfRecipe steps={step.else || []} onChange={(el) => patch({ else: el })} tokens={tokens} depth={depth + 1} issues={issues}/>
        </div>
      ) : <button onClick={() => patch({ else: [] })} style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent', cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, padding: 0 }}>+ Add “otherwise”</button>}
    </div>
  );
}
function WfConditionRow({ cond, tokens, onChange }) {
  const t = cond.token;
  const comparators = t ? (WF2_COMPARATORS[t.type] || WF2_COMPARATORS.text) : WF2_COMPARATORS.text;
  const noValue = /empty|is set|is not set/.test(cond.comparator || '');
  return (
    <>
      {t ? <span style={{ display: 'inline-flex' }}><WfTokenChip token={t} sub={t.field} onRemove={() => onChange({ token: null })}/></span>
        : <WfTokenPicker tokens={tokens} onInsert={(tok) => onChange({ token: tok, comparator: (WF2_COMPARATORS[tok.type] || WF2_COMPARATORS.text)[0] })} small label="Pick a result"/>}
      {t && <WfMiniSelect value={cond.comparator} options={comparators} width={112} onChange={(v) => onChange({ comparator: v })}/>}
      {t && !noValue && (t.type === 'choice' && t.options
        ? <WfMiniSelect value={cond.value || t.options[0]} options={t.options} width={130} onChange={(v) => onChange({ value: v })}/>
        : <input value={cond.value || ''} onChange={(e) => onChange({ value: e.target.value })} placeholder="value" style={wf2Field({ width: 130, height: 28 })}/>)}
    </>
  );
}

// ── Repeat for each ───────────────────────────────────────────────────
function WfRepeatBody({ step, patch, tokens, depth, issues }) {
  const listTokens = (tokens || []).filter(t => t.type === 'list');
  const chosen = (step.list || []).find(p => p && p.tok);
  const itemTok = chosen ? { ...tk('Current item', { color: WF2_SRC.item, icon: 'circle.dot', source: 'Repeat', fields: chosen.fields, type: 'text' }) } : null;
  const inner = itemTok ? [...(tokens || []), itemTok] : (tokens || []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text2 }}>For each item in</span>
        {chosen ? <span style={{ display: 'inline-flex' }}><WfTokenChip token={chosen} onRemove={() => patch({ list: [] })}/></span>
          : <WfTokenPicker tokens={listTokens} onInsert={(t) => patch({ list: [t] })} small label="Pick a list"/>}
      </div>
      <WfRecipe steps={step.steps || []} onChange={(steps) => patch({ steps })} tokens={inner} depth={depth + 1} issues={issues}/>
    </div>
  );
}

// ── Add menu ──────────────────────────────────────────────────────────
function WfAddMenu({ onAdd }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px 0 10px', borderRadius: RADIUS.md, border: `1px dashed ${T.borderH}`, background: 'transparent', cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: FS.caption, fontWeight: 600 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = T.rowHover; e.currentTarget.style.color = T.text; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = T.text2; }}>
        <Icon name="plus" size={12} color="currentColor"/>Add step
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 110 }}/>
          <div style={{ position: 'absolute', top: 34, left: 0, zIndex: 111, width: 292, background: T.popBg, borderRadius: RADIUS.lg, padding: 6, boxShadow: T.popShadow }}>
            {WF2_ADD_GROUPS.map(g => (
              <div key={g.label} style={{ marginBottom: 4 }}>
                <div style={{ padding: '6px 8px 4px', fontFamily: FONT, fontSize: FS.micro, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: T.text3 }}>{g.label}</div>
                {g.kinds.map(k => {
                  const v = WF2_VERB[k];
                  return (
                    <button key={k} onClick={() => { onAdd(k); setOpen(false); }} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', padding: '8px', borderRadius: RADIUS.sm, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ width: 26, height: 26, borderRadius: RADIUS.md, background: wf2Rgba(v.color, 0.12), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}><Icon name={v.icon} size={14} color={v.color}/></span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontFamily: FONT, fontSize: FS.label, fontWeight: 600, color: T.text }}>{v.label}</span>
                        <span style={{ display: 'block', fontFamily: FONT, fontSize: FS.micro, color: T.text3, lineHeight: 1.4, marginTop: 1 }}>{v.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Trigger rows (the When section) ───────────────────────────────────
function WfWebhookConfig({ trigger, onChange }) {
  const sample = trigger.sample;
  const capture = () => onChange({ ...trigger, sample: { at: 'just now', fields: ['event', 'pull_request.number', 'pull_request.html_url', 'sender.login'] } });
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: MONO, fontSize: FS.micro, color: T.text3 }}>
        <Icon name="globe" size={11} color={T.text3}/>https://hooks.mainframe.app/w/9f3a…<span style={{ color: T.green }}>· signature verified</span>
      </div>
      {sample ? (
        <div style={{ padding: '9px 10px', borderRadius: RADIUS.md, border: `0.5px solid ${T.hairline}`, background: T.content2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <Icon name="checkmark" size={11} color={T.green}/>
            <span style={{ fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, color: T.text2 }}>Sample captured {sample.at}</span>
            <span style={{ flex: 1 }}/>
            <button onClick={() => onChange({ ...trigger, sample: null })} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: T.text3, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, padding: 0 }}>Recapture</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
            {sample.fields.map(f => (
              <span key={f} style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: RADIUS.full, background: wf2Rgba(WF2_SRC.trigger, 0.1), border: `0.5px solid ${wf2Rgba(WF2_SRC.trigger, 0.3)}`, color: WF2_SRC.trigger, fontFamily: MONO, fontSize: 10, fontWeight: 700 }}>{f}</span>
            ))}
          </div>
          <span style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text3 }}>These become tokens you can insert in the steps below.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text3 }}>No sample yet — capture one call to read its fields as tokens.</span>
          <button onClick={capture} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', borderRadius: RADIUS.full, border: `0.5px solid ${T.border}`, background: T.content, cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}><Icon name="bolt" size={10} color={ACCENT}/>Capture a sample</button>
        </div>
      )}
    </div>
  );
}
function WfTriggerRow({ trigger, onChange }) {
  const m = WF2_TRIGGER_META[trigger.kind];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 11px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content }}>
      <span style={{ width: 28, height: 28, borderRadius: RADIUS.sm, background: wf2Rgba(m.color, 0.12), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={m.icon} size={14} color={m.color}/></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: FS.label, fontWeight: 600, color: T.text }}>{m.label}</div>
        {trigger.kind === 'schedule' && <div style={{ marginTop: 7 }}><WfSchedulePicker trigger={trigger} onChange={onChange}/></div>}
        {trigger.kind === 'event' && <div style={{ marginTop: 7 }}><WfMiniSelect value={(WF2_EVENTS.find(e => e.id === trigger.event) || WF2_EVENTS[0]).label} options={WF2_EVENTS.map(e => e.label)} width={260} onChange={(l) => onChange({ ...trigger, event: (WF2_EVENTS.find(e => e.label === l) || WF2_EVENTS[0]).id })}/></div>}
        {trigger.kind === 'webhook' && <WfWebhookConfig trigger={trigger} onChange={onChange}/>}
        {trigger.kind === 'manual' && <div style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text3, marginTop: 1 }}>{m.hint}</div>}
      </div>
      <WfIconBtn icon="xmark" onClick={() => onChange(null)}/>
    </div>
  );
}
function WfTriggerAdd({ onAdd }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: FS.caption, fontWeight: 600, padding: 0 }}>+ Add a trigger</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 110 }}/>
          <div style={{ position: 'absolute', top: 22, right: 0, zIndex: 111, width: 258, background: T.popBg, borderRadius: RADIUS.lg, padding: 6, boxShadow: T.popShadow }}>
            {['schedule', 'event', 'webhook', 'manual'].map(k => {
              const m = WF2_TRIGGER_META[k];
              return (
                <button key={k} onClick={() => { onAdd(k); setOpen(false); }} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', padding: '8px', borderRadius: RADIUS.sm, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ width: 24, height: 24, borderRadius: RADIUS.sm, background: wf2Rgba(m.color, 0.12), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}><Icon name={m.icon} size={12} color={m.color}/></span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontFamily: FONT, fontSize: FS.label, fontWeight: 600, color: T.text }}>{m.label}{m.advanced ? <span style={{ marginLeft: 6, fontSize: 9, color: T.text4, fontWeight: 700 }}>ADVANCED</span> : ''}</span>
                    <span style={{ display: 'block', fontFamily: FONT, fontSize: FS.micro, color: T.text3, marginTop: 1 }}>{m.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function WfBand({ step, label, sub, action, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 22, borderRadius: RADIUS.full, background: T.text, color: T.content, fontFamily: FONT, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{step}</span>
        <span style={{ fontFamily: FONT, fontSize: FS.heading, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>{label}</span>
        <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text3 }}>{sub}</span>
        <span style={{ flex: 1 }}/>
        {action}
      </div>
      <div style={{ paddingLeft: 32 }}>{children}</div>
    </div>
  );
}

// ── The editor shell ──────────────────────────────────────────────────
function WfEditor({ open = true, onClose, embedded, automation }) {
  const [draft, setDraft] = React.useState(automation || { name: '', description: '', scope: 'project', triggers: [], steps: [] });
  React.useEffect(() => { if (open) setDraft(automation || { name: '', description: '', scope: 'project', triggers: [], steps: [] }); }, [open, automation]);
  const up = (p) => setDraft(d => ({ ...d, ...p }));
  if (!open) return null;
  const triggers = draft.triggers || [];
  const setTrigger = (i, n) => { const t = triggers.slice(); if (n == null) t.splice(i, 1); else t[i] = n; up({ triggers: t }); };
  const addTrigger = (kind) => up({ triggers: [...triggers, kind === 'schedule' ? { kind, ...WF2_SCHEDULES[0], onMissed: true } : kind === 'event' ? { kind, event: WF2_EVENTS[0].id } : { kind }] });
  const triggerTokens = wf2TriggerTokens(triggers).concat(WF2_BUILTINS);
  const issues = wf2Validate(draft);
  const errors = issues.filter(i => i.level === 'error');
  const ok = errors.length === 0;
  const isNew = !automation;

  return (
    <div onClick={embedded ? undefined : onClose} style={embedded
      ? { position: 'absolute', inset: 0, zIndex: 60, fontFamily: FONT, display: 'flex' }
      : { position: 'fixed', inset: 0, zIndex: 4600, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,19,15,0.5)', backdropFilter: 'blur(3px)' }}>
      <div data-screen-label="Automation editor" onClick={(e) => e.stopPropagation()} style={{ width: embedded ? '100%' : 760, height: embedded ? '100%' : '90%', maxWidth: '96vw', maxHeight: embedded ? '100%' : 940, position: 'relative', display: 'flex', flexDirection: 'column', background: T.windowBg, borderRadius: embedded ? RADIUS.xl : RADIUS.xl, overflow: 'hidden', boxShadow: embedded ? 'none' : T.shadow, border: embedded ? `0.5px solid ${T.border}` : 'none' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', borderBottom: `0.5px solid ${T.hairline}`, background: T.content }}>
          <WfIconBtn icon={embedded ? 'chevron.left' : 'xmark'} size={15} onClick={onClose}/>
          <Icon name="bolt" size={15} color={ACCENT}/>
          <span style={{ fontFamily: FONT, fontSize: FS.heading, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>{isNew ? 'New automation' : draft.name || 'Automation'}</span>
          <span style={{ flex: 1 }}/>
          <button style={{ height: 30, padding: '0 13px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: 'transparent', cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: FS.label, fontWeight: 500 }}>Cancel</button>
          <button disabled={!ok} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 14px', borderRadius: RADIUS.md, border: 'none', cursor: ok ? 'pointer' : 'default', background: ACCENT, opacity: ok ? 1 : 0.45, color: '#fff', fontFamily: FONT, fontSize: FS.label, fontWeight: 600 }}><Icon name="checkmark" size={12} color="#fff" stroke={2.2}/>{isNew ? 'Create' : 'Save'}</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: T.content }}>
          <div style={{ maxWidth: 620, margin: '0 auto', padding: '22px 24px 32px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              <input value={draft.name || ''} onChange={(e) => up({ name: e.target.value })} placeholder="Name this automation" style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT, fontSize: FS.display, fontWeight: 700, color: T.text, letterSpacing: -0.4, padding: 0 }}/>
              <input value={draft.description || ''} onChange={(e) => up({ description: e.target.value })} placeholder="What does it do? (optional)" style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT, fontSize: FS.body, color: T.text2, padding: 0 }}/>
              <div style={{ marginTop: 4 }}><WfSeg value={draft.scope || 'project'} options={[{ id: 'project', label: 'Just this project' }, { id: 'global', label: 'Everywhere' }]} onChange={(v) => up({ scope: v })}/></div>
            </div>
            <WfBand step="1" label="When" sub={triggers.length ? '' : 'What kicks it off'} action={<WfTriggerAdd onAdd={addTrigger}/>}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {triggers.map((t, i) => <WfTriggerRow key={i} trigger={t} onChange={(n) => setTrigger(i, n)}/>)}
                {!triggers.length && <div style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text3, padding: '2px' }}>No trigger yet — you’ll run it by hand.</div>}
              </div>
            </WfBand>
            <WfBand step="2" label="Do" sub="Step by step, top to bottom">
              <WfRecipe steps={draft.steps || []} onChange={(steps) => up({ steps })} tokens={triggerTokens} issues={issues}/>
            </WfBand>
          </div>
        </div>
        <div style={{ flexShrink: 0, minHeight: 40, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderTop: `0.5px solid ${T.hairline}`, background: T.content2 }}>
          {ok ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FONT, fontSize: FS.label, fontWeight: 600, color: T.green }}><span style={{ width: 16, height: 16, borderRadius: '50%', background: T.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="checkmark" size={10} color="#fff" stroke={2.4}/></span>Looks good{ok && ' · ready to ' + (isNew ? 'create' : 'save')}</span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FONT, fontSize: FS.label, fontWeight: 600, color: T.red }}><Icon name="exclamationmark.triangle" size={14} color={T.red}/>{errors.length} to fix</span>
          )}
          <div style={{ width: 1, height: 16, background: T.border }}/>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, overflowX: 'auto' }}>
            {issues.map((iss, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, fontFamily: FONT, fontSize: FS.caption, color: iss.level === 'error' ? T.red : T.amber }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: iss.level === 'error' ? T.red : T.amber }}/>{iss.msg}</span>)}
            {!issues.length && <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text3 }}>Every step’s inputs are available when it runs.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { WfEditor, WfRecipe, WfStepCard, WfIfBody, WfRepeatBody, WfAddMenu, WfTriggerRow, WfBand, wf2Validate, wf2NewStep });
