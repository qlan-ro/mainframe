// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Module 15: Files-surface VIEWERS
// Non-code file viewers that open into the Files surface the real way
// (openTarget routes by extension → kindForFile → SurfaceBody renders
// these). One implementation each; the review canvas (Viewers Review.html)
// mounts these REAL components. Loaded after 04-engine (uses T, Icon, FONT,
// MONO, ACCENT) and after 08-markdown (reuses window.MD). Shares global scope.
//   → window.{ViewerShell, MarkdownViewer, CsvViewer, ImageViewer,
//             SvgViewer, PdfViewer, UnsupportedViewer, VIEWER_FILES}
// ════════════════════════════════════════════════════════════════

// ── Shared viewer chrome ──────────────────────────────────────────────
// Mirrors CodePane's frame: a thin breadcrumb header, the body, and a mono
// status row. `right` fills the header's trailing cluster; `status`/`statusRight`
// fill the footer. Background is viewer-controlled via `bodyBg`.
function ViewerShell({ path = 'file', right, status, statusRight, bodyBg = T.content, children }) {
  const parts = path.split('/');
  const name = parts.pop();
  const dirs = parts;
  return (
    <div style={{ flex: 1, minHeight: 0, background: bodyBg, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* breadcrumb */}
      <div style={{
        height: 24, flexShrink: 0, padding: '0 6px 0 12px', display: 'flex', alignItems: 'center', gap: 4,
        fontFamily: FONT, fontSize: 11, color: T.text3, borderBottom: `0.5px solid ${T.hairline}`,
        background: T.tabBar,
      }}>
        <Icon name="folder" size={10} color={T.text3}/>
        {dirs.map((d, i) => (
          <React.Fragment key={i}>
            <span>{d}</span><Icon name="chevron.right" size={8} color={T.text4}/>
          </React.Fragment>
        ))}
        <span style={{ color: T.text2, fontWeight: 600 }}>{name}</span>
        <div style={{ flex: 1 }}/>
        {right}
        <div style={{ width: 1, height: 13, background: T.border, margin: '0 2px' }}/>
        <button title="Reveal in file tree" style={{
          width: 22, height: 20, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon name="locate" size={12} color={T.text2}/>
        </button>
      </div>
      {/* body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>
      {/* status */}
      <div style={{
        height: 20, flexShrink: 0, borderTop: `0.5px solid ${T.hairline}`, display: 'flex', alignItems: 'center',
        padding: '0 10px', gap: 10, fontFamily: MONO, fontSize: 10, color: T.text3, background: T.tabBar,
      }}>
        {status}
        <div style={{ flex: 1 }}/>
        {statusRight}
      </div>
    </div>
  );
}

// Small segmented toggle reused across viewers (Preview/Source, Fit/100%, …)
function VSeg({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1, padding: 2, borderRadius: 8, background: T.chipBg }}>
      {options.map(o => {
        const a = o.id === value;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} title={o.title || o.label} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, padding: o.icon && !o.label ? '0 5px' : '0 8px',
            border: 'none', borderRadius: 6, cursor: 'pointer',
            background: a ? T.content : 'transparent', boxShadow: a ? `0 0 0 0.5px ${T.border}, 0 1px 1.5px rgba(0,0,0,0.06)` : 'none',
            fontFamily: FONT, fontSize: 11, fontWeight: a ? 600 : 500, color: a ? T.text : T.text3, letterSpacing: -0.1,
          }}>
            {o.icon && <Icon name={o.icon} size={11} color={a ? T.text : T.text3}/>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Header icon button
function VBtn({ icon, title, onClick, disabled, active }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      width: 22, height: 20, borderRadius: 6, border: 'none', cursor: disabled ? 'default' : 'pointer',
      background: active ? T.chipBg : 'transparent', opacity: disabled ? 0.4 : 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}
    onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.background = T.rowHover; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <Icon name={icon} size={12} color={T.text2}/>
    </button>
  );
}

// Transparency checkerboard backdrop (image + svg canvases)
const CHECKER = {
  backgroundColor: T.viewerCheckA,
  backgroundImage: `linear-gradient(45deg,${T.viewerCheckB} 25%,transparent 25%),linear-gradient(-45deg,${T.viewerCheckB} 25%,transparent 25%),linear-gradient(45deg,transparent 75%,${T.viewerCheckB} 75%),linear-gradient(-45deg,transparent 75%,${T.viewerCheckB} 75%)`,
  backgroundSize: '18px 18px',
  backgroundPosition: '0 0,0 9px,9px -9px,-9px 0',
};

// ── Markdown viewer ───────────────────────────────────────────────────
function MarkdownViewer({ file = 'README.md' }) {
  const seed = VIEWER_FILES[file] || {};
  const text = seed.md || '# ' + file;
  const [mode, setMode] = React.useState('preview');
  const words = (text.match(/\S+/g) || []).length;
  const MDComp = window.MD;
  return (
    <ViewerShell path={seed.path || file} bodyBg={T.content}
      right={<VSeg value={mode} onChange={setMode} options={[{ id: 'preview', label: 'Preview' }, { id: 'source', label: 'Source' }]}/>}
      status={<span>Markdown · UTF-8</span>}
      statusRight={<span>{words} words · {text.split('\n').length} lines</span>}>
      {mode === 'preview' ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '36px 40px 64px', color: T.text }}>
            {MDComp ? <MDComp text={text} size={14}/> : <pre>{text}</pre>}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: T.codeBg }}>
          <pre style={{ margin: 0, padding: '16px 18px', fontFamily: MONO, fontSize: 12, lineHeight: 1.6, color: T.codeFg, whiteSpace: 'pre-wrap' }}>{text}</pre>
        </div>
      )}
    </ViewerShell>
  );
}

// ── CSV viewer ────────────────────────────────────────────────────────
function parseCsv(src) {
  const rows = src.trim().split('\n').map(l => l.split(',').map(c => c.trim()));
  const header = rows.shift() || [];
  return { header, rows };
}
function CsvViewer({ file = 'metrics.csv' }) {
  const seed = VIEWER_FILES[file] || {};
  const { header, rows } = React.useMemo(() => parseCsv(seed.csv || 'col\nval'), [seed.csv]);
  const numericCol = header.map((_, ci) => rows.length > 0 && rows.every(r => r[ci] !== undefined && r[ci] !== '' && !isNaN(Number(r[ci].replace(/[%$,]/g, '')))));
  const [q, setQ] = React.useState('');
  const [sort, setSort] = React.useState({ col: -1, dir: 0 }); // dir: 1 asc, -1 desc

  let view = rows;
  if (q) { const ql = q.toLowerCase(); view = view.filter(r => r.some(c => c.toLowerCase().includes(ql))); }
  if (sort.col >= 0 && sort.dir !== 0) {
    const ci = sort.col, num = numericCol[ci];
    view = [...view].sort((a, b) => {
      let av = a[ci] ?? '', bv = b[ci] ?? '';
      if (num) { av = Number(av.replace(/[%$,]/g, '')); bv = Number(bv.replace(/[%$,]/g, '')); return (av - bv) * sort.dir; }
      return av.localeCompare(bv) * sort.dir;
    });
  }
  const clickSort = (ci) => setSort(s => s.col !== ci ? { col: ci, dir: 1 } : { col: ci, dir: s.dir === 1 ? -1 : s.dir === -1 ? 0 : 1 });

  const cellPad = '6px 14px';
  return (
    <ViewerShell path={seed.path || file} bodyBg={T.content}
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 6, background: T.chipBg }}>
            <Icon name="magnifyingglass" size={10} color={T.text3}/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter rows" style={{
              border: 'none', background: 'transparent', outline: 'none', fontFamily: FONT, fontSize: 11, color: T.text, width: 96,
            }}/>
          </div>
        </div>
      }
      status={<span>CSV · UTF-8</span>}
      statusRight={<span>{view.length}{q ? `/${rows.length}` : ''} rows · {header.length} cols</span>}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontFamily: FONT, fontSize: 12, color: T.text }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', top: 0, zIndex: 2, background: T.content2, borderBottom: `1px solid ${T.border}`, padding: cellPad, width: 40, textAlign: 'right', color: T.text4, fontFamily: MONO, fontSize: 10, fontWeight: 500 }}>#</th>
              {header.map((h, ci) => (
                <th key={ci} onClick={() => clickSort(ci)} title="Sort" style={{
                  position: 'sticky', top: 0, zIndex: 2, background: T.content2, borderBottom: `1px solid ${T.border}`,
                  padding: cellPad, textAlign: numericCol[ci] ? 'right' : 'left', cursor: 'pointer', userSelect: 'none',
                  fontWeight: 600, color: T.text2, letterSpacing: -0.1, whiteSpace: 'nowrap',
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexDirection: numericCol[ci] ? 'row-reverse' : 'row' }}>
                    {h}
                    {sort.col === ci && sort.dir !== 0 && (
                      <Icon name={sort.dir === 1 ? 'chevron.up.down' : 'chevron.up.down'} size={9} color={ACCENT}/>
                    )}
                    {sort.col === ci && sort.dir === 1 && <span style={{ color: ACCENT, fontSize: 10 }}>▲</span>}
                    {sort.col === ci && sort.dir === -1 && <span style={{ color: ACCENT, fontSize: 10 }}>▼</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r, ri) => (
              <tr key={ri} style={{ background: ri % 2 ? T.content : '#fbfaf7' }}>
                <td style={{ padding: cellPad, textAlign: 'right', color: T.text4, fontFamily: MONO, fontSize: 10, borderBottom: `0.5px solid ${T.hairline}` }}>{ri + 1}</td>
                {header.map((_, ci) => (
                  <td key={ci} style={{
                    padding: cellPad, textAlign: numericCol[ci] ? 'right' : 'left', borderBottom: `0.5px solid ${T.hairline}`,
                    fontFamily: numericCol[ci] ? MONO : FONT, fontSize: numericCol[ci] ? 11.5 : 12.5,
                    color: numericCol[ci] ? T.text : T.text, whiteSpace: 'nowrap',
                  }}>{r[ci]}</td>
                ))}
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={header.length + 1} style={{ padding: '40px 14px', textAlign: 'center', color: T.text3, fontSize: 12 }}>No rows match “{q}”.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </ViewerShell>
  );
}

// ── Image viewer ──────────────────────────────────────────────────────
function ImageViewer({ file = 'hero.png' }) {
  const seed = VIEWER_FILES[file] || {};
  const w = seed.w || 1840, h = seed.h || 1024;
  const [fit, setFit] = React.useState('fit'); // 'fit' | 'actual'
  const [zoom, setZoom] = React.useState(1);
  const wrapRef = React.useRef(null);
  const eff = fit === 'fit' ? null : zoom;
  return (
    <ViewerShell path={seed.path || file} bodyBg={T.viewerMatte}
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <VBtn icon="minus.magnifyingglass" title="Zoom out" disabled={fit === 'fit'} onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))}/>
          <VBtn icon="plus.magnifyingglass" title="Zoom in" disabled={fit === 'fit'} onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}/>
          <VSeg value={fit} onChange={(v) => { setFit(v); if (v === 'actual') setZoom(1); }} options={[
            { id: 'fit', icon: 'arrow.up.left.down.right', label: 'Fit' },
            { id: 'actual', label: '100%' },
          ]}/>
        </div>
      }
      status={<span>{seed.fmt || 'PNG'} · {w}×{h}</span>}
      statusRight={<span>{seed.size || '248 KB'} · {fit === 'fit' ? 'fit to window' : Math.round(zoom * 100) + '%'}</span>}>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', ...CHECKER, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <div style={{
          width: fit === 'fit' ? 'min(86%, ' + w + 'px)' : w * zoom, aspectRatio: `${w} / ${h}`, flexShrink: 0,
          background: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.12)',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* honest placeholder for an image we don't have */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `repeating-linear-gradient(135deg, #f1eee9 0 12px, #e7e3dc 12px 24px)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ textAlign: 'center', fontFamily: MONO, fontSize: 12, color: T.text3, letterSpacing: 0.2 }}>
              <Icon name="photo" size={26} color={T.text4}/>
              <div style={{ marginTop: 8 }}>{file}</div>
              <div style={{ marginTop: 3, fontSize: 11, color: T.text4 }}>{w} × {h}</div>
            </div>
          </div>
        </div>
      </div>
    </ViewerShell>
  );
}

// ── SVG viewer ────────────────────────────────────────────────────────
function SvgViewer({ file = 'logo.svg' }) {
  const seed = VIEWER_FILES[file] || {};
  const svg = seed.svg || '<svg viewBox="0 0 24 24"></svg>';
  const [mode, setMode] = React.useState('preview');
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 24 24';
  const vbDims = vb.split(/\s+/);
  return (
    <ViewerShell path={seed.path || file} bodyBg={mode === 'preview' ? T.viewerMatte : T.codeBg}
      right={<VSeg value={mode} onChange={setMode} options={[{ id: 'preview', label: 'Preview' }, { id: 'source', label: 'Code' }]}/>}
      status={<span>SVG · viewBox {vb}</span>}
      statusRight={<span>{vbDims[2]}×{vbDims[3]} · {seed.size || '1.1 KB'}</span>}>
      {mode === 'preview' ? (
        <div style={{ flex: 1, minHeight: 0, ...CHECKER, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <div style={{
            width: 260, height: 260, background: '#fff', borderRadius: 11,
            boxShadow: '0 8px 30px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 36,
          }} dangerouslySetInnerHTML={{ __html: svg.replace('<svg', '<svg width="100%" height="100%"') }}/>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <pre style={{ margin: 0, padding: '16px 18px', fontFamily: MONO, fontSize: 12, lineHeight: 1.6, color: T.codeFg, whiteSpace: 'pre-wrap' }}>{seed.svgSrc || svg}</pre>
        </div>
      )}
    </ViewerShell>
  );
}

// ── PDF viewer ────────────────────────────────────────────────────────
function PdfViewer({ file = 'spec.pdf' }) {
  const seed = VIEWER_FILES[file] || {};
  const pages = seed.pages || [{ title: file, body: [] }];
  const [page, setPage] = React.useState(0);
  const [fit, setFit] = React.useState('fit');
  const cur = pages[page];
  return (
    <ViewerShell path={seed.path || file} bodyBg={T.viewerMatte}
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <VBtn icon="chevron.left" title="Previous page" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}/>
          <span style={{ fontFamily: MONO, fontSize: 11, color: T.text2, minWidth: 58, textAlign: 'center' }}>{page + 1} / {pages.length}</span>
          <VBtn icon="chevron.right" title="Next page" disabled={page === pages.length - 1} onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))}/>
          <div style={{ width: 1, height: 13, background: T.border, margin: '0 1px' }}/>
          <VSeg value={fit} onChange={setFit} options={[{ id: 'fit', label: 'Fit' }, { id: 'wide', label: 'Width' }]}/>
        </div>
      }
      status={<span>PDF · {pages.length} pages</span>}
      statusRight={<span>{seed.size || '1.2 MB'} · page {page + 1}</span>}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <div style={{
          width: fit === 'fit' ? 'min(620px, 92%)' : 'min(820px, 98%)', aspectRatio: '612 / 792', background: '#fff',
          boxShadow: '0 10px 36px rgba(0,0,0,0.26), 0 0 0 0.5px rgba(0,0,0,0.1)', flexShrink: 0,
          padding: '8% 9%', fontFamily: '"Iowan Old Style", Georgia, serif', color: '#23211d', overflow: 'hidden', position: 'relative',
        }}>
          {cur.kicker && <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#9a948a', marginBottom: 14 }}>{cur.kicker}</div>}
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.18, marginBottom: 16 }}>{cur.title}</div>
          {(cur.body || []).map((blk, i) => {
            if (blk.h) return <div key={i} style={{ fontSize: 15, fontWeight: 700, margin: '18px 0 7px', color: '#3a362f' }}>{blk.h}</div>;
            if (blk.fig) return (
              <div key={i} style={{ margin: '14px 0', height: 132, borderRadius: 4, backgroundImage: 'repeating-linear-gradient(135deg,#f0ede8 0 11px,#e6e2db 11px 22px)', border: '0.5px solid #ddd8d0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, color: '#9a948a' }}>{blk.fig}</div>
            );
            return <p key={i} style={{ margin: '0 0 11px', fontSize: 13, lineHeight: 1.65, color: '#3f3b34' }}>{blk.p}</p>;
          })}
          <div style={{ position: 'absolute', bottom: '4%', left: 0, right: 0, textAlign: 'center', fontFamily: MONO, fontSize: 10, color: '#b6b0a6' }}>{page + 1}</div>
        </div>
      </div>
    </ViewerShell>
  );
}

// ── Unsupported / no-preview fallback ─────────────────────────────────
function UnsupportedViewer({ file = 'archive.zip' }) {
  const seed = VIEWER_FILES[file] || {};
  return (
    <ViewerShell path={seed.path || file} bodyBg={T.content2}
      status={<span>{seed.fmt || 'Binary'}</span>} statusRight={<span>{seed.size || '—'}</span>}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{
          width: 320, padding: '26px 24px', background: T.content, borderRadius: 13, border: `0.5px solid ${T.border}`,
          boxShadow: '0 10px 32px rgba(0,0,0,0.08)', textAlign: 'center',
        }}>
          <div style={{ width: 46, height: 46, borderRadius: 11, background: T.chipBg, display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
            <Icon name="doc" size={22} color={T.text3}/>
          </div>
          <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: -0.1 }}>No preview available</div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: T.text3, marginTop: 6, lineHeight: 1.5 }}>
            Mainframe can’t render <span style={{ fontFamily: MONO, fontSize: 11, color: T.text2 }}>{file}</span> inline.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button style={{ height: 28, padding: '0 12px', borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Open externally</button>
            <button style={{ height: 28, padding: '0 12px', borderRadius: 8, border: `0.5px solid ${T.border}`, background: T.content, color: T.text2, fontFamily: FONT, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Reveal in tree</button>
          </div>
        </div>
      </div>
    </ViewerShell>
  );
}

// ════════════════════════════════════════════════════════════════
// Seed content (single source: workspace opens + review canvas share it)
// ════════════════════════════════════════════════════════════════
const VIEWER_FILES = {
  'README.md': {
    path: 'README.md', kind: 'markdown',
    md: `# Mainframe

The agentic coding workspace. Hand work to an agent, watch it run across
**isolated worktrees**, and review every change before it lands.

> Mainframe keeps the conversation as the spine and grows surfaces — Files,
> Run, Diff — by intent, never by accident.

## Quick start

\`\`\`bash
pnpm install
pnpm dev          # start the desktop app
pnpm test --filter @mainframe/desktop
\`\`\`

## Surfaces

- **Chat** — the singleton conversation spine.
- **Files** — every file & diff opens here; code, markdown, CSV, images, PDFs.
- **Run** — preview + terminals, splittable.

## Keyboard

| Shortcut | Action |
| --- | --- |
| \`⌘O\` | Command / file palette |
| \`⌘,\` | Settings |
| \`⌘⇧R\` | Review changes |
| \`⌘⇧T\` | Quick task |

## Status

- [x] Typed-surface workspace
- [x] Review flow + interactive cards
- [ ] Plugin marketplace

See \`CHANGELOG.md\` for release notes.`,
  },
  'CHANGELOG.md': {
    path: 'CHANGELOG.md', kind: 'markdown',
    md: `# Changelog

## 0.19.0 — *unreleased*

### Added
- File viewers: **CSV**, **image**, **SVG**, **PDF**, and **Markdown** now render
  inline in the Files surface.
- \`kindForFile()\` routing — opens pick the right viewer by extension.

### Changed
- Tasks surface rebuilt as an agent-first list with a Board toggle.

### Fixed
- Popover panels no longer get clipped by scaled containers.

## 0.18.2

- Toaster auto-dismiss rail; errors now persist.
- Connection overlay no longer shows a fake reconnect button.`,
  },
  'metrics.csv': {
    path: 'data/metrics.csv', kind: 'csv',
    csv: `model,suite,passed,total,pass_rate,p50_ms,p95_ms,cost_usd
sonnet-4.6,unit,512,520,98.5%,412,980,0.42
sonnet-4.6,integration,148,150,98.7%,1240,3110,1.18
sonnet-4.6,e2e,44,48,91.7%,8200,19400,3.92
haiku-4.2,unit,505,520,97.1%,180,420,0.08
haiku-4.2,integration,141,150,94.0%,640,1580,0.22
haiku-4.2,e2e,39,48,81.3%,4100,9900,0.71
opus-4.2,unit,518,520,99.6%,690,1510,1.94
opus-4.2,integration,150,150,100.0%,1980,4420,4.86
opus-4.2,e2e,47,48,97.9%,11200,25600,12.40`,
  },
  'usage.csv': {
    path: 'data/usage.csv', kind: 'csv',
    csv: `date,sessions,tokens_in,tokens_out,tool_calls,avg_turns
2026-05-26,142,1840221,512904,3211,8.4
2026-05-27,168,2104882,601233,3902,9.1
2026-05-28,151,1988450,548120,3540,8.7
2026-05-29,97,1240998,331004,2188,7.2
2026-05-30,63,820114,219880,1402,6.8
2026-05-31,58,701338,188221,1190,6.4
2026-06-01,174,2280551,648991,4120,9.6`,
  },
  'hero-screenshot.png': { path: 'assets/hero-screenshot.png', kind: 'image', w: 1840, h: 1024, fmt: 'PNG', size: '512 KB' },
  'onboarding.png': { path: 'assets/onboarding.png', kind: 'image', w: 1280, h: 1280, fmt: 'PNG', size: '288 KB' },
  'logo.svg': {
    path: 'assets/logo.svg', kind: 'svg',
    svg: `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="76" height="76" rx="20" fill="#1c1c1e"/><circle cx="48" cy="48" r="22" fill="none" stroke="#0a84ff" stroke-width="7"/><circle cx="48" cy="48" r="7" fill="#0a84ff"/></svg>`,
    svgSrc: `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="76" height="76" rx="20" fill="#1c1c1e"/>
  <circle cx="48" cy="48" r="22" fill="none" stroke="#0a84ff" stroke-width="7"/>
  <circle cx="48" cy="48" r="7" fill="#0a84ff"/>
</svg>`,
    size: '0.4 KB',
  },
  'badge.svg': {
    path: 'assets/badge.svg', kind: 'svg',
    svg: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="14" width="92" height="92" rx="14" transform="rotate(45 60 60)" fill="none" stroke="#7a3fb0" stroke-width="6"/><rect x="38" y="38" width="44" height="44" rx="8" fill="#7a3fb0"/></svg>`,
    svgSrc: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <rect x="14" y="14" width="92" height="92" rx="14"
        transform="rotate(45 60 60)"
        fill="none" stroke="#7a3fb0" stroke-width="6"/>
  <rect x="38" y="38" width="44" height="44" rx="8" fill="#7a3fb0"/>
</svg>`,
    size: '0.5 KB',
  },
  'spec.pdf': {
    path: 'docs/spec.pdf', kind: 'pdf', size: '1.2 MB',
    pages: [
      { kicker: 'Product spec · v3', title: 'Typed-Surface Workspace', body: [
        { p: 'Mainframe replaces the free-form docking tree with three typed surfaces: Chat, Files, and Run. Each has a single, well-understood role, and the layout grows by intent rather than by accident.' },
        { h: 'Goals' },
        { p: 'Keep the conversation as a persistent spine. Make every file and diff land in one predictable place. Let running processes and previews share a region that can split internally.' },
        { fig: 'figure 1 — surface layout grammar' },
        { p: 'The result is a workspace a keyboard-first user can reason about: there are only ever three surfaces, and chat always claims a top column.' },
      ] },
      { kicker: 'Product spec · v3', title: 'Routing & Open Targets', body: [
        { h: 'openTarget()' },
        { p: 'Every open source — the file tree, the Changes tab, chat tool rows, the command palette — routes through one function. It dedupes against already-open tabs, then lands the file in the Files singleton, creating it if absent.' },
        { h: 'Viewers' },
        { p: 'The kind of a tab is derived from the file extension. Code opens in the editor; markdown, CSV, images, SVG, and PDF each open in a dedicated viewer. Unknown binaries fall back to a no-preview card.' },
        { fig: 'figure 2 — kindForFile decision table' },
      ] },
      { kicker: 'Product spec · v3', title: 'Review & Hand-off', body: [
        { p: 'Changes are reviewed in a large centered modal reachable via ⌘⇧R, the palette, or the clipboard button in the chat header.' },
        { h: 'Principles' },
        { p: 'Show only what real state backs. Never design affordances for mechanisms that do not exist. Prefer keyboard-first flows, and keep one implementation of every component.' },
      ] },
    ],
  },
  'design-review.pdf': {
    path: 'docs/design-review.pdf', kind: 'pdf', size: '840 KB',
    pages: [
      { kicker: 'Design review', title: 'Warm-Chrome Visual Language', body: [
        { p: 'A calm, paper-leaning take on macOS chrome: subtly warm whites and blacks, hairline borders, and a single blue accent reserved for live and interactive state.' },
        { fig: 'figure 1 — token palette' },
        { p: 'Saturations stay below 0.02 for neutrals. Accent hues share chroma and lightness so the interface never feels loud.' },
      ] },
      { kicker: 'Design review', title: 'Density & Type', body: [
        { h: 'Type' },
        { p: 'System sans for UI, SF Mono for code and metadata. Sizes hold a tight scale; nothing on a working surface drops below 11px.' },
      ] },
    ],
  },
};

// Resolve a viewer kind from a filename extension. Used by the engine's
// openFile so a single click routes to the right viewer.
function kindForFile(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'csv') return 'csv';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return 'image';
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  return 'code';
}
function iconForFile(name) {
  const k = kindForFile(name);
  const tt = TAB_TYPES[k];
  return tt ? { icon: tt.icon, color: tt.color } : { icon: 'doc', color: T.text3 };
}

Object.assign(window, {
  ViewerShell, MarkdownViewer, CsvViewer, ImageViewer, SvgViewer, PdfViewer, UnsupportedViewer,
  VIEWER_FILES, kindForFile, iconForFile,
});
