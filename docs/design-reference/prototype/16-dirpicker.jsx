// ════════════════════════════════════════════════════════════════
// Mainframe prototype — DirectoryPickerModal
// Warm-chrome recreation of the source DirectoryPickerModal.tsx: a
// filesystem tree browser used to pick a folder (Add project) or a
// file (mode="file"). The prototype has no disk access, so it browses
// a mock tree. Lazy-expansion is simulated with a short "Loading…".
// Mounted by MainframeTabbed; opened from the sidebar "Add project" pill.
// ════════════════════════════════════════════════════════════════

// ── Mock filesystem ────────────────────────────────────────────────
const DP_HOME = '/Users/glen';
// A node: { name, type:'directory'|'file', children? }. Paths are derived.
const DP_TREE = {
  Developer: {
    mainframe: { '.git': {}, src: { 'main.ts': null, renderer: {} }, 'package.json': null, 'README.md': null },
    'glen-home-hub': { '.git': {}, app: {}, 'package.json': null },
    'football-tracker': { '.git': {}, src: {}, 'package.json': null },
    experiments: { 'rope-physics': {}, 'wasm-spike': {} },
  },
  Documents: {
    notes: { 'standup.md': null, 'roadmap.md': null },
    invoices: { '2026-Q1.pdf': null },
  },
  Desktop: {},
  Downloads: { 'claude-cli': null, 'node-v22.pkg': null },
};

// Build DirNode children for a given subtree object, at a given parent path.
function dpBuild(obj, parentPath, includeFiles) {
  const out = [];
  Object.keys(obj).forEach((name) => {
    const val = obj[name];
    const isDir = val !== null && typeof val === 'object';
    if (!isDir && !includeFiles) return;
    out.push({
      name,
      path: `${parentPath}/${name}`,
      type: isDir ? 'directory' : 'file',
      _raw: val,
    });
  });
  // directories first, then files; alpha within each
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
  return out;
}

function DirectoryPickerModal({ open, onSelect, onCancel, mode = 'directory', title }) {
  const resolvedTitle = title || (mode === 'file' ? 'Select File' : 'Select Project Directory');
  const [roots, setRoots] = React.useState([]);
  const [selectedPath, setSelectedPath] = React.useState(null);
  const [selectedType, setSelectedType] = React.useState(null);

  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, onCancel]);

  React.useEffect(() => {
    if (!open) return;
    setSelectedPath(null);
    setSelectedType(null);
    setRoots(dpBuild(DP_TREE, DP_HOME, mode === 'file'));
  }, [open, mode]);

  // Toggle a node by walking the indexPath into the (cloned) roots tree.
  const toggleExpand = React.useCallback((indexPath) => {
    setRoots((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      let arr = next;
      for (let i = 0; i < indexPath.length - 1; i++) arr = arr[indexPath[i]].children;
      const n = arr[indexPath[indexPath.length - 1]];
      if (n.type === 'file') return prev;
      if (n.expanded) { n.expanded = false; return next; }
      n.expanded = true;
      if (n.children) return next;
      // simulate lazy load
      n.loading = true;
      const target = n.path;
      setTimeout(() => {
        setRoots((p2) => {
          const n2 = JSON.parse(JSON.stringify(p2));
          let a2 = n2;
          for (let i = 0; i < indexPath.length - 1; i++) a2 = a2[indexPath[i]].children;
          const node2 = a2[indexPath[indexPath.length - 1]];
          node2.loading = false;
          node2.children = dpBuild(node2._raw || {}, node2.path, mode === 'file');
          return n2;
        });
      }, 220);
      return next;
    });
  }, [mode]);

  if (!open) return null;

  const renderNode = (node, indexPath) => {
    const depth = indexPath.length - 1;
    const isSelected = selectedPath === node.path;
    const isFile = node.type === 'file';
    return (
      <div key={node.path}>
        <button onClick={() => {
          setSelectedPath(node.path); setSelectedType(node.type);
          if (!isFile) toggleExpand(indexPath);
        }} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left',
          padding: '5px 10px', paddingLeft: depth * 16 + 10, border: 'none', cursor: 'pointer',
          background: isSelected ? T.selBg : 'transparent',
          color: isSelected ? T.text : T.text2,
          fontFamily: FONT, fontSize: 13, fontWeight: isSelected ? 600 : 500, letterSpacing: -0.1,
        }}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = T.rowHover; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
          <span style={{ width: 14, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>
            {!isFile && <Icon name={node.expanded ? 'chevron.down' : 'chevron.right'} size={12} color={T.text3}/>}
          </span>
          <Icon name={isFile ? 'doc' : (isSelected || node.expanded ? 'folder.fill' : 'folder')} size={14} color={isFile ? T.text3 : ACCENT}/>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        </button>
        {node.expanded && node.children && (
          <div>
            {node.children.map((child, i) => renderNode(child, [...indexPath, i]))}
            {node.children.length === 0 && !node.loading && (
              <div style={{ padding: '4px 10px', paddingLeft: (depth + 1) * 16 + 30, fontFamily: FONT, fontSize: 11, color: T.text4 }}>Empty</div>
            )}
          </div>
        )}
        {node.expanded && node.loading && (
          <div style={{ padding: '4px 10px', paddingLeft: (depth + 1) * 16 + 30, fontFamily: FONT, fontSize: 11, color: T.text4 }} className="tw-pulse">Loading…</div>
        )}
      </div>
    );
  };

  const selectDisabled = mode === 'file' ? selectedType !== 'file' : !selectedPath;

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(22,19,15,0.40)', fontFamily: FONT,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 480, maxWidth: '92vw', maxHeight: '600px', display: 'flex', flexDirection: 'column',
        background: T.content, borderRadius: 13, overflow: 'hidden', boxShadow: T.shadow,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: `0.5px solid ${T.hairline}`, background: T.content }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>{resolvedTitle}</span>
          <button onClick={onCancel} style={{
            width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.rowHover}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="xmark" size={14} color={T.text2}/>
          </button>
        </div>
        {/* Home crumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderBottom: `0.5px solid ${T.hairline}`, fontFamily: MONO, fontSize: 11, color: T.text3 }}>
          <Icon name="folder.fill" size={12} color={T.text4}/>{DP_HOME}
        </div>
        {/* Tree */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0', minHeight: 300 }}>
          {roots.length === 0
            ? <div style={{ padding: '32px 16px', textAlign: 'center', color: T.text3, fontSize: 13 }}>Loading…</div>
            : roots.map((node, i) => renderNode(node, [i]))}
        </div>
        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 16px', borderTop: `0.5px solid ${T.hairline}`, background: T.content }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 270 }}>{selectedPath || DP_HOME}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button onClick={onCancel} style={{ padding: '7px 13px', borderRadius: 8, border: 'none', background: T.chipBg, cursor: 'pointer', color: T.text2, fontFamily: FONT, fontSize: 12, fontWeight: 500 }}>Cancel</button>
            <button onClick={() => selectedPath && onSelect(selectedPath)} disabled={selectDisabled} style={{
              padding: '7px 15px', borderRadius: 8, border: 'none', background: ACCENT, color: '#fff',
              cursor: selectDisabled ? 'default' : 'pointer', opacity: selectDisabled ? 0.4 : 1,
              fontFamily: FONT, fontSize: 12, fontWeight: 600,
            }}>Select</button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.DirectoryPickerModal = DirectoryPickerModal;
