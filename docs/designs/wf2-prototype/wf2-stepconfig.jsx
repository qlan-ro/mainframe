// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Automations v2 · STEP CONFIG
// The "Set up" body each step card expands. Four verb configs + the action
// catalog (built-ins / connectors / MCP), auto-generated connector forms,
// and the credential "Connect…" flow. Essentials show; the rare knobs fold
// under "More options". All text inputs are WfChipFields (token-aware).
// Depends on: 01-base, wf2-base, wf2-fields, wf2-seeds (WF2_CREDENTIALS).
// → window.WfAgentConfig, WfAskMeConfig, WfActionConfig, WfNotifyConfig,
//   WfActionCatalog, WfCredentialField
// ════════════════════════════════════════════════════════════════

function WfMore({ label = 'More options', children }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: T.text3, fontFamily: FONT, fontSize: FS.micro, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
        onMouseEnter={(e) => e.currentTarget.style.color = T.text2} onMouseLeave={(e) => e.currentTarget.style.color = T.text3}>
        <Icon name="chevron.right" size={9} color="currentColor" style={{ transform: open ? 'rotate(90deg)' : 'none' }}/>{label}
      </button>
      {open && <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>}
    </div>
  );
}
function WfRow({ label, children, top }) {
  return (
    <div style={{ display: 'flex', alignItems: top ? 'flex-start' : 'center', gap: 10 }}>
      <span style={{ ...wf2Lbl, width: 74, flexShrink: 0, paddingTop: top ? 7 : 0, textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// Per-step failure policy (spec §8): the only failure control. Stored as
// step.continueOnError; surfaced in the run view when it actually fires.
function WfFailureToggle({ step, patch }) {
  return (
    <WfRow label="On failure" top>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
        <WfToggle size="sm" on={!!step.continueOnError} onChange={(v) => patch({ continueOnError: v })}/>
        <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text2 }}>Keep going if this step fails</span>
      </label>
    </WfRow>
  );
}
// Ask-agent attachments (spec §5): images/files handed to the agent with the prompt.
function WfAttachments({ value = [], onChange }) {
  const add = (kind) => onChange([...(value || []), kind === 'image' ? { name: 'screenshot-' + ((value || []).length + 1) + '.png', kind: 'image' } : { name: 'context-' + ((value || []).length + 1) + '.md', kind: 'file' }]);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {(value || []).map((f, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 4px 0 9px', borderRadius: RADIUS.full, background: T.chipBg, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, color: T.text2 }}>
          <Icon name={f.kind === 'image' ? 'photo' : 'doc.text'} size={11} color={T.text3}/>{f.name}
          <button onClick={() => onChange(value.filter((_, k) => k !== i))} style={{ width: 14, height: 14, border: 'none', borderRadius: '50%', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><Icon name="xmark" size={7} color={T.text3}/></button>
        </span>
      ))}
      <button onClick={() => add('image')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', borderRadius: RADIUS.full, border: `1px dashed ${T.borderH}`, background: 'transparent', cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}><Icon name="paperclip" size={11} color={ACCENT}/>Add image or file…</button>
    </div>
  );
}

// ── Credential field ("Connect…" once per service) ────────────────────
function WfCredentialField({ service, value, onChange }) {
  const [connected, setConnected] = React.useState(value || (window.WF2_CREDENTIALS && window.WF2_CREDENTIALS[service]) || null);
  if (connected) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 28, padding: '0 4px 0 10px', borderRadius: RADIUS.full, border: `0.5px solid ${wf2Rgba(T.green, 0.4)}`, background: wf2Rgba(T.green, 0.08) }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green }}/>
        <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text2 }}>{connected}</span>
        <button onClick={() => { setConnected(null); onChange && onChange(null); }} title="Disconnect" style={{ width: 18, height: 18, border: 'none', borderRadius: '50%', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="xmark" size={9} color={T.text3}/></button>
      </span>
    );
  }
  return (
    <button onClick={() => { const acct = 'you@' + service.toLowerCase().replace(/[^a-z]/g, ''); setConnected(acct); onChange && onChange(acct); }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content, cursor: 'pointer', color: ACCENT, fontFamily: FONT, fontSize: FS.caption, fontWeight: 600 }}>
      <Icon name="plug" size={12} color={ACCENT}/>Connect {service}…
    </button>
  );
}

// ── Auto-generated action form ────────────────────────────────────────
function WfActionForm({ action, args, patch, tokens }) {
  const set = (k, v) => patch({ args: { ...args, [k]: v } });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {action.fields.map(f => {
        if (f.showIf && !f.showIf(args)) return null;
        let control = null;
        if (f.type === 'select') control = <WfMiniSelect value={args[f.key] || f.options[0]} options={f.options} width={200} onChange={(v) => set(f.key, v)}/>;
        else if (f.type === 'segment') control = <WfSeg value={args[f.key] || f.options[0]} options={f.options} onChange={(v) => set(f.key, v)}/>;
        else if (f.type === 'text') control = <input value={args[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} style={wf2Field({ height: 30 })}/>;
        else if (f.type === 'credential') control = <WfCredentialField service={f.service} value={args.credential} onChange={(v) => set('credential', v)}/>;
        else if (f.type === 'notion-columns') control = <WfNotionColumns args={args} set={set} tokens={tokens}/>;
        else if (f.type === 'code') control = <WfChipField value={args[f.key] || []} onChange={(v) => set(f.key, v)} placeholder={f.placeholder} tokens={tokens} multiline mono minH={54}/>;
        else if (f.type === 'chiparea') control = <WfChipField value={args[f.key] || []} onChange={(v) => set(f.key, v)} placeholder={f.placeholder} tokens={tokens} multiline minH={48}/>;
        else control = <WfChipField value={args[f.key] || []} onChange={(v) => set(f.key, v)} placeholder={f.placeholder} tokens={tokens}/>;
        if (f.key === '__columns') return <div key={f.key}>{control}</div>;
        return <WfRow key={f.key} label={f.label} top={f.type === 'code' || f.type === 'chiparea' || f.type === 'notion-columns'}>{control}</WfRow>;
      })}
    </div>
  );
}
// Notion: database columns become fields.
const WF2_NOTION_COLS = { 'Health Log': ['Date', 'Mood', 'Sleep', 'Symptoms'], 'Reading list': ['Title', 'Author', 'Status'], 'Standup notes': ['Date', 'Summary'] };
function WfNotionColumns({ args, set, tokens }) {
  const cols = WF2_NOTION_COLS[args.database] || WF2_NOTION_COLS['Health Log'];
  const data = args.columns || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: RADIUS.md, border: `0.5px solid ${T.hairline}`, background: T.content }}>
      {cols.map(c => (
        <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 78, flexShrink: 0, fontFamily: FONT, fontSize: FS.caption, color: T.text2, fontWeight: 600 }}>{c}</span>
          <div style={{ flex: 1 }}><WfChipField value={data[c] || []} onChange={(v) => set('columns', { ...data, [c]: v })} tokens={tokens} placeholder="value"/></div>
        </div>
      ))}
    </div>
  );
}

// ── The action catalog (searchable, Shortcuts-style) ──────────────────
function WfActionCatalog({ onPick, onClose, embed }) {
  const [q, setQ] = React.useState('');
  const [src, setSrc] = React.useState('all');
  const shown = WF2_CATALOG.filter(a => (src === 'all' || a.source === src) && (!q || (a.name + ' ' + (a.connector || a.server || '') + ' ' + a.blurb).toLowerCase().includes(q.toLowerCase())));
  const inner = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: T.content }}>
      <div style={{ flexShrink: 0, padding: '12px 14px', borderBottom: `0.5px solid ${T.hairline}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="plug" size={15} color={WF2_SRC.action}/>
          <span style={{ flex: 1, fontFamily: FONT, fontSize: FS.heading, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>Choose an action</span>
          {onClose && <WfIconBtn icon="xmark" size={15} onClick={onClose}/>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content2 }}>
          <Icon name="magnifyingglass" size={13} color={T.text3}/>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions, connectors, MCP tools…" autoFocus
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: FONT, fontSize: FS.body, color: T.text }}/>
        </div>
        <WfSeg value={src} options={[{ id: 'all', label: 'All' }, ...WF2_CATALOG_SOURCES.map(s => ({ id: s.id, label: s.label }))]} onChange={setSrc} size="sm"/>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '10px 12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {shown.map(a => (
          <button key={a.id} onClick={() => onPick(a)} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 11px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content, cursor: 'pointer', textAlign: 'left' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.rowHover; e.currentTarget.style.borderColor = T.borderH; }} onMouseLeave={(e) => { e.currentTarget.style.background = T.content; e.currentTarget.style.borderColor = T.border; }}>
            <span style={{ width: 30, height: 30, borderRadius: RADIUS.md, background: wf2Rgba(a.color, 0.12), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={a.icon} size={15} color={a.color}/></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontFamily: FONT, fontSize: FS.body, fontWeight: 600, color: T.text }}>{a.name}</span>
                {a.list && <span style={{ height: 15, padding: '0 6px', borderRadius: RADIUS.full, background: wf2Rgba(WF2_SRC.item, 0.14), color: WF2_SRC.item, fontFamily: FONT, fontSize: 9, fontWeight: 700 }}>LIST</span>}
                {a.advanced && <span style={{ height: 15, padding: '0 6px', borderRadius: RADIUS.full, background: T.chipBg, color: T.text3, fontFamily: FONT, fontSize: 9, fontWeight: 700 }}>ADVANCED</span>}
              </span>
              <span style={{ display: 'block', fontFamily: FONT, fontSize: FS.caption, color: T.text3, marginTop: 2, lineHeight: 1.4 }}>{a.blurb}</span>
            </span>
            <span style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text4, flexShrink: 0, marginTop: 2 }}>{a.connector || a.server || 'Built-in'}</span>
          </button>
        ))}
        {!shown.length && <div style={{ padding: 24, textAlign: 'center', fontFamily: FONT, fontSize: FS.caption, color: T.text3 }}>No actions match “{q}”.</div>}
      </div>
    </div>
  );
  if (embed) return inner;
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,19,15,0.34)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: '92%', height: '82%', maxHeight: 640, background: T.content, borderRadius: RADIUS.xl, overflow: 'hidden', boxShadow: T.shadow }}>{inner}</div>
    </div>
  );
}

// ── Ask agent ─────────────────────────────────────────────────────────
const WF2_MODELS = ['Claude Opus 4.6', 'Claude Sonnet 4.6', 'Codex GPT-5.2', 'Gemini 3 Pro'];
const WF2_APPROVE = ['edits', 'pnpm', 'git', 'shell'];
function WfAgentConfig({ step, patch, tokens }) {
  const more = step.more || {};
  const setMore = (p) => patch({ more: { ...more, ...p } });
  const toggleApprove = (a) => { const cur = more.autoApprove || []; setMore({ autoApprove: cur.includes(a) ? cur.filter(x => x !== a) : [...cur, a] }); };
  const wt = more.worktree || null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><span style={wf2Lbl}>Prompt</span></div>
        <WfChipField value={step.prompt || []} onChange={(v) => patch({ prompt: v })} tokens={tokens} multiline minH={62} slash
          placeholder="What should the agent do? Type / for a slash command, ⟨⟩ to insert a result…"/>
      </div>
      <WfRow label="Agent"><WfMiniSelect value={step.model || WF2_MODELS[0]} options={WF2_MODELS} width={210} onChange={(v) => patch({ model: v })}/></WfRow>
      <WfMore>
        <WfRow label="Attachments" top>
          <WfAttachments value={more.attachments || []} onChange={(v) => setMore({ attachments: v })}/>
        </WfRow>
        <WfRow label="Worktree" top>
          {wt ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input value={wt.branch || ''} onChange={(e) => setMore({ worktree: { ...wt, branch: e.target.value } })} placeholder="branch name" style={wf2Field({ width: 150, height: 28 })}/>
              <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text3 }}>from</span>
              <input value={wt.base || ''} onChange={(e) => setMore({ worktree: { ...wt, base: e.target.value } })} placeholder="main" style={wf2Field({ width: 110, height: 28 })}/>
              <WfIconBtn icon="xmark" onClick={() => setMore({ worktree: null })}/>
            </div>
          ) : <button onClick={() => setMore({ worktree: { base: 'main', branch: '' } })} style={{ ...wf2Field({ width: 'auto', height: 28, cursor: 'pointer', color: ACCENT, fontWeight: 600, background: 'transparent', borderStyle: 'dashed' }) }}>+ Run in a fresh worktree</button>}
        </WfRow>
        <WfRow label="Auto-approve" top>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WF2_APPROVE.map(a => { const on = (more.autoApprove || []).includes(a); return (
              <button key={a} onClick={() => toggleApprove(a)} style={{ height: 24, padding: '0 10px', borderRadius: RADIUS.full, border: `0.5px solid ${on ? wf2Rgba(ACCENT, 0.5) : T.border}`, background: on ? wf2Rgba(ACCENT, 0.1) : T.content2, color: on ? ACCENT : T.text3, cursor: 'pointer', fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}>{a}</button>
            ); })}
          </div>
        </WfRow>
        <WfRow label="Budget cap"><input value={more.cap || ''} onChange={(e) => setMore({ cap: e.target.value })} placeholder="$4.00 or 20m" style={wf2Field({ width: 130, height: 28 })}/></WfRow>
        <WfRow label="Permission"><WfMiniSelect value={more.permission || 'default'} options={['default', 'acceptEdits', 'yolo']} width={160} onChange={(v) => setMore({ permission: v })}/></WfRow>
        <WfFailureToggle step={step} patch={patch}/>
      </WfMore>
    </div>
  );
}

// ── Ask me (form builder) ─────────────────────────────────────────────
const WF2_FTYPES = ['text', 'number', 'choice', 'multi', 'textarea'];
function WfAskMeConfig({ step, patch }) {
  const fields = step.fields || [];
  const setField = (i, p) => { const f = fields.slice(); f[i] = { ...f[i], ...p }; patch({ fields: f }); };
  const add = () => patch({ fields: [...fields, { key: 'field_' + (fields.length + 1), label: '', type: 'text', required: false }] });
  const remove = (i) => patch({ fields: fields.filter((_, k) => k !== i) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <WfRow label="Title"><input value={step.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder="What am I answering?" style={wf2Field({ height: 30 })}/></WfRow>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {fields.map((f, i) => <WfFieldRow key={i} field={f} fields={fields} onPatch={(p) => setField(i, p)} onRemove={() => remove(i)}/>)}
        <button onClick={add} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px 0 8px', borderRadius: RADIUS.sm, border: `1px dashed ${T.borderH}`, background: 'transparent', cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = T.rowHover; e.currentTarget.style.color = T.text; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = T.text2; }}>
          <Icon name="plus" size={10} color="currentColor"/>Add a field
        </button>
      </div>
      <WfMore><WfFailureToggle step={step} patch={patch}/></WfMore>
    </div>
  );
}
function WfFieldRow({ field: f, fields, onPatch, onRemove }) {
  const needsOpts = f.type === 'choice' || f.type === 'multi';
  const [showWhen, setShowWhen] = React.useState(!!f.when);
  const others = fields.filter(o => o !== f && o.key);
  const [optDraft, setOptDraft] = React.useState('');
  return (
    <div style={{ borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content, padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="grip" size={13} color={T.text4}/>
        <input value={f.label || ''} onChange={(e) => onPatch({ label: e.target.value })} placeholder="Label" style={wf2Field({ flex: 1, minWidth: 60, height: 28 })}/>
        <WfMiniSelect value={f.type || 'text'} options={WF2_FTYPES} width={104} mono onChange={(t) => onPatch({ type: t, options: (t === 'choice' || t === 'multi') ? (f.options || []) : undefined })}/>
        <label title="Required" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', flexShrink: 0 }}>
          <span style={{ ...wf2Lbl, color: f.required ? T.text2 : T.text4 }}>Req</span>
          <WfToggle size="sm" on={!!f.required} onChange={(v) => onPatch({ required: v })}/>
        </label>
        <WfIconBtn icon="xmark" size={11} onClick={onRemove}/>
      </div>
      {needsOpts && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, paddingLeft: 20 }}>
          {(f.options || []).map((o, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 4px 0 8px', borderRadius: RADIUS.full, background: T.chipBg, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, color: T.text2 }}>{o}
              <button onClick={() => onPatch({ options: f.options.filter((_, k) => k !== i) })} style={{ width: 13, height: 13, border: 'none', borderRadius: '50%', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><Icon name="xmark" size={7} color={T.text3}/></button></span>
          ))}
          <input value={optDraft} onChange={(e) => setOptDraft(e.target.value)} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ',') && optDraft.trim()) { e.preventDefault(); onPatch({ options: [...(f.options || []), optDraft.trim()] }); setOptDraft(''); } }}
            placeholder={(f.options || []).length ? 'Add…' : 'Type an option, ⏎'} style={{ border: 'none', outline: 'none', background: 'transparent', height: 20, minWidth: 90, fontFamily: FONT, fontSize: FS.micro, color: T.text }}/>
        </div>
      )}
      {showWhen && f.when ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 20, flexWrap: 'wrap' }}>
          <span style={wf2Lbl}>Show when</span>
          <WfMiniSelect value={f.when.key || (others[0] && others[0].key) || '—'} options={others.length ? others.map(o => o.key) : ['—']} width={120} mono onChange={(k) => onPatch({ when: { ...f.when, key: k } })}/>
          <span style={{ fontFamily: MONO, color: T.text4 }}>=</span>
          <input value={f.when.equals || ''} onChange={(e) => onPatch({ when: { ...f.when, equals: e.target.value } })} placeholder="value" style={wf2Field({ width: 120, height: 26 })}/>
          <WfIconBtn icon="xmark" size={10} onClick={() => { onPatch({ when: undefined }); setShowWhen(false); }}/>
        </div>
      ) : (others.length > 0 && (
        <button onClick={() => { onPatch({ when: { key: others[0].key, equals: '' } }); setShowWhen(true); }} style={{ alignSelf: 'flex-start', marginLeft: 20, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600, color: T.text3 }}
          onMouseEnter={(e) => e.currentTarget.style.color = ACCENT} onMouseLeave={(e) => e.currentTarget.style.color = T.text3}>+ show only when…</button>
      ))}
    </div>
  );
}

// ── Run an action ─────────────────────────────────────────────────────
function WfActionConfig({ step, patch, tokens }) {
  const [picking, setPicking] = React.useState(false);
  const action = wf2ActionById(step.actionId);
  if (!action || picking) {
    return <div style={{ height: 380, borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, overflow: 'hidden' }}>
      <WfActionCatalog embed onPick={(a) => { patch({ actionId: a.id, title: step.title && step.title !== 'Run an action' ? step.title : a.name, args: step.args || {} }); setPicking(false); }} onClose={action ? () => setPicking(false) : null}/>
    </div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: RADIUS.md, background: wf2Rgba(action.color, 0.07), border: `0.5px solid ${wf2Rgba(action.color, 0.2)}` }}>
        <Icon name={action.icon} size={14} color={action.color}/>
        <span style={{ flex: 1, fontFamily: FONT, fontSize: FS.body, fontWeight: 600, color: T.text }}>{action.name}</span>
        <span style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text3 }}>{action.connector || action.server || 'Built-in'}</span>
        <button onClick={() => setPicking(true)} style={{ height: 24, padding: '0 10px', borderRadius: RADIUS.sm, border: `0.5px solid ${T.border}`, background: T.content, cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: FS.micro, fontWeight: 600 }}>Change</button>
      </div>
      <WfActionForm action={action} args={step.args || {}} patch={patch} tokens={tokens}/>
      <WfMore><WfFailureToggle step={step} patch={patch}/></WfMore>
    </div>
  );
}

// ── Notify me ─────────────────────────────────────────────────────────
function WfNotifyConfig({ step, patch, tokens }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={wf2Lbl}>Message</span>
      <WfChipField value={step.message || []} onChange={(v) => patch({ message: v })} tokens={tokens} multiline minH={48} placeholder="What should the notification say?"/>
      <span style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text3 }}>Links to the run and any chat it created are added automatically.</span>
      <WfMore><WfFailureToggle step={step} patch={patch}/></WfMore>
    </div>
  );
}

Object.assign(window, { WfMore, WfRow, WfFailureToggle, WfAttachments, WfAgentConfig, WfAskMeConfig, WfActionConfig, WfNotifyConfig, WfActionCatalog, WfCredentialField, WfActionForm });
