// ════════════════════════════════════════════════════════════════
// Mainframe prototype — ⌘O Command / Search palette
// Spotlight-style overlay. Modes switch by prefix:
//   (plain) files & recents · ">" commands · "@" symbols · "#" changed files
// Keyboard: ↑/↓ move · ⏎ run · Esc close. Loaded after 04-engine; shares scope.
// ════════════════════════════════════════════════════════════════

const PAL_FILES = [
  { f: 'Layout.tsx',              p: 'src/renderer/components' },
  { f: 'Sidebar.tsx',             p: 'src/renderer/components' },
  { f: 'LeftRail.tsx',            p: 'src/renderer/components' },
  { f: 'CenterPanel.tsx',         p: 'src/renderer/components' },
  { f: 'use-zone-header-tabs.ts', p: 'src/renderer/components/zone' },
  { f: 'layout.ts',               p: 'src/renderer/store' },
  { f: 'theme.ts',                p: 'src/renderer/store' },
  { f: 'App.tsx',                 p: 'src/renderer' },
  { f: 'SettingsModal.tsx',       p: 'src/renderer/components' },
  { f: 'package.json',            p: '.' },
  { f: 'README.md',               p: '.' },
  { f: 'CHANGELOG.md',            p: '.' },
  { f: 'metrics.csv',             p: 'data' },
  { f: 'usage.csv',               p: 'data' },
  { f: 'logo.svg',                p: 'assets' },
  { f: 'badge.svg',               p: 'assets' },
  { f: 'hero-screenshot.png',     p: 'assets' },
  { f: 'onboarding.png',          p: 'assets' },
  { f: 'spec.pdf',                p: 'docs' },
  { f: 'design-review.pdf',       p: 'docs' },
];
const PAL_RECENT = ['Layout.tsx', 'use-zone-header-tabs.ts', 'theme.ts'];
const PAL_CHANGED = [
  { f: 'Layout.tsx',    s: 'M', add: 18, del: 7 },
  { f: 'Sidebar.tsx',   s: 'M', add: 42, del: 11 },
  { f: 'theme.ts',      s: 'M', add: 6,  del: 2 },
  { f: 'RailIcons.tsx', s: 'A', add: 33, del: 0 },
  { f: 'old-dock.ts',   s: 'D', add: 0,  del: 96 },
];
const PAL_SYMBOLS = [
  { s: 'useLayoutStore',    k: 'fn',    p: 'store/layout.ts' },
  { s: 'useZoneHeaderTabs', k: 'fn',    p: 'zone/use-zone-header-tabs.ts' },
  { s: 'Layout',            k: 'comp',  p: 'components/Layout.tsx' },
  { s: 'Sidebar',           k: 'comp',  p: 'components/Sidebar.tsx' },
  { s: 'ThemeId',           k: 'type',  p: 'store/theme.ts' },
  { s: 'SETTINGS_TABS',     k: 'const', p: 'components/settings/constants.ts' },
];

// fuzzy subsequence match → numeric score (lower is better), or null on miss
function palFuzzy(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, prev = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) { score += prev >= 0 ? ti - prev : 0; prev = ti; qi++; }
  }
  return qi === q.length ? score - (t.startsWith(q) ? 40 : 0) : null;
}

function SearchPalette({ open, onClose, api }) {
  const [q, setQ] = React.useState('');
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); } }, [open]);

  const mode = q.startsWith('>') ? 'cmd' : q.startsWith('@') ? 'sym' : q.startsWith('#') ? 'chg' : 'file';
  const term = (mode === 'file') ? q.trim() : q.slice(1).trim();

  const COMMANDS = [
    { id: 'review',    label: 'Review changes…',     icon: 'diff',          hint: '⌘⇧R', run: () => api.openReview() },
    { id: 'settings',  label: 'Open Settings…',       icon: 'gear',          hint: '⌘,',  run: () => api.openSettings() },
    { id: 'sidebar',   label: 'Toggle Sidebar',       icon: 'sidebar.left',  hint: '⌘\\', run: () => api.toggleSidebar() },
    { id: 'inspector', label: 'Toggle Inspector',     icon: 'sidebar.right', hint: '',    run: () => api.toggleInspector() },
    { id: 'files',     label: 'Reveal Files surface', icon: 'folder',        hint: '',    run: () => api.toggleSurface('files') },
    { id: 'run',       label: 'Reveal Run surface',   icon: 'play.fill',     hint: '',    run: () => api.toggleSurface('run') },
  ];

  const results = React.useMemo(() => {
    const rank = (arr, key) => arr
      .map(x => ({ x, sc: palFuzzy(term, key(x)) }))
      .filter(r => r.sc !== null)
      .sort((a, b) => a.sc - b.sc)
      .map(r => r.x);

    if (mode === 'cmd') {
      return rank(COMMANDS, c => c.label).map(c => ({ type: 'cmd', icon: c.icon, title: c.label, hint: c.hint, run: c.run }));
    }
    if (mode === 'sym') {
      const kc = { fn: T.codeFn, comp: ACCENT, type: T.codeType, const: T.amber };
      return rank(PAL_SYMBOLS, s => s.s).map(s => ({
        type: 'sym', icon: 'bolt', iconColor: kc[s.k], title: s.s, sub: s.p, tag: s.k,
        run: () => api.openFile(s.p.split('/').pop()),
      }));
    }
    if (mode === 'chg') {
      const sc = { M: T.amber, A: T.green, D: T.red };
      return rank(PAL_CHANGED, c => c.f).map(c => ({
        type: 'chg', icon: 'diff', iconColor: sc[c.s], title: c.f, status: c.s, add: c.add, del: c.del,
        run: () => api.openDiff(c.f),
      }));
    }
    const base = term ? rank(PAL_FILES, x => x.f + ' ' + x.p)
      : PAL_RECENT.map(f => PAL_FILES.find(x => x.f === f)).filter(Boolean);
    return base.map(x => { const ic = window.iconForFile ? window.iconForFile(x.f) : { icon: 'doc.text', color: null }; return { type: 'file', icon: ic.icon, iconColor: ic.color, title: x.f, sub: x.p, run: () => api.openFile(x.f) }; });
  }, [q, mode, term]);

  React.useEffect(() => { setSel(0); }, [q]);

  React.useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = results[sel]; if (r) { r.run(); onClose(); } }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, results, sel, onClose]);

  React.useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-pi="${sel}"]`);
    if (el) { const c = listRef.current, top = el.offsetTop, bot = top + el.offsetHeight;
      if (top < c.scrollTop) c.scrollTop = top - 4;
      else if (bot > c.scrollTop + c.clientHeight) c.scrollTop = bot - c.clientHeight + 4; }
  }, [sel]);

  if (!open) return null;

  const modeChip = { file: null, cmd: 'Commands', sym: 'Symbols', chg: 'Changes' }[mode];
  const placeholder = mode === 'cmd' ? 'Run a command…'
    : mode === 'sym' ? 'Go to symbol…'
    : mode === 'chg' ? 'Filter changed files…'
    : 'Search files…  · type > commands  @ symbols  # changes';

  const sectionLabel = mode === 'cmd' ? 'Commands' : mode === 'sym' ? 'Symbols'
    : mode === 'chg' ? 'Working tree' : term ? 'Files' : 'Recent';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', fontFamily: FONT }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(40,36,30,0.28)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}/>
      <div style={{
        position: 'relative', width: 580, maxWidth: '90vw', marginTop: '11vh',
        background: T.content, borderRadius: 13, overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.34), 0 0 0 0.5px rgba(0,0,0,0.16)',
        display: 'flex', flexDirection: 'column', maxHeight: '62vh',
      }}>
        {/* Field */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '0 16px', height: 54, flexShrink: 0, borderBottom: `0.5px solid ${T.hairline}` }}>
          <Icon name="magnifyingglass" size={16} color={T.text3}/>
          {modeChip && (
            <span style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 6,
              background: `${ACCENT}14`, color: ACCENT, fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: -0.05,
            }}>{modeChip}</span>
          )}
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
            spellCheck={false} style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
              fontFamily: FONT, fontSize: 15, color: T.text, letterSpacing: -0.1,
            }}/>
          <kbd style={{
            flexShrink: 0, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 6, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', background: T.chipBg, color: T.text3,
            fontFamily: FONT, fontSize: 11, fontWeight: 600,
          }}>esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          <div style={{ padding: '6px 10px 4px', fontFamily: FONT, fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>{sectionLabel}</div>
          {results.length === 0 && (
            <div style={{ padding: '26px 10px', textAlign: 'center', fontFamily: FONT, fontSize: 13, color: T.text3 }}>No matches</div>
          )}
          {results.map((r, i) => {
            const active = i === sel;
            return (
              <div key={i} data-pi={i} onMouseEnter={() => setSel(i)} onClick={() => { r.run(); onClose(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, height: 40, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
                  background: active ? `${ACCENT}14` : 'transparent',
                }}>
                <span style={{ width: 20, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>
                  <Icon name={r.icon} size={15} color={r.iconColor || (active ? ACCENT : T.text3)}/>
                </span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <span style={{ fontFamily: r.type === 'cmd' ? FONT : MONO, fontSize: 13, fontWeight: active ? 600 : 500, color: T.text, letterSpacing: -0.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                  {r.sub && <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3, letterSpacing: -0.05, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sub}</span>}
                </div>
                {r.type === 'chg' && (
                  <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 11 }}>
                    {r.add > 0 && <span style={{ color: T.green }}>+{r.add}</span>}
                    {r.del > 0 && <span style={{ color: T.red }}>−{r.del}</span>}
                    <span style={{ width: 16, height: 16, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: `${r.iconColor}1f`, color: r.iconColor, fontWeight: 700, fontSize: 10 }}>{r.status}</span>
                  </span>
                )}
                {r.tag && (
                  <span style={{ flexShrink: 0, fontFamily: FONT, fontSize: 10, fontWeight: 600, color: r.iconColor, background: `${r.iconColor}1a`, padding: '2px 7px', borderRadius: 6 }}>{r.tag}</span>
                )}
                {r.hint && (
                  <span style={{ flexShrink: 0, display: 'inline-flex', gap: 3 }}>
                    {r.hint.split('').map((c, j) => (
                      <kbd key={j} style={{ minWidth: 18, height: 18, padding: '0 4px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: T.chipBg, color: T.text3, fontFamily: FONT, fontSize: 10, fontWeight: 600 }}>{c}</kbd>
                    ))}
                  </span>
                )}
                {active && !r.hint && !r.tag && r.type !== 'chg' && <Icon name="return" size={13} color={T.text3}/>}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, height: 34, padding: '0 14px', borderTop: `0.5px solid ${T.hairline}`, background: T.content2 }}>
          {[['↑↓', 'Navigate'], ['⏎', 'Open'], ['esc', 'Dismiss']].map(([k, l]) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <kbd style={{ height: 16, padding: '0 5px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', background: T.chipBg, color: T.text3, fontFamily: FONT, fontSize: 10, fontWeight: 600 }}>{k}</kbd>
              <span style={{ fontFamily: FONT, fontSize: 11, color: T.text3 }}>{l}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

window.SearchPalette = SearchPalette;
