// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Automations v2 · FIELD PRIMITIVES
// The inputs that make v2 feel like Shortcuts, not code:
//  • WfChipField — a bordered box mixing literal text with pickable token
//    chips (and slash-command chips). Insert via the ⟨⟩ picker or type "/".
//  • WfTokenPicker — grouped-by-source token menu; object tokens expand to
//    pick a field (⟨PR › URL⟩). Out-of-scope tokens never appear.
//  • WfChipText — read-only render of a chip-field value (for cards/runs).
//  • WfSchedulePicker / WfMiniSelect — small curated pickers.
// Depends on: 01-base, wf2-base (tk, wf2Rgba, WfTokenChip, wf2GroupTokens).
// → window.WfChipField, WfTokenPicker, WfChipText, WfSchedulePicker, WfMiniSelect
// ════════════════════════════════════════════════════════════════

function wf2MergeTail(parts, str) {
  if (!str) return parts;
  const out = parts.slice();
  if (out.length && typeof out[out.length - 1] === 'string') out[out.length - 1] = out[out.length - 1] + str;
  else out.push(str);
  return out;
}
function wf2IsToken(p) { return p && typeof p === 'object' && p.tok; }
function wf2IsSlash(p) { return p && typeof p === 'object' && p.slash; }

// Read-only render of a chip-field value.
function WfChipText({ value, empty = '—', mono }) {
  if (!value || !value.length) return <span style={{ color: T.text4, fontFamily: FONT, fontSize: FS.caption }}>{empty}</span>;
  return (
    <span style={{ display: 'inline', lineHeight: 1.9 }}>
      {value.map((p, i) => {
        if (wf2IsToken(p)) return <WfTokenChip key={i} token={p} sub={p.field}/>;
        if (wf2IsSlash(p)) return <span key={i} style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: RADIUS.full, background: wf2Rgba(ACCENT, 0.12), color: ACCENT, fontFamily: MONO, fontSize: FS.micro, fontWeight: 700, verticalAlign: 'middle' }}>{p.slash}</span>;
        return <span key={i} style={{ fontFamily: mono ? MONO : FONT, fontSize: FS.caption, color: T.text }}>{p}</span>;
      })}
    </span>
  );
}

// ── The token picker ──────────────────────────────────────────────────
function WfTokenPicker({ tokens, onInsert, anchor = 'left', small, label = 'Insert' }) {
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);
  const groups = wf2GroupTokens(tokens || []);
  const has = (tokens || []).length > 0;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button onClick={() => has && setOpen(o => !o)} title={has ? 'Insert a value from an earlier step' : 'No values available yet'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: small ? 20 : 24, padding: '0 8px', borderRadius: RADIUS.full, border: `0.5px solid ${T.border}`, background: T.content, cursor: has ? 'pointer' : 'default', opacity: has ? 1 : 0.5, color: ACCENT, fontFamily: FONT, fontSize: small ? 10 : FS.micro, fontWeight: 700 }}>
        <span style={{ fontFamily: MONO, fontSize: small ? 11 : 12, fontWeight: 700 }}>⟨⟩</span>{label}
      </button>
      {open && (
        <>
          <div onClick={() => { setOpen(false); setExpanded(null); }} style={{ position: 'fixed', inset: 0, zIndex: 120 }}/>
          <div style={{ position: 'absolute', top: (small ? 24 : 28), [anchor]: 0, zIndex: 121, width: 262, maxHeight: 340, overflowY: 'auto', background: T.popBg, borderRadius: RADIUS.lg, padding: 6, boxShadow: T.popShadow }}>
            {groups.map((g, gi) => (
              <div key={gi} style={{ marginBottom: 4 }}>
                <div style={{ padding: '5px 8px 4px', fontFamily: FONT, fontSize: FS.micro, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: T.text3 }}>{g.source}</div>
                {g.tokens.map((t, ti) => {
                  const key = gi + '.' + ti;
                  const openFields = expanded === key && t.fields && t.fields.length;
                  return (
                    <div key={ti}>
                      <button onClick={() => { if (t.fields && t.fields.length) setExpanded(openFields ? null : key); else { onInsert({ ...t }); setOpen(false); } }}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 8px', borderRadius: RADIUS.sm, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                        <span style={{ width: 20, height: 20, borderRadius: RADIUS.sm, background: wf2Rgba(t.color, 0.13), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={t.icon} size={11} color={t.color}/></span>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: FONT, fontSize: FS.label, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                        <span style={{ fontFamily: FONT, fontSize: FS.micro, color: T.text4 }}>{t.type}</span>
                        {t.fields && t.fields.length ? <Icon name="chevron.right" size={10} color={T.text3} style={{ transform: openFields ? 'rotate(90deg)' : 'none' }}/> : null}
                      </button>
                      {openFields ? t.fields.map(f => (
                        <button key={f} onClick={() => { onInsert({ ...t, field: f }); setOpen(false); setExpanded(null); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 8px 5px 37px', borderRadius: RADIUS.sm, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                          <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text2 }}>{t.label} <span style={{ color: T.text4 }}>›</span> <span style={{ color: t.color, fontWeight: 600 }}>{f}</span></span>
                        </button>
                      )) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// ── The chip field ────────────────────────────────────────────────────
function WfChipField({ value = [], onChange, placeholder, tokens, multiline, mono, minH, slash }) {
  const parts = value || [];
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef(null);
  const insertToken = (t) => { let next = parts.slice(); if (draft) { next = wf2MergeTail(next, draft); setDraft(''); } next.push(t); onChange(next); if (inputRef.current) inputRef.current.focus(); };
  const insertSlash = (cmd) => { const next = parts.slice(); next.push({ slash: cmd }); onChange(next); setDraft(''); if (inputRef.current) inputRef.current.focus(); };
  const commit = () => { if (draft) { onChange(wf2MergeTail(parts, draft)); setDraft(''); } };
  const removeAt = (i) => onChange(parts.filter((_, k) => k !== i));
  const slashOpen = slash && draft.startsWith('/');
  const slashMatches = slashOpen ? WF2_SLASH.filter(c => c.toLowerCase().startsWith(draft.toLowerCase())) : [];
  const onKey = (e) => {
    if (slashOpen && e.key === 'Enter') { e.preventDefault(); insertSlash(slashMatches[0] || draft); return; }
    if (e.key === 'Backspace' && !draft && parts.length) { e.preventDefault(); removeAt(parts.length - 1); }
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
  };
  return (
    <div style={{ position: 'relative', boxSizing: 'border-box', width: '100%', minHeight: minH || (multiline ? 60 : 32), display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: '6px 8px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content2, alignContent: 'flex-start' }}
      onClick={() => inputRef.current && inputRef.current.focus()}>
      {parts.map((p, i) => {
        if (wf2IsToken(p)) return <WfTokenChip key={i} token={p} sub={p.field} onRemove={() => removeAt(i)}/>;
        if (wf2IsSlash(p)) return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 20, padding: '0 4px 0 7px', borderRadius: RADIUS.full, background: wf2Rgba(ACCENT, 0.12), color: ACCENT, fontFamily: MONO, fontSize: FS.micro, fontWeight: 700 }}>{p.slash}
            <button onClick={() => removeAt(i)} style={{ width: 13, height: 13, border: 'none', borderRadius: '50%', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><Icon name="xmark" size={7} color={ACCENT}/></button></span>
        );
        return <span key={i} style={{ fontFamily: mono ? MONO : FONT, fontSize: FS.caption, color: T.text, whiteSpace: 'pre-wrap' }}>{p}</span>;
      })}
      <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit}
        placeholder={parts.length ? '' : placeholder}
        style={{ flex: '1 1 60px', minWidth: 60, border: 'none', outline: 'none', background: 'transparent', fontFamily: mono ? MONO : FONT, fontSize: FS.caption, color: T.text, padding: '2px 0' }}/>
      {tokens && <WfTokenPicker tokens={tokens} onInsert={insertToken} small anchor="right" label=""/>}
      {slashOpen && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 130, width: 224, maxHeight: 220, overflowY: 'auto', background: T.popBg, borderRadius: RADIUS.md, padding: 5, boxShadow: T.popShadow }}>
          <div style={{ padding: '4px 8px 5px', fontFamily: FONT, fontSize: FS.micro, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: T.text3 }}>Slash commands</div>
          {(slashMatches.length ? slashMatches : WF2_SLASH).map(cmd => (
            <button key={cmd} onMouseDown={(e) => { e.preventDefault(); insertSlash(cmd); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', borderRadius: RADIUS.sm, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: MONO, fontSize: FS.caption, fontWeight: 700, color: ACCENT }}
              onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>{cmd}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Curated schedule picker ───────────────────────────────────────────
function WfSchedulePicker({ trigger, onChange }) {
  const label = trigger.label || WF2_SCHEDULES[0].label;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <WfMiniSelect value={label} options={WF2_SCHEDULES.map(s => s.label)} width={220}
        onChange={(l) => { const s = WF2_SCHEDULES.find(x => x.label === l); onChange({ ...trigger, ...s }); }}/>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
        <WfToggle size="sm" on={trigger.onMissed !== false} onChange={(v) => onChange({ ...trigger, onMissed: v })}/>
        <span style={{ fontFamily: FONT, fontSize: FS.caption, color: T.text2 }}>{trigger.onMissed !== false ? 'If my Mac was off, run when it starts' : 'Skip missed runs'}</span>
      </label>
    </div>
  );
}

function WfMiniSelect({ value, onChange, options, width, mono }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ boxSizing: 'border-box', height: 30, width, padding: '0 24px 0 10px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content2, outline: 'none', appearance: 'none', cursor: 'pointer', fontFamily: mono ? MONO : FONT, fontSize: FS.caption, color: T.text }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><Icon name="chevron.down" size={9} color={T.text3}/></span>
    </span>
  );
}

Object.assign(window, { WfChipField, WfTokenPicker, WfChipText, WfSchedulePicker, WfMiniSelect, wf2MergeTail, wf2IsToken, wf2IsSlash });
