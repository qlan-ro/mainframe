// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Settings modal (warm-chrome redesign)
// A centered, dynamically-reached overlay. Mirrors the desktop app's
// SettingsModal feature set (Providers · General · Notifications ·
// Keybindings · Remote Access · About) but rendered in the warm-chrome
// visual language using shared tokens. Loaded after 04-engine; shares
// global scope (T, Icon, FONT, MONO, ACCENT are already defined).
//
// Portals to <body> so it renders at true viewport scale, unaffected by
// the ZoomStage CSS transform that scales the workspace.
// ════════════════════════════════════════════════════════════════

const SETTINGS_TABS = [
  { id: 'general',       label: 'General',       icon: 'sliders'  },
  { id: 'providers',     label: 'Providers',     icon: 'cpu'      },
  { id: 'notifications', label: 'Notifications', icon: 'bell'     },
  { id: 'keybindings',   label: 'Keybindings',   icon: 'keyboard' },
  { id: 'remote',        label: 'Remote Access', icon: 'globe'    },
  { id: 'about',         label: 'About',         icon: 'info'     },
];

// Provider adapters — colors mirror the app's mf-accent-* oklch tokens.
const SETTINGS_PROVIDERS = [
  { id: 'claude',   label: 'Claude',   color: 'oklch(0.66 0.17 44)',  installed: true,
    models: ['Default', 'Claude Opus 4.1', 'Claude Sonnet 4.5', 'Claude Haiku 4'],
    planMode: true, conflicts: ['permissionMode', 'allowedTools'] },
  { id: 'codex',    label: 'Codex',    color: 'oklch(0.64 0.15 163)', installed: true,
    models: ['Default', 'GPT-5', 'GPT-5 mini', 'o4'], planMode: false, conflicts: [] },
  { id: 'gemini',   label: 'Gemini',   color: 'oklch(0.58 0.19 262)', installed: false,
    models: ['Default', 'Gemini 2.5 Pro', 'Gemini 2.5 Flash'], planMode: true, conflicts: [] },
  { id: 'opencode', label: 'OpenCode', color: 'oklch(0.62 0.23 304)', installed: false,
    models: ['Default', 'Qwen3 Coder', 'Kimi K2'], planMode: true, conflicts: [] },
];

const SETTINGS_MODES = [
  { id: 'default',     label: 'Interactive',       desc: 'Prompts for everything' },
  { id: 'acceptEdits', label: 'Auto-Accept Edits', desc: 'Silently applies file edits, still prompts for bash' },
  { id: 'yolo',        label: 'Unattended',        desc: 'Auto-approves everything — use in isolated environments only', danger: true },
];

const SETTINGS_THEMES = [
  { id: 'claude',   label: 'Claude',   accent: 'oklch(0.66 0.17 44)'  },
  { id: 'codex',    label: 'Codex',    accent: 'oklch(0.64 0.15 163)' },
  { id: 'gemini',   label: 'Gemini',   accent: 'oklch(0.58 0.19 262)' },
  { id: 'opencode', label: 'OpenCode', accent: 'oklch(0.62 0.23 304)' },
];

// ── Shared small controls ─────────────────────────────────────────────
function SwToggle({ checked, onChange, danger }) {
  const on = checked;
  const tint = danger ? T.red : ACCENT;
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 38, height: 22, flexShrink: 0, borderRadius: 11, border: 'none', cursor: 'pointer',
      padding: 2, background: on ? tint : 'rgba(0,0,0,0.16)',
      transition: 'background 0.18s ease', position: 'relative',
    }}>
      <span style={{
        display: 'block', width: 18, height: 18, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transform: on ? 'translateX(16px)' : 'translateX(0)',
        transition: 'transform 0.18s cubic-bezier(.3,.8,.3,1)',
      }}/>
    </button>
  );
}

function StgLabel({ children, sub }) {
  return (
    <div style={{ marginBottom: sub ? 2 : 6 }}>
      <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: T.text2, letterSpacing: -0.05 }}>{children}</div>
    </div>
  );
}

function StgHelp({ children }) {
  return <p style={{ margin: '2px 0 8px', fontFamily: FONT, fontSize: 11, color: T.text3, lineHeight: 1.45, letterSpacing: -0.05 }}>{children}</p>;
}

function StgInput({ value, onChange, placeholder, type = 'text', mono }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <input type={type} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{
        flex: 1, minWidth: 0, height: 30, padding: '0 10px', borderRadius: 8,
        background: T.content, color: T.text, outline: 'none',
        border: `1px solid ${focus ? ACCENT : T.border}`,
        boxShadow: focus ? `0 0 0 3px ${ACCENT}1f` : 'none',
        fontFamily: mono ? MONO : FONT, fontSize: 12, letterSpacing: -0.05,
        transition: 'border-color .12s, box-shadow .12s',
      }}/>
  );
}

function StgBtn({ children, onClick, variant = 'plain', disabled }) {
  const V = {
    accent: { bg: ACCENT, fg: '#fff', bd: 'transparent' },
    plain:  { bg: T.content, fg: T.text2, bd: T.border },
    soft:   { bg: T.chipBg, fg: T.text, bd: 'transparent' },
  }[variant];
  return (
    <button onClick={onClick} disabled={disabled} style={{
      height: 30, padding: '0 12px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
      background: V.bg, color: V.fg, border: `1px solid ${V.bd}`,
      opacity: disabled ? 0.5 : 1, flexShrink: 0,
      fontFamily: FONT, fontSize: 12, fontWeight: 600, letterSpacing: -0.05,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      boxShadow: variant === 'accent' ? `0 1px 2px ${ACCENT}55` : 'none',
    }}>{children}</button>
  );
}

function StgHeading({ children }) {
  return <h3 style={{ margin: '0 0 16px', fontFamily: FONT, fontSize: 17, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>{children}</h3>;
}

// Checkbox + label + description row (used for provider toggles & mode radios).
function StgChoiceRow({ kind = 'check', checked, onChange, title, desc, danger }) {
  const [hover, setHover] = React.useState(false);
  const tint = danger ? T.red : ACCENT;
  return (
    <label onClick={() => onChange(!checked)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px',
        borderRadius: 8, cursor: 'pointer',
        background: hover ? T.rowHover : 'transparent', transition: 'background .1s',
      }}>
      <span style={{
        width: 17, height: 17, flexShrink: 0, marginTop: 1,
        borderRadius: kind === 'radio' ? '50%' : 5,
        border: `1.5px solid ${checked ? tint : T.text4}`,
        background: checked ? tint : T.content,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .12s',
      }}>
        {checked && kind === 'check' && <Icon name="checkmark" size={11} color="#fff" stroke={2.4}/>}
        {checked && kind === 'radio' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }}/>}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: danger ? T.red : T.text, letterSpacing: -0.05 }}>{title}</div>
        {desc && <div style={{ fontFamily: FONT, fontSize: 11, color: T.text3, lineHeight: 1.4, marginTop: 1, letterSpacing: -0.05 }}>{desc}</div>}
      </div>
    </label>
  );
}

// Toggle row (label left, switch right) for notifications.
function StgToggleRow({ title, desc, checked, onChange, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '11px 2px',
      borderBottom: last ? 'none' : `0.5px solid ${T.hairline}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: 12, color: T.text, letterSpacing: -0.05 }}>{title}</div>
        {desc && <div style={{ fontFamily: FONT, fontSize: 11, color: T.text3, marginTop: 1, letterSpacing: -0.05 }}>{desc}</div>}
      </div>
      <SwToggle checked={checked} onChange={onChange}/>
    </div>
  );
}

function StgGroup({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontFamily: FONT, fontSize: 10, fontWeight: 700, color: T.text3,
        textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4,
      }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

// ── Model dropdown ─────────────────────────────────────────────────────
function StgModelDropdown({ value, options, onChange }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', height: 30, padding: '0 10px', borderRadius: 8,
        background: T.content, border: `1px solid ${open ? ACCENT : T.border}`,
        boxShadow: open ? `0 0 0 3px ${ACCENT}1f` : 'none',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: FONT, fontSize: 12, color: T.text, letterSpacing: -0.05,
      }}>
        <span>{value}</span>
        <Icon name="chevron.down" size={11} color={T.text3}/>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 34, left: 0, right: 0, zIndex: 30,
          background: T.content, borderRadius: 8, padding: 4,
          border: `0.5px solid ${T.border}`, boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        }}>
          {options.map(o => {
            const sel = o === value;
            return (
              <button key={o} onClick={() => { onChange(o); setOpen(false); }} style={{
                width: '100%', textAlign: 'left', height: 28, padding: '0 9px', borderRadius: 6,
                border: 'none', cursor: 'pointer', background: sel ? T.selBg : 'transparent',
                color: sel ? T.text : T.text2, fontFamily: FONT, fontSize: 12, fontWeight: sel ? 600 : 500,
                letterSpacing: -0.05, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }} onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = T.rowHover; }}
                 onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}>
                {o}
                {sel && <Icon name="checkmark" size={11} color={ACCENT} stroke={2.2}/>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sections ────────────────────────────────────────────────────────────
function StgGeneral() {
  const [theme, setTheme] = React.useState('claude');
  const [worktree, setWorktree] = React.useState('.worktrees');
  const dirty = worktree !== '.worktrees';
  return (
    <div>
      <StgHeading>General</StgHeading>
      <div style={{ marginBottom: 22 }}>
        <StgLabel>Accent theme</StgLabel>
        <StgHelp>Tints selection, focus rings, and live-session indicators across the workspace.</StgHelp>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {SETTINGS_THEMES.map(th => {
            const sel = theme === th.id;
            return (
              <button key={th.id} onClick={() => setTheme(th.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
                cursor: 'pointer', textAlign: 'left',
                background: sel ? T.rowHover : T.content,
                border: `1px solid ${sel ? th.accent : T.border}`,
                boxShadow: sel ? `0 0 0 2px ${th.accent}33` : 'none', transition: 'all .12s',
              }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: th.accent, flexShrink: 0,
                  boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.12)' }}/>
                <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: sel ? 600 : 500, color: T.text, letterSpacing: -0.05 }}>{th.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <StgLabel>Worktree directory</StgLabel>
        <StgHelp>Relative directory name within each project for git worktrees.</StgHelp>
        <div style={{ display: 'flex', gap: 8 }}>
          <StgInput value={worktree} onChange={setWorktree} placeholder=".worktrees" mono/>
          {dirty && <StgBtn variant="accent" onClick={() => setWorktree('.worktrees')}>Save</StgBtn>}
        </div>
      </div>
    </div>
  );
}

function StgProvider({ provider }) {
  const [exec, setExec] = React.useState(provider.installed ? '' : '');
  const [askUser, setAskUser] = React.useState(provider.id === 'claude');
  const [planMode, setPlanMode] = React.useState(false);
  const [model, setModel] = React.useState('Default');
  const [mode, setMode] = React.useState('default');
  // Default model tuning (provider-level seeds new chats). Booleans + enums.
  const [defEffort, setDefEffort] = React.useState(null);
  const [defFeatures, setDefFeatures] = React.useState({ fast: false, ultracode: false, adaptiveThinking: false });
  const [personality, setPersonality] = React.useState('none');
  const [summary, setSummary] = React.useState('auto');
  const [verbosity, setVerbosity] = React.useState('medium');
  // reset per provider
  React.useEffect(() => {
    setExec(''); setAskUser(provider.id === 'claude'); setPlanMode(false); setModel('Default'); setMode('default');
    setDefEffort(null); setDefFeatures({ fast: false, ultracode: false, adaptiveThinking: false });
    setPersonality('none'); setSummary('auto'); setVerbosity('medium');
  }, [provider.id]);

  // Resolve the capability model for the chosen default model (settings provider
  // id → AI_PROVIDERS via `adapter`; 'Default' → the provider's default/first model).
  const aiProvider = AI_PROVIDERS.find(p => p.adapter === provider.id);
  const capModel = aiProvider && (
    model === 'Default'
      ? (aiProvider.models.find(m => m.isDefault) || aiProvider.models[0])
      : (aiProvider.models.find(m => m.name === model) || aiProvider.models[0])
  );
  const effortOpts = modelEfforts(capModel);
  const featureRows = capModel ? FEATURES.filter(f => modelCap(capModel, f.cap)) : [];
  const isCodex = provider.id === 'codex';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 18 }}>
        <span style={{
          width: 30, height: 30, borderRadius: 8, background: provider.color, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontFamily: FONT, fontSize: 15, fontWeight: 700,
          boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.12)',
        }}>{provider.label.charAt(0)}</span>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 17, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>{provider.label}</div>
          <div style={{ fontFamily: FONT, fontSize: 11, color: provider.installed ? T.green : T.text3, letterSpacing: -0.05, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: provider.installed ? T.green : T.text4 }}/>
            {provider.installed ? 'Detected on PATH' : 'Not installed'}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <StgLabel>Executable path</StgLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <StgInput value={exec} onChange={setExec} placeholder={provider.id} mono/>
          <StgBtn onClick={() => {}}>Browse…</StgBtn>
        </div>
        {!provider.installed && <StgHelp>Not found on PATH — Browse to select the binary.</StgHelp>}
      </div>

      {provider.conflicts.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px', borderRadius: 8,
          background: `${T.amber}14`, border: `1px solid ${T.amber}33`, marginBottom: 18,
        }}>
          <Icon name="exclamationmark.triangle" size={14} color={T.amber}/>
          <p style={{ margin: 0, fontFamily: FONT, fontSize: 11, color: T.amber, lineHeight: 1.45, letterSpacing: -0.05 }}>
            <code style={{ fontFamily: MONO, fontSize: 11 }}>settings.json</code> defines {provider.conflicts.join(', ')}. Mainframe flags take precedence when launching sessions.
          </p>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <StgChoiceRow checked={askUser} onChange={setAskUser}
          title="Enforce AskUserQuestion for agent questions"
          desc="Instructs the agent to use the interactive question tool instead of asking in plain text."/>
        {provider.planMode && (
          <StgChoiceRow checked={planMode} onChange={setPlanMode}
            title="Start in Plan Mode"
            desc="New chats begin with plan mode enabled. You can toggle it off mid-session."/>
        )}
      </div>

      <div style={{ marginBottom: 18 }}>
        <StgLabel>Default model</StgLabel>
        <StgModelDropdown value={model} options={provider.models} onChange={setModel}/>
      </div>

      {effortOpts.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <StgLabel>Default reasoning effort</StgLabel>
          <StgHelp>Seeds new chats; per-chat effort overrides it in the composer.</StgHelp>
          <StgModelDropdown
            value={EFFORT_META[defEffort || (capModel && capModel.defaultEffort) || 'medium'].label}
            options={effortOpts.map(e => EFFORT_META[e].label)}
            onChange={(lbl) => setDefEffort(effortOpts.find(e => EFFORT_META[e].label === lbl) || null)}/>
        </div>
      )}

      {featureRows.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <StgLabel>Default features</StgLabel>
          <div style={{ borderTop: `0.5px solid ${T.hairline}` }}>
            {featureRows.map((f, i) => (
              <StgToggleRow key={f.key} title={f.label} desc={f.desc}
                checked={!!defFeatures[f.key]}
                onChange={(v) => setDefFeatures(s => ({ ...s, [f.key]: v }))}
                last={i === featureRows.length - 1}/>
            ))}
          </div>
        </div>
      )}

      {isCodex && (
        <div style={{ marginBottom: 18 }}>
          <StgLabel>Codex model tuning</StgLabel>
          <StgHelp>Codex-only knobs applied per turn.</StgHelp>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {capModel && modelCap(capModel, 'supportsPersonality') && (
              <div>
                <div style={{ fontFamily: FONT, fontSize: 11, color: T.text3, marginBottom: 5, letterSpacing: -0.05 }}>Personality</div>
                <StgModelDropdown value={personality} options={['none', 'friendly', 'pragmatic']} onChange={setPersonality}/>
              </div>
            )}
            <div>
              <div style={{ fontFamily: FONT, fontSize: 11, color: T.text3, marginBottom: 5, letterSpacing: -0.05 }}>Reasoning summary</div>
              <StgModelDropdown value={summary} options={['auto', 'concise', 'detailed', 'none']} onChange={setSummary}/>
            </div>
            <div>
              <div style={{ fontFamily: FONT, fontSize: 11, color: T.text3, marginBottom: 5, letterSpacing: -0.05 }}>Verbosity</div>
              <StgModelDropdown value={verbosity} options={['low', 'medium', 'high']} onChange={setVerbosity}/>
            </div>
          </div>
        </div>
      )}

      <div>
        <StgLabel>Default session mode</StgLabel>
        <div>
          {SETTINGS_MODES.map(m => (
            <StgChoiceRow key={m.id} kind="radio" checked={mode === m.id} onChange={() => setMode(m.id)}
              title={m.label} desc={m.desc} danger={m.danger}/>
          ))}
        </div>
      </div>
    </div>
  );
}

function StgNotifications() {
  const [n, setN] = React.useState({
    taskComplete: true, sessionError: true,
    toolRequest: true, userQuestion: true, planApproval: false,
    plugin: true,
  });
  const set = (k) => (v) => setN(s => ({ ...s, [k]: v }));
  return (
    <div>
      <StgHeading>Notifications</StgHeading>
      <StgGroup title="Chat">
        <StgToggleRow title="Task Complete" desc="Notify when the assistant finishes a turn." checked={n.taskComplete} onChange={set('taskComplete')}/>
        <StgToggleRow title="Session Error" desc="Notify when a run fails or errors out." checked={n.sessionError} onChange={set('sessionError')} last/>
      </StgGroup>
      <StgGroup title="Permission Requests">
        <StgToggleRow title="Tool Permission Requests" desc="Notify when the CLI asks to run a tool." checked={n.toolRequest} onChange={set('toolRequest')}/>
        <StgToggleRow title="User Question" desc="Notify when the agent asks an interactive question." checked={n.userQuestion} onChange={set('userQuestion')}/>
        <StgToggleRow title="Plan Approval" desc="Notify when the agent presents a plan for approval." checked={n.planApproval} onChange={set('planApproval')} last/>
      </StgGroup>
      <StgGroup title="Other">
        <StgToggleRow title="Plugin Notifications" desc="Notify for events from plugins (todos, PR detection, etc.)." checked={n.plugin} onChange={set('plugin')} last/>
      </StgGroup>
    </div>
  );
}

function StgKeybindings() {
  const BINDINGS = [
    { k: 'Open settings', c: ['⌘', ','] },
    { k: 'Command palette', c: ['⌘', 'O'] },
    { k: 'Find in files', c: ['⌘', '⇧', 'F'] },
    { k: 'New session', c: ['⌘', 'N'] },
    { k: 'Toggle sidebar', c: ['⌘', '\\'] },
    { k: 'Toggle inspector', c: ['⌘', '⌥', 'I'] },
    { k: 'Switch surface', c: ['⌘', '1–3'] },
  ];
  return (
    <div>
      <StgHeading>Keybindings</StgHeading>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 8,
        background: T.chipBg, marginBottom: 16,
      }}>
        <Icon name="lock" size={11} color={T.text3}/>
        <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3, letterSpacing: -0.05 }}>Customization coming soon — defaults shown below</span>
      </div>
      <div style={{ border: `0.5px solid ${T.border}`, borderRadius: 11, overflow: 'hidden' }}>
        {BINDINGS.map((b, i) => (
          <div key={b.k} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 12px', background: i % 2 ? T.content2 : T.content,
            borderBottom: i === BINDINGS.length - 1 ? 'none' : `0.5px solid ${T.hairline}`,
          }}>
            <span style={{ fontFamily: FONT, fontSize: 12, color: T.text, letterSpacing: -0.05 }}>{b.k}</span>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              {b.c.map((key, j) => (
                <kbd key={j} style={{
                  minWidth: 20, height: 20, padding: '0 6px', borderRadius: 6,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: T.content, border: `0.5px solid ${T.border}`, boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
                  fontFamily: FONT, fontSize: 11, fontWeight: 600, color: T.text2,
                }}>{key}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Mocked tunnel state machine: idle → starting → verifying → ready.
function StgRemote() {
  const [state, setState] = React.useState('idle'); // idle | starting | verifying | ready
  const [copied, setCopied] = React.useState(false);
  const [pairCode, setPairCode] = React.useState(null);
  const [secs, setSecs] = React.useState(0);
  const timers = React.useRef([]);
  const url = 'https://swift-meadow-4821.trycloudflare.com';

  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const start = () => {
    setState('starting');
    timers.current.push(setTimeout(() => setState('verifying'), 900));
    timers.current.push(setTimeout(() => setState('ready'), 2200));
  };
  const stop = () => { timers.current.forEach(clearTimeout); setState('idle'); setPairCode(null); };
  const running = state !== 'idle';

  React.useEffect(() => {
    if (!pairCode) return;
    setSecs(300);
    const iv = setInterval(() => setSecs(s => { if (s <= 1) { clearInterval(iv); setPairCode(null); return 0; } return s - 1; }), 1000);
    return () => clearInterval(iv);
  }, [pairCode]);
  const genCode = () => setPairCode(`${Math.floor(100 + Math.random()*900)}-${Math.floor(100 + Math.random()*900)}`);

  const statusRow = () => {
    if (state === 'idle') return null;
    if (state === 'starting' || state === 'verifying') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 8, background: T.content2, border: `0.5px solid ${T.border}` }}>
          <Icon name="arrow.clockwise" size={12} color={T.amber} style={{ animation: 'tw-spin 0.9s linear infinite' }}/>
          <span style={{ fontFamily: FONT, fontSize: 12, color: T.text2, letterSpacing: -0.05 }}>{state === 'starting' ? 'Starting tunnel…' : 'Verifying DNS…'}</span>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 8, background: T.content2, border: `0.5px solid ${T.border}` }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.green, flexShrink: 0 }}/>
        <code style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 11, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</code>
        <button title="Copy URL" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={{
          width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name={copied ? 'checkmark' : 'copy'} size={12} color={copied ? T.green : T.text3}/></button>
      </div>
    );
  };

  return (
    <div>
      <StgHeading>Remote Access</StgHeading>

      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <div>
            <StgLabel>Quick Tunnel</StgLabel>
            <StgHelp>Ephemeral tunnel via trycloudflare.com — a new URL each start.</StgHelp>
          </div>
          <StgBtn variant={running ? 'plain' : 'accent'} onClick={running ? stop : start}>
            {state === 'starting' ? 'Starting…' : running ? 'Stop' : 'Start'}
          </StgBtn>
        </div>
        {statusRow()}
      </div>

      {state === 'ready' && (
        <div style={{ marginBottom: 22 }}>
          <StgLabel>Mobile Pairing</StgLabel>
          <StgHelp>Generate a code to pair a mobile device.</StgHelp>
          {pairCode ? (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px',
                borderRadius: 11, background: T.content2, border: `0.5px solid ${T.border}`,
              }}>
                <span style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, letterSpacing: 8, color: T.text }}>{pairCode}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }}>
                <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3 }}>Expires in {Math.floor(secs/60)}:{String(secs%60).padStart(2,'0')}</span>
                <button onClick={genCode} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: FONT, fontSize: 11, fontWeight: 600, color: ACCENT }}>Generate new</button>
              </div>
            </div>
          ) : (
            <StgBtn variant="accent" onClick={genCode}>Generate Pairing Code</StgBtn>
          )}
        </div>
      )}

      <div>
        <StgLabel>Paired Devices</StgLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
          {[
            { name: "Sam's iPhone 16", date: 'May 28, 2026' },
            { name: 'iPad Pro', date: 'Apr 11, 2026' },
          ].map(d => (
            <div key={d.name} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '9px 11px', borderRadius: 8, background: T.content2, border: `0.5px solid ${T.border}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <Icon name="smartphone" size={14} color={T.text2}/>
                <span style={{ fontFamily: FONT, fontSize: 12, color: T.text, letterSpacing: -0.05 }}>{d.name}</span>
                <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3 }}>{d.date}</span>
              </div>
              <button title="Remove device" style={{
                width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }} onMouseEnter={(e) => e.currentTarget.firstChild.style.opacity = 1}
                 onMouseLeave={(e) => e.currentTarget.firstChild.style.opacity = 0.55}>
                <span style={{ display: 'inline-flex', opacity: 0.55, transition: 'opacity .12s' }}><Icon name="trash" size={12} color={T.red}/></span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StgAbout() {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 13, flexShrink: 0,
          background: `linear-gradient(145deg, ${ACCENT}, oklch(0.62 0.23 304))`,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 16px rgba(0,0,0,0.18), inset 0 0 0 0.5px rgba(255,255,255,0.25)',
          color: '#fff', fontFamily: FONT, fontSize: 28, fontWeight: 800,
        }}>m</div>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700, color: T.text, letterSpacing: -0.4 }}>Mainframe</div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: T.text2, letterSpacing: -0.05 }}>AI-native development environment</div>
        </div>
      </div>
      <div style={{ border: `0.5px solid ${T.border}`, borderRadius: 11, overflow: 'hidden' }}>
        {[
          ['Version', '0.20.0'],
          ['Author', 'qlan.ro'],
          ['Channel', 'Stable'],
          ['Electron', '33.2.1'],
        ].map((r, i, a) => (
          <div key={r[0]} style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '11px 14px',
            borderBottom: i === a.length - 1 ? 'none' : `0.5px solid ${T.hairline}`,
          }}>
            <span style={{ width: 80, flexShrink: 0, fontFamily: FONT, fontSize: 12, color: T.text3, letterSpacing: -0.05 }}>{r[0]}</span>
            <span style={{ fontFamily: r[0] === 'Author' ? FONT : MONO, fontSize: 12, color: T.text, letterSpacing: -0.05 }}>{r[1]}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <StgBtn variant="accent"><Icon name="arrow.down" size={12} color="#fff"/>Check for updates</StgBtn>
        <StgBtn>Release notes</StgBtn>
      </div>
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────
function SettingsModal({ open, onClose }) {
  const [tab, setTab] = React.useState('general');
  const [provider, setProvider] = React.useState('claude');

  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  const activeProvider = SETTINGS_PROVIDERS.find(p => p.id === provider);

  const renderContent = () => {
    switch (tab) {
      case 'general': return <StgGeneral/>;
      case 'providers': return <StgProvider provider={activeProvider}/>;
      case 'notifications': return <StgNotifications/>;
      case 'keybindings': return <StgKeybindings/>;
      case 'remote': return <StgRemote/>;
      case 'about': return <StgAbout/>;
      default: return null;
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT,
    }}>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(40,36,30,0.32)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
      }}/>
      <div style={{
        position: 'relative', width: 760, height: 600, maxWidth: '92vw', maxHeight: '90vh',
        background: T.content, borderRadius: 13, overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.34), 0 0 0 0.5px rgba(0,0,0,0.16)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          height: 50, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 18px', borderBottom: `0.5px solid ${T.hairline}`, background: T.content2,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>Settings</span>
          <button onClick={onClose} title="Close (Esc)" style={{
            width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
             onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="xmark" size={13} color={T.text2}/>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Sidebar */}
          <div style={{
            width: 184, flexShrink: 0, background: T.content2, borderRight: `0.5px solid ${T.hairline}`,
            padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto',
          }}>
            {SETTINGS_TABS.map(t => {
              const active = tab === t.id && !(t.id === 'providers' && tab === 'providers');
              const isActiveTab = tab === t.id;
              return (
                <React.Fragment key={t.id}>
                  <button onClick={() => setTab(t.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 8,
                    border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
                    background: (isActiveTab && t.id !== 'providers') ? `${ACCENT}14` : 'transparent',
                    color: (isActiveTab && t.id !== 'providers') ? T.text : T.text2,
                  }} onMouseEnter={(e) => { if (!(isActiveTab && t.id !== 'providers')) e.currentTarget.style.background = T.rowHover; }}
                     onMouseLeave={(e) => { if (!(isActiveTab && t.id !== 'providers')) e.currentTarget.style.background = 'transparent'; }}>
                    <Icon name={t.icon} size={14} color={(isActiveTab && t.id !== 'providers') ? ACCENT : T.text3}/>
                    <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: (isActiveTab && t.id !== 'providers') ? 600 : 500, letterSpacing: -0.05 }}>{t.label}</span>
                  </button>
                  {t.id === 'providers' && tab === 'providers' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '1px 0 2px' }}>
                      {SETTINGS_PROVIDERS.map(p => {
                        const sel = provider === p.id;
                        return (
                          <button key={p.id} onClick={() => setProvider(p.id)} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 9px 5px 26px', cursor: 'pointer',
                            border: 'none', background: sel ? `${ACCENT}10` : 'transparent', textAlign: 'left', width: '100%',
                            borderLeft: `2px solid ${sel ? p.color : 'transparent'}`,
                          }} onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = T.rowHover; }}
                             onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}>
                            <span style={{
                              width: 15, height: 15, borderRadius: 4, background: p.color, flexShrink: 0,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontFamily: FONT, fontSize: 10, fontWeight: 700,
                              boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.12)',
                            }}>{p.label.charAt(0)}</span>
                            <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: sel ? 600 : 500, color: sel ? T.text : T.text2, letterSpacing: -0.05 }}>{p.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '22px 26px 32px' }}>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

window.SettingsModal = SettingsModal;
