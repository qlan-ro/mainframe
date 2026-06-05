// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Redesigned ToolCards + Chat transcript
// A collapsible card per tool invocation, type-aware bodies (read / edit /
// write / bash / grep / todo / web), warm-chrome styling, status pills.
// Plus ChatTranscript: a coherent assistant conversation that showcases the
// Markdown renderer (window.MD) and the cards together. Loaded after 08.
// ════════════════════════════════════════════════════════════════

const TOOL_META = {
  read:  { icon: 'doc.text',        color: '#5b8def', verb: 'Read' },
  edit:  { icon: 'diff',            color: '#d97706', verb: 'Edit' },
  write: { icon: 'plus',            color: '#28a745', verb: 'Write' },
  bash:  { icon: 'terminal',        color: '#7a7a82', verb: 'Run' },
  grep:  { icon: 'magnifyingglass', color: '#9b59c4', verb: 'Search' },
  todo:  { icon: 'checkmark',       color: '#0a84ff', verb: 'Update plan' },
  web:   { icon: 'globe',           color: '#16a394', verb: 'Fetch' },
};

function ToolStatus({ status }) {
  if (status === 'running') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 10, fontWeight: 600, color: T.amber }}>
      <Icon name="arrow.clockwise" size={11} color={T.amber} style={{ animation: 'tw-spin 0.9s linear infinite' }}/>Running
    </span>
  );
  if (status === 'error') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, color: T.red }}>
      <Icon name="exclamationmark.triangle" size={11} color={T.red}/>Failed
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: T.green }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.green }}/>Done
    </span>
  );
}

// Compact tokenized code/diff lines reused for edit & write previews.
function TcDiffLines({ lines }) {
  const tok = window.mdCodeTokens || ((s) => [s]);
  return (
    <div style={{ fontFamily: MONO, fontSize: 11, lineHeight: '18px' }}>
      {lines.map((l, i) => {
        const bg = l.k === 'add' ? 'rgba(40,167,69,0.10)' : l.k === 'del' ? 'rgba(220,53,69,0.09)' : 'transparent';
        const sign = l.k === 'add' ? '+' : l.k === 'del' ? '−' : '\u00A0';
        const sc = l.k === 'add' ? T.green : l.k === 'del' ? T.red : 'transparent';
        return (
          <div key={i} style={{ display: 'flex', background: bg, minHeight: 18 }}>
            <span style={{ width: 30, flexShrink: 0, textAlign: 'right', paddingRight: 8, color: T.text4, fontSize: 10, userSelect: 'none' }}>{l.n ?? ''}</span>
            <span style={{ width: 14, flexShrink: 0, textAlign: 'center', color: sc, fontWeight: 700, userSelect: 'none' }}>{sign}</span>
            <span style={{ flex: 1, whiteSpace: 'pre', paddingRight: 12 }}>{tok(l.t)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ToolCard({ tool, defaultOpen, onOpenFile }) {
  const meta = TOOL_META[tool.type] || TOOL_META.read;
  const [open, setOpen] = React.useState(defaultOpen != null ? defaultOpen : tool.type === 'edit' || tool.type === 'todo');
  const hasBody = tool.type !== 'read' || tool.preview;
  const target = tool.target;

  return (
    <div style={{ borderRadius: 11, border: `0.5px solid ${T.border}`, background: T.content, overflow: 'hidden' }}>
      {/* Header */}
      <div onClick={() => hasBody && setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', cursor: hasBody ? 'pointer' : 'default',
        userSelect: 'none',
      }} onMouseEnter={(e) => { if (hasBody) e.currentTarget.style.background = T.rowHover; }}
         onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, background: `${meta.color}1c`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={meta.icon} size={13} color={meta.color}/>
        </span>
        <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: T.text, flexShrink: 0 }}>{meta.verb}</span>
        {target && (
          <code style={{ fontFamily: MONO, fontSize: 11, color: T.text2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target}</code>
        )}
        {tool.meta && <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4, flexShrink: 0 }}>{tool.meta}</span>}
        <div style={{ flex: 1, minWidth: 8 }}/>
        {tool.stat && (
          <span style={{ display: 'inline-flex', gap: 7, fontFamily: MONO, fontSize: 10, flexShrink: 0 }}>
            {tool.stat.add ? <span style={{ color: T.green, fontWeight: 600 }}>+{tool.stat.add}</span> : null}
            {tool.stat.del ? <span style={{ color: T.red, fontWeight: 600 }}>−{tool.stat.del}</span> : null}
          </span>
        )}
        <ToolStatus status={tool.status}/>
      </div>

      {/* Body */}
      {open && hasBody && (
        <div style={{ borderTop: `0.5px solid ${T.hairline}` }}>
          {(tool.type === 'edit' || tool.type === 'write') && tool.lines && (
            <div style={{ background: T.codeBg, padding: '8px 0' }}><TcDiffLines lines={tool.lines}/></div>
          )}
          {tool.type === 'bash' && (
            <div style={{ background: T.termBg, padding: '10px 12px', fontFamily: MONO, fontSize: 11, lineHeight: 1.55 }}>
              <div style={{ color: T.termGreen }}>$ <span style={{ color: T.termFg }}>{tool.cmd}</span></div>
              {(tool.out || []).map((l, i) => (
                <div key={i} style={{ color: l.startsWith('✓') || l.includes('passing') ? T.termGreen : l.startsWith('✗') || l.toLowerCase().includes('error') ? '#ff6b6b' : T.termCmt }}>{l}</div>
              ))}
              {tool.exit != null && (
                <div style={{ marginTop: 6, color: tool.exit === 0 ? T.termGreen : '#ff6b6b' }}>exit {tool.exit}</div>
              )}
            </div>
          )}
          {tool.type === 'grep' && (
            <div style={{ padding: '6px 0' }}>
              {tool.matches.map((mt, i) => (
                <div key={i} onClick={() => onOpenFile && onOpenFile(mt.file)} style={{
                  display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 12px', cursor: onOpenFile ? 'pointer' : 'default', fontFamily: MONO, fontSize: 11,
                }} onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ color: T.codeFn, flexShrink: 0 }}>{mt.file}</span>
                  <span style={{ color: T.text4, flexShrink: 0 }}>:{mt.line}</span>
                  <span style={{ color: T.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mt.text}</span>
                </div>
              ))}
            </div>
          )}
          {tool.type === 'read' && tool.preview && (
            <div style={{ background: T.codeBg, padding: '8px 0', fontFamily: MONO, fontSize: 11, lineHeight: '18px' }}>
              {tool.preview.map((ln, i) => (
                <div key={i} style={{ display: 'flex', minHeight: 18 }}>
                  <span style={{ width: 34, flexShrink: 0, textAlign: 'right', paddingRight: 12, color: T.text4, fontSize: 10 }}>{(tool.from || 1) + i}</span>
                  <span style={{ flex: 1, whiteSpace: 'pre', paddingRight: 12 }}>{(window.mdCodeTokens || ((s) => [s]))(ln)}</span>
                </div>
              ))}
            </div>
          )}
          {tool.type === 'todo' && (
            <div style={{ padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tool.todos.map((td, i) => {
                const dotc = td.s === 'done' ? T.green : td.s === 'active' ? ACCENT : T.text4;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    {td.s === 'done' ? (
                      <span style={{ width: 15, height: 15, borderRadius: '50%', background: T.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="checkmark" size={9} color="#fff" stroke={2.6}/></span>
                    ) : td.s === 'active' ? (
                      <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${ACCENT}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span className="tw-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT }}/></span>
                    ) : (
                      <span style={{ width: 15, height: 15, borderRadius: '50%', border: `1.5px solid ${T.text4}`, flexShrink: 0 }}/>
                    )}
                    <span style={{ fontFamily: FONT, fontSize: 12, color: td.s === 'done' ? T.text3 : T.text, textDecoration: td.s === 'done' ? 'line-through' : 'none', letterSpacing: -0.05 }}>{td.t}</span>
                    {td.s === 'active' && <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: ACCENT, background: `${ACCENT}14`, padding: '1px 7px', borderRadius: 6 }}>in progress</span>}
                  </div>
                );
              })}
            </div>
          )}
          {tool.type === 'web' && (
            <div style={{ padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <Icon name="globe" size={12} color={T.text3}/>
                <span style={{ fontFamily: MONO, fontSize: 11, color: ACCENT }}>{tool.url}</span>
              </div>
              <div style={{ fontFamily: FONT, fontSize: 12, color: T.text2, lineHeight: 1.5 }}>{tool.summary}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Bundle of related tool calls with a collapsible group header.
function ToolGroup({ title, tools, time, onOpenFile }) {
  const [open, setOpen] = React.useState(true);
  const done = tools.every(t => !t.status || t.status === 'done');
  return (
    <div style={{ maxWidth: 680, margin: '0 0 14px' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 2px 7px', cursor: 'pointer', userSelect: 'none' }}>
        <Icon name={open ? 'chevron.down' : 'chevron.right'} size={11} color={T.text3}/>
        <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: T.text4 }}>{tools.length} calls{time ? ` · ${time}` : ''}</span>
        <div style={{ flex: 1 }}/>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tools.map((t, i) => <ToolCard key={i} tool={t} onOpenFile={onOpenFile}/>)}
        </div>
      )}
    </div>
  );
}

// ── Assistant turn header (avatar + name) ─────────────────────────────
function TurnHeader({ title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <div style={{ width: 18, height: 18, borderRadius: 6, background: ACCENT, color: '#fff', fontFamily: MONO, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>m</div>
      {title && <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: T.text, letterSpacing: -0.1 }}>{title}</span>}
      <span style={{ fontFamily: MONO, fontSize: 10, color: T.text3 }}>Claude Sonnet 4.5</span>
    </div>
  );
}

// ── The showcase transcript ───────────────────────────────────────────
function ChatTranscript({ onOpenFile }) {
  const MDc = window.MD;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* User */}
      {window.UMTextTurn && <window.UMTextTurn>
        Refactor <code style={{ fontFamily: MONO, fontSize: 11, color: '#7a4d2a', background: T.raised, padding: '1px 5px', borderRadius: 4, border: `0.5px solid ${T.border}` }}>Layout.tsx</code> so the left sidebar collapses to an icon rail. Persist the state across reloads, and clean up the legacy dock while you're in there. A few constraints: keep the existing keyboard shortcuts working, make sure the rail still shows the active-section highlight, and don't break the resize handle on the right inspector. If the persistence needs a migration, gate it behind a version check so existing users don't lose their layout — and add a quick test for the toggle so we don't regress this later.
      </window.UMTextTurn>}

      {/* Agent isolates the work in a worktree */}
      {window.WorktreeStatusPill && <window.WorktreeStatusPill action="enter" name="rail-refactor" path="~/dev/mainframe-desktop/.worktrees/rail-refactor"/>}

      {/* Reasoning */}
      {window.ThinkingBlock && <window.ThinkingBlock seconds={6} paragraphs={[
        'The ask is a sidebar that collapses to an icon rail, with the state persisted. The risk is the rail toggle being owned in two places — the layout store and the header hook — so I should confirm the data flow before editing.',
        'Persistence has a few viable homes: localStorage directly, the Zustand persist middleware that the store likely already uses, or electron-store on the main process. I shouldn’t assume — this is worth one quick question so I match the existing convention instead of inventing a third pattern.',
        'The legacy dock cleanup is a bonus the user flagged “while you’re in there.” I’ll fold it into the plan as an explicit step so it’s reviewable, not silent.',
      ]}/>}

      {/* Assistant intro + plan */}
      <div style={{ maxWidth: 680, marginBottom: 16 }}>
        <TurnHeader title="Mapping the layout"/>
        {MDc && <MDc text={`I'll scope this before touching code. The rail toggle lives in **\`useLayoutStore\`**, and the sidebar reads it. Here's the shape I'm aiming for:\n\n\`\`\`ts\ninterface SidebarState {\n  mode: 'full' | 'rail';   // new\n  width: number;\n  toggle(): void;\n}\n\`\`\`\n\nLet me confirm the current contract first.`}/>}
      </div>

      {/* A skill loads to guide the refactor */}
      {window.SkillLoadedCard && <window.SkillLoadedCard skillName="react-store-refactor" path="~/.mainframe/skills/react-store-refactor.md"
        content={`## React store refactor\n\nWhen extracting or reshaping a Zustand slice:\n\n1. **Co-locate** the new field with its action in one \`set\` call.\n2. Gate any persisted-shape change behind a **\`version\`** bump + \`migrate\`.\n3. Keep one-way data flow — derived hooks read, never write.\n4. Add a characterization test *before* deleting the old path.`}/>}

      <ToolGroup title="Investigating" time="1.4s" onOpenFile={onOpenFile} tools={[
        { type: 'grep', status: 'done', target: 'useZoneHeaderTabs', meta: '· 7 matches', matches: [
          { file: 'Layout.tsx', line: 42, text: 'const rail = useZoneHeaderTabs();' },
          { file: 'Sidebar.tsx', line: 11, text: "import { useZoneHeaderTabs } from './zone';" },
          { file: 'use-zone-header-tabs.ts', line: 3, text: 'export function useZoneHeaderTabs(opts) {' },
        ] },
        { type: 'read', status: 'done', target: 'use-zone-header-tabs.ts', meta: '· 94 lines', from: 3, preview: [
          'export function useZoneHeaderTabs(opts) {',
          '  const { tabs, activeId, onChange } = opts;',
          '  return useMemo(() => ({ tabs, activeId, onChange }), [tabs, activeId]);',
          '}',
        ] },
        { type: 'read', status: 'done', target: 'Layout.tsx', meta: '· 213 lines' },
      ]}/>

      {/* A research subagent maps the persistence conventions */}
      {window.TaskGroupCard && <window.TaskGroupCard
        agent="explore" model="haiku-4.5"
        description="find the persistence convention in the store layer"
        summary="Read 4 files · Searched 2 patterns"
        prompt="Survey how state is persisted across the renderer stores. Report which mechanism is canonical (localStorage / Zustand persist / electron-store) and where the version/migrate hooks live."
        result="Zustand `persist` middleware is the established convention — 3 of 4 stores use it with a `version` + `migrate` pair. localStorage is only used once (a one-off). electron-store is main-process only.">
        <ToolGroup title="Surveying stores" time="0.9s" onOpenFile={onOpenFile} tools={[
          { type: 'grep', status: 'done', target: "persist(", meta: '· 3 matches', matches: [
            { file: 'store/session.ts', line: 8, text: 'export const useSessionStore = create(persist(' },
            { file: 'store/prefs.ts', line: 6, text: 'export const usePrefsStore = create(persist(' },
          ] },
          { type: 'read', status: 'done', target: 'store/session.ts', meta: '· 120 lines' },
          { type: 'grep', status: 'done', target: 'version:', meta: '· 3 matches' },
        ]}/>
      </window.TaskGroupCard>}

      {/* Ask the user how to persist */}
      {window.AskUserQuestionCard && <window.AskUserQuestionCard
        question="How should the rail state persist?"
        context="The store doesn't persist layout yet. I want to match whatever convention the codebase already leans on."
        options={[
          { label: 'Zustand persist middleware', hint: 'Reuse the store’s existing disk hook — consistent with session state' },
          { label: 'localStorage directly', hint: 'Smallest change, but a one-off pattern here' },
          { label: 'electron-store (main process)', hint: 'Survives across windows; heavier wiring' },
        ]}/>}

      {/* Plan approval */}
      {window.PlanApprovalCard && <window.PlanApprovalCard
        title="Collapse sidebar to an icon rail"
        summary="Going with the Zustand persist middleware. The header hook is already one-way (owner → header), so it needs no change."
        steps={[
          { text: 'Add a persisted `mode` field and `toggleRail` action to the layout store.', files: ['store/layout.ts'] },
          { text: 'Render an icon-rail branch when `mode === \'rail\'`; bind `⌘1` to toggle.', files: ['components/Sidebar.tsx', 'components/RailIcons.tsx'] },
          { text: 'Delete the legacy free-form dock — fully superseded by zone tabs.', files: ['old-dock.ts'] },
        ]}/>}

      {/* Edits */}
      <ToolGroup title="Applying edits" time="0.8s" onOpenFile={onOpenFile} tools={[
        { type: 'edit', status: 'done', target: 'store/layout.ts', stat: { add: 4, del: 1 }, lines: [
          { n: 5, k: 'context', t: 'export const useLayoutStore = create((set) => ({' },
          { n: 6, k: 'del', t: "  sidebarWidth: 256," },
          { n: 6, k: 'add', t: "  sidebar: { mode: 'full', width: 256 }," },
          { n: 7, k: 'add', t: "  toggleRail: () => set((s) => ({" },
          { n: 8, k: 'add', t: "    sidebar: { ...s.sidebar, mode: s.sidebar.mode === 'full' ? 'rail' : 'full' }" },
          { n: 9, k: 'add', t: "  }))," },
        ] },
        { type: 'edit', status: 'done', target: 'components/Sidebar.tsx', stat: { add: 12, del: 3 }, lines: [
          { n: 31, k: 'context', t: '  if (collapsed) {' },
          { n: 32, k: 'del', t: '    return null;' },
          { n: 32, k: 'add', t: '    return (' },
          { n: 33, k: 'add', t: '      <nav className="rail" aria-label="Sidebar rail">' },
          { n: 34, k: 'add', t: '        <RailIcons sections={sections} active={active} />' },
          { n: 35, k: 'add', t: '      </nav>' },
          { n: 36, k: 'add', t: '    );' },
        ] },
        { type: 'write', status: 'done', target: 'components/RailIcons.tsx', stat: { add: 33 }, lines: [
          { n: 1, k: 'add', t: "import React from 'react';" },
          { n: 3, k: 'add', t: 'export function RailIcons({ sections, active }) {' },
          { n: 4, k: 'add', t: '  return sections.map((s) => (' },
          { n: 5, k: 'add', t: "    <button key={s.id} className={cx('rail-icon', active === s.id && 'on')}>" },
          { n: 6, k: 'add', t: '      <Icon name={s.icon} />' },
          { n: 7, k: 'add', t: '    </button>' },
          { n: 8, k: 'add', t: '  ));' },
          { n: 9, k: 'add', t: '}' },
        ] },
      ]}/>

      {/* Permission to run tests */}
      {window.PermissionCard && <window.PermissionCard
        toolName="Bash"
        input={{ command: 'pnpm test layout', description: 'Run the layout test suite' }}
        suggestions={[{ ruleName: 'Bash', ruleValue: 'pnpm test:*' }]}/>}

      {/* Bash */}
      <div style={{ maxWidth: 680, marginBottom: 14 }}>
        <ToolCard onOpenFile={onOpenFile} defaultOpen tool={{ type: 'bash', status: 'done', target: '', cmd: 'pnpm test layout', exit: 0, out: [
          '› vitest run src/renderer/components',
          '✓ layout store · rail toggle persists (12ms)',
          '✓ Sidebar · renders rail when collapsed (8ms)',
          '✓ RailIcons · highlights active section (5ms)',
          'Test Files  3 passed (3)',
          '     Tests  9 passed (9)',
        ] }}/>
      </div>

      {/* Long run trimmed the early context */}
      {window.CompactionPill && <window.CompactionPill/>}

      {/* Final summary */}
      <div style={{ maxWidth: 680, marginBottom: 8 }}>
        <TurnHeader title="Done"/>
        {MDc && <MDc text={`The rail is wired up and green across the board. Summary:\n\n| File | Change |\n| --- | --- |\n| \`layout.ts\` | \`mode\` field + \`toggleRail\` |\n| \`Sidebar.tsx\` | icon-rail branch |\n| \`RailIcons.tsx\` | **new** component |\n| \`old-dock.ts\` | removed |\n\nReady to review — hit **⌘⇧R** to open the diff, or **⌘O → "Review changes"**.`}/>}
      </div>
    </div>
  );
}

Object.assign(window, { ToolCard, ToolGroup, ChatTranscript });
