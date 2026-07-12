// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Automations (Workflows v2) · FOUNDATION
// Per the approved v2 spec (2026-07-11): the engine grammar is REPLACED,
// not restyled. An Automation = When (triggers) + Do (a linear list of
// steps). Four verbs (Ask agent · Ask me · Run an action · Notify me) and
// two blocks (If · Repeat). No YAML, no expression language, no step ids,
// no scoping rules exposed. Data flows through pickable TOKENS.
// This module holds: metadata (verbs, triggers, curated events, the action
// catalog, comparators, built-in tokens), the token model + scope helper,
// the six reference-automation seeds + run/notification seeds, and small
// shared visual atoms. Feature label stays "Workflows"; the model is v2.
// Depends on: 01-base (T, Icon, FONT, MONO, ACCENT, RADIUS, FS).
// → window.WF2 (namespace bag) + individual globals for later modules.
// ════════════════════════════════════════════════════════════════

function wf2Rgba(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── Token model ───────────────────────────────────────────────────────
// A token is a pickable chip standing for a value produced upstream. It
// carries only friendly display info — never an id or path the user sees.
// type drives which comparators/repeat-eligibility apply.
// A chip-field VALUE is an array of parts: a plain string, or a token obj.
const WF2_TTYPE = { text: 'text', number: 'number', list: 'list', choice: 'choice', date: 'date', object: 'object' };
function tk(label, opts = {}) {
  return { tok: true, label, type: opts.type || 'text', color: opts.color || '#5e5d5a', icon: opts.icon || 'circle.dot', fields: opts.fields || null, options: opts.options || null, source: opts.source || '' };
}
// Curated slash commands offered when a prompt field sees a leading "/".
const WF2_SLASH = ['/codex-review', '/pending-work', '/ship-work', '/plan', '/summarize', '/test'];
function txt(s) { return s; }

const WF2_BUILTINS = [
  tk('Today', { type: 'date', color: '#5e5d5a', icon: 'calendar', source: 'Built-in' }),
  tk('Now', { type: 'date', color: '#5e5d5a', icon: 'clock', source: 'Built-in' }),
];

// Colors by producing source (kept few + harmonious).
const WF2_SRC = {
  agent:   ACCENT,
  askme:   '#c2540a',
  action:  '#7a4d9e',
  trigger: '#2a6fdb',
  item:    '#1f8a5b',
  builtin: '#5e5d5a',
};

// ── The four verbs + two blocks ───────────────────────────────────────
const WF2_VERB = {
  agent:  { icon: 'sparkles', color: WF2_SRC.agent,  label: 'Ask agent',     hint: 'Hand a task to an AI agent and wait for the result' },
  askme:  { icon: 'chat',     color: WF2_SRC.askme,  label: 'Ask me',        hint: 'Pause and wait for my answer — desktop or phone' },
  action: { icon: 'plug',     color: WF2_SRC.action, label: 'Run an action', hint: 'A deterministic call — no agent, no tokens spent' },
  notify: { icon: 'bell',     color: '#0f766e',      label: 'Notify me',     hint: 'Send a desktop / mobile notification' },
  if:     { icon: 'branch',           color: '#5b269a', label: 'If … otherwise', hint: 'Branch on a result', block: true },
  repeat: { icon: 'arrow.clockwise',  color: '#1f8a5b', label: 'Repeat for each', hint: 'Run steps once per item in a list', block: true },
};
const WF2_ADD_GROUPS = [
  { label: 'Steps', kinds: ['agent', 'askme', 'action', 'notify'] },
  { label: 'Add structure', kinds: ['if', 'repeat'] },
];
const WF2_BLOCK = new Set(['if', 'repeat']);

// ── Triggers ──────────────────────────────────────────────────────────
const WF2_TRIGGER_META = {
  schedule: { icon: 'calendar',  color: WF2_SRC.trigger, label: 'On a schedule',        hint: 'Runs automatically at set times' },
  event:    { icon: 'bolt',      color: WF2_SRC.trigger, label: 'When something happens', hint: 'React to an event' },
  webhook:  { icon: 'globe',     color: WF2_SRC.trigger, label: 'Webhook',              hint: 'An auto-generated URL calls it', advanced: true },
  manual:   { icon: 'play.fill', color: '#5e5d5a',       label: 'Manually',             hint: 'Always runnable by hand' },
};
const WF2_SCHEDULES = [
  { label: 'Every day at 21:00', at: '21:00' },
  { label: 'Every day at 8:00', at: '08:00' },
  { label: 'Weekdays at 6:00', at: '06:00', days: 'weekdays' },
  { label: 'Weekdays at 9:00', at: '09:00', days: 'weekdays' },
  { label: 'Every Monday at 9:00', at: '09:00', days: 'mon' },
  { label: 'Every 4 hours', every: '4h' },
];
// Curated events — each contributes typed tokens.
const WF2_EVENTS = [
  { id: 'session.finished', group: 'App',    label: 'A chat session finishes', tokens: [tk('Session', { color: WF2_SRC.trigger, icon: 'chat' })] },
  { id: 'run.failed',       group: 'App',    label: 'A run fails',              tokens: [tk('Failed run', { color: WF2_SRC.trigger, icon: 'exclamationmark.triangle' })] },
  { id: 'pr.opened',        group: 'GitHub', label: 'A pull request is opened', tokens: [tk('PR', { type: 'object', color: WF2_SRC.trigger, icon: 'branch', fields: ['URL', 'title', 'author'] })] },
  { id: 'pr.merged',        group: 'GitHub', label: 'A pull request is merged', tokens: [tk('PR', { type: 'object', color: WF2_SRC.trigger, icon: 'branch', fields: ['URL', 'title', 'author'] })] },
  { id: 'automation.done',  group: 'Chaining', label: 'Another automation finishes', tokens: [tk('Its result', { color: WF2_SRC.trigger, icon: 'bolt' })] },
  { id: 'automation.failed',group: 'Chaining', label: 'Another automation fails',     tokens: [tk('Its error', { color: WF2_SRC.trigger, icon: 'exclamationmark.triangle' })] },
];

// ── Comparators by token type ─────────────────────────────────────────
const WF2_COMPARATORS = {
  text:   ['is', 'is not', 'contains', 'starts with'],
  number: ['=', '≠', '<', '>'],
  list:   ['is empty', 'is not empty', 'contains'],
  choice: ['is', 'is not'],
  date:   ['is', 'is before', 'is after'],
  object: ['is set', 'is not set'],
};

// ── The action catalog ────────────────────────────────────────────────
// Three sources: built-ins, curated connectors, MCP tools. Each action
// declares a form (fields) and the tokens it produces.
const WF2_CATALOG = [
  // Built-ins
  { id: 'run_command', source: 'builtin', name: 'Run a command', icon: 'terminal', color: '#3a3a3c', blurb: 'Run a shell script; capture its output.',
    fields: [
      { key: 'script', label: 'Script', type: 'code', chips: true, placeholder: 'pnpm test' },
      { key: 'runin', label: 'Run in', type: 'select', options: ['Project root', 'Worktree', 'Custom…'] },
      { key: 'output', label: 'Treat output as', type: 'segment', options: ['Text', 'Lines (list)'] },
    ],
    produces: (s) => [tk('Output', { type: s && s.args && s.args.output === 'Lines (list)' ? 'list' : 'text', color: WF2_SRC.action, icon: 'terminal' }), tk('Exit code', { type: 'number', color: WF2_SRC.action, icon: 'terminal' })] },
  { id: 'files', source: 'builtin', name: 'Files', icon: 'doc.text', color: '#2f6f78', blurb: 'Append, write or read a file.',
    fields: [
      { key: 'op', label: 'Operation', type: 'segment', options: ['Append', 'Write', 'Read'] },
      { key: 'path', label: 'File', type: 'chip', chips: true, placeholder: '~/notes/log.md' },
      { key: 'text', label: 'Text', type: 'chiparea', chips: true, showIf: (a) => a.op !== 'Read' },
    ],
    produces: (s) => (s && s.args && s.args.op === 'Read') ? [tk('File text', { type: 'text', color: WF2_SRC.action, icon: 'doc.text' })] : [] },
  { id: 'http', source: 'builtin', advanced: true, name: 'HTTP request', icon: 'globe', color: '#0a6cba', blurb: 'Call any HTTP endpoint.',
    fields: [
      { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST', 'PUT', 'DELETE'] },
      { key: 'url', label: 'URL', type: 'chip', chips: true, placeholder: 'https://api.example.com/…' },
      { key: 'body', label: 'Body', type: 'chiparea', chips: true, showIf: (a) => a.method !== 'GET' },
      { key: 'credential', label: 'Credential', type: 'credential', service: 'this endpoint' },
    ],
    produces: () => [tk('Response', { type: 'text', color: WF2_SRC.action, icon: 'globe' }), tk('Status', { type: 'number', color: WF2_SRC.action, icon: 'globe' })] },
  // Curated connectors
  { id: 'github.create_pr', source: 'connector', connector: 'GitHub', name: 'Create a pull request', icon: 'branch', color: '#24292f', blurb: 'Open a PR on GitHub.',
    fields: [
      { key: 'title', label: 'Title', type: 'chip', chips: true },
      { key: 'body', label: 'Body', type: 'chiparea', chips: true },
      { key: 'base', label: 'Base branch', type: 'text', placeholder: 'main' },
      { key: 'credential', label: 'Account', type: 'credential', service: 'GitHub' },
    ],
    produces: () => [tk('PR', { type: 'object', color: WF2_SRC.action, icon: 'branch', fields: ['URL', 'number'] })] },
  { id: 'github.list_prs', source: 'connector', connector: 'GitHub', list: true, name: 'List my open PRs', icon: 'branch', color: '#24292f', blurb: 'Get your open pull requests as a list.',
    fields: [{ key: 'credential', label: 'Account', type: 'credential', service: 'GitHub' }],
    produces: () => [tk('Open PRs', { type: 'list', color: WF2_SRC.action, icon: 'branch', fields: ['URL', 'title', 'author'] })] },
  { id: 'notion.add_row', source: 'connector', connector: 'Notion', name: 'Add a database row', icon: 'doc.text', color: '#111', blurb: 'Pick a database; its columns become fields.',
    fields: [
      { key: 'database', label: 'Database', type: 'select', options: ['Health Log', 'Reading list', 'Standup notes'] },
      { key: '__columns', label: 'Row', type: 'notion-columns' },
      { key: 'credential', label: 'Account', type: 'credential', service: 'Notion' },
    ],
    produces: () => [tk('Notion page', { type: 'object', color: WF2_SRC.action, icon: 'doc.text', fields: ['URL'] })] },
  { id: 'ado.create_item', source: 'connector', connector: 'Azure DevOps', name: 'Create a work item', icon: 'checklist.box', color: '#0067b8', blurb: 'File a work item in Azure DevOps.',
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: ['Task', 'Bug', 'User Story'] },
      { key: 'title', label: 'Title', type: 'chip', chips: true },
      { key: 'description', label: 'Description', type: 'chiparea', chips: true },
      { key: 'credential', label: 'Account', type: 'credential', service: 'Azure DevOps' },
    ],
    produces: () => [tk('Work item ID', { type: 'number', color: WF2_SRC.action, icon: 'checklist.box' })] },
  // MCP tools (auto-formed from schema)
  { id: 'mcp.linear.create_issue', source: 'mcp', server: 'Linear', name: 'linear · create_issue', icon: 'cpu', color: '#5b5fc7', blurb: 'MCP tool — form auto-generated from its schema.',
    fields: [
      { key: 'team', label: 'team', type: 'select', options: ['Core', 'Growth'] },
      { key: 'title', label: 'title', type: 'chip', chips: true },
      { key: 'priority', label: 'priority', type: 'select', options: ['None', 'Low', 'Medium', 'High', 'Urgent'] },
    ],
    produces: () => [tk('Issue', { type: 'object', color: WF2_SRC.action, icon: 'cpu', fields: ['URL', 'id'] })] },
  { id: 'mcp.playwright.screenshot', source: 'mcp', server: 'Playwright', name: 'playwright · screenshot', icon: 'cpu', color: '#5b5fc7', blurb: 'MCP tool — form auto-generated from its schema.',
    fields: [
      { key: 'url', label: 'url', type: 'chip', chips: true },
      { key: 'fullPage', label: 'fullPage', type: 'segment', options: ['true', 'false'] },
    ],
    produces: () => [tk('Screenshot', { type: 'object', color: WF2_SRC.action, icon: 'photo', fields: ['path'] })] },
];
const WF2_CATALOG_SOURCES = [
  { id: 'builtin', label: 'Built-in', hint: 'Ship with the app' },
  { id: 'connector', label: 'Connectors', hint: 'Curated services' },
  { id: 'mcp', label: 'Your MCP tools', hint: 'From your configured servers' },
];
function wf2ActionById(id) { return WF2_CATALOG.find(a => a.id === id); }

// ── Token scope — the invisible rule made concrete ────────────────────
// Tokens visible before a step = trigger tokens + built-ins + every token
// produced by earlier steps at this level or an ancestor. Inside a Repeat,
// add ⟨Current item⟩ (+ its fields). Grouped for the picker.
function wf2StepProduces(step) {
  if (!step) return [];
  if (step.kind === 'agent') return [tk('Agent result', { color: WF2_SRC.agent, icon: 'sparkles', source: step.title || 'Ask agent' })];
  if (step.kind === 'askme') return (step.fields || []).filter(f => f.key).map(f => tk(f.label || f.key, { type: f.type === 'multi' ? 'list' : (f.type === 'choice' ? 'choice' : f.type === 'number' ? 'number' : 'text'), color: WF2_SRC.askme, icon: 'chat', source: step.title || 'Ask me', options: f.options }));
  if (step.kind === 'action') { const a = wf2ActionById(step.actionId); return a ? a.produces(step).map(t => ({ ...t, source: step.title || a.name })) : []; }
  if (step.kind === 'if') {
    // Branch results leak to later siblings (matches wf2Validate): aggregate
    // every token produced inside then/else into the parent scope so the
    // picker can offer them after the block. Repeat stays isolated — its
    // ⟨Current item⟩ must never escape the bracket, so it is NOT handled here.
    const out = [];
    const collect = (steps) => (steps || []).forEach(s => wf2StepProduces(s).forEach(t => out.push(t)));
    collect(step.then); collect(step.else);
    return out;
  }
  return [];
}
function wf2TriggerTokens(triggers) {
  const out = [];
  (triggers || []).forEach(t => { if (t.kind === 'event') { const e = WF2_EVENTS.find(x => x.id === t.event); if (e) e.tokens.forEach(tok => out.push({ ...tok, source: 'Trigger' })); } });
  return out;
}
// Grouped token list for the picker, given everything visible.
function wf2GroupTokens(tokens) {
  const groups = [];
  const bySource = {};
  tokens.forEach(t => { const s = t.source || 'Other'; (bySource[s] = bySource[s] || []).push(t); });
  Object.keys(bySource).forEach(s => groups.push({ source: s, tokens: bySource[s] }));
  return groups;
}

// ════════════════════════════════════════════════════════════════
// Small shared visual atoms
// ════════════════════════════════════════════════════════════════
function WfIconBtn({ icon, size = 13, title, onClick, danger }) {
  return (
    <button title={title} onClick={onClick} style={{ width: 28, height: 28, borderRadius: RADIUS.sm, border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      onMouseEnter={(e) => e.currentTarget.style.background = T.chipBg} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <Icon name={icon} size={size} color={danger ? T.red : T.text3}/>
    </button>
  );
}
function WfToggle({ on, onChange, size = 'md' }) {
  const w = size === 'sm' ? 30 : 38, h = size === 'sm' ? 18 : 22, k = h - 4;
  return (
    <button onClick={() => onChange && onChange(!on)} style={{ width: w, height: h, borderRadius: h, border: 'none', background: on ? ACCENT : T.text4, position: 'relative', cursor: 'pointer', padding: 0, transition: 'background .15s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 2, left: on ? w - k - 2 : 2, width: k, height: k, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}/>
    </button>
  );
}
function WfSeg({ value, onChange, options, size = 'md' }) {
  return (
    <div style={{ display: 'inline-flex', padding: 2, borderRadius: RADIUS.md, background: T.chipBg, gap: 2 }}>
      {options.map(o => {
        const id = typeof o === 'string' ? o : o.id, label = typeof o === 'string' ? o : o.label;
        const on = value === id;
        return <button key={id} onClick={() => onChange(id)} style={{ padding: size === 'sm' ? '3px 9px' : '5px 11px', borderRadius: RADIUS.sm, border: 'none', cursor: 'pointer', background: on ? T.content : 'transparent', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.13)' : 'none', color: on ? T.text : T.text3, fontFamily: FONT, fontSize: size === 'sm' ? FS.micro : FS.label, fontWeight: on ? 600 : 500, whiteSpace: 'nowrap' }}>{label}</button>;
      })}
    </div>
  );
}
// A token chip (read-only display).
function WfTokenChip({ token, onRemove, sub }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: onRemove ? '0 3px 0 7px' : '0 8px', borderRadius: RADIUS.full, background: wf2Rgba(token.color, 0.12), border: `0.5px solid ${wf2Rgba(token.color, 0.35)}`, color: token.color, fontFamily: FONT, fontSize: FS.micro, fontWeight: 700, verticalAlign: 'middle', maxWidth: 220 }}>
      <Icon name={token.icon} size={9} color={token.color}/>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.label}{sub ? ' › ' + sub : ''}</span>
      {onRemove && <button onClick={onRemove} style={{ width: 13, height: 13, border: 'none', borderRadius: '50%', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><Icon name="xmark" size={7} color={token.color}/></button>}
    </span>
  );
}
function wf2Field(extra) {
  return { boxSizing: 'border-box', width: '100%', minHeight: 30, padding: '6px 10px', borderRadius: RADIUS.md, border: `0.5px solid ${T.border}`, background: T.content2, outline: 'none', fontFamily: FONT, fontSize: FS.body, color: T.text, ...extra };
}
const wf2Lbl = { fontFamily: FONT, fontSize: FS.micro, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: T.text3 };

// Status vocab for runs.
const WF2_RUN_STATUS = {
  running:   { label: 'Running',  color: ACCENT,     icon: 'arrow.clockwise' },
  waiting:   { label: 'Waiting',  color: T.amber,    icon: 'clock' },
  succeeded: { label: 'Done',     color: T.green,    icon: 'checkmark' },
  failed:    { label: 'Failed',   color: T.red,      icon: 'exclamationmark.triangle' },
  skipped:   { label: 'Skipped',  color: T.text4,    icon: 'chevron.down' },
};

Object.assign(window, {
  wf2Rgba, tk, txt, WF2_TTYPE, WF2_BUILTINS, WF2_SRC, WF2_VERB, WF2_ADD_GROUPS, WF2_BLOCK, WF2_SLASH,
  WF2_TRIGGER_META, WF2_SCHEDULES, WF2_EVENTS, WF2_COMPARATORS, WF2_CATALOG, WF2_CATALOG_SOURCES,
  wf2ActionById, wf2StepProduces, wf2TriggerTokens, wf2GroupTokens,
  WfIconBtn, WfToggle, WfSeg, WfTokenChip, wf2Field, wf2Lbl, WF2_RUN_STATUS,
});
