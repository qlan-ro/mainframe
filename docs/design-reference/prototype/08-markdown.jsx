// ════════════════════════════════════════════════════════════════
// Mainframe prototype — Markdown renderer (chat-grade)
// A compact but capable MD → React renderer used by assistant turns and
// tool output. Handles: headings, paragraphs, ordered/unordered/task lists,
// fenced code (syntax-highlit via mdCodeTokens), blockquotes, hr, tables,
// and inline **bold** *italic* `code` ~~strike~~ [links](#). Loaded after
// 04-engine; exposed as window.MD. Shares global scope (T, FONT, MONO…).
// ════════════════════════════════════════════════════════════════

const MD_KW = /\b(import|from|export|default|const|let|var|return|function|class|extends|if|else|for|while|switch|case|break|interface|type|enum|new|await|async|yield|try|catch|throw|typeof|instanceof|true|false|null|undefined|this|void)\b/;

// Tokenize a single code line into colored spans (TS/JS-leaning, generic-safe).
function mdCodeTokens(src, lang) {
  if (!src) return [<span key="0">{'\u00A0'}</span>];
  const out = []; let key = 0;
  const re = /(\/\/[^\n]*|#[^\n]*)|(["'`])(?:\\.|(?!\2).)*\2?|(\b\d[\d._]*\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(src))) {
    let color = T.codeFg; const txt = m[0];
    if (m[1]) color = T.codeCmt;
    else if (m[2]) color = T.codeStr;
    else if (m[3]) color = T.codeNum;
    else if (m[4]) {
      if (MD_KW.test(txt)) color = T.codeKw;
      else if (/^[A-Z]/.test(txt)) color = T.codeType;
      else if (src[re.lastIndex] === '(') color = T.codeFn;
    } else if (m[6]) color = T.text2;
    out.push(<span key={key++} style={{ color }}>{txt}</span>);
  }
  return out;
}

// ── Inline parser: **b** *i* _i_ `code` ~~s~~ [t](u) ──────────────────
function mdInline(text, keyBase) {
  const nodes = []; let i = 0, k = 0; let buf = '';
  const flush = () => { if (buf) { nodes.push(buf); buf = ''; } };
  const push = (el) => { flush(); nodes.push(React.cloneElement(el, { key: `${keyBase}-${k++}` })); };
  while (i < text.length) {
    const rest = text.slice(i);
    let m;
    if ((m = /^`([^`]+)`/.exec(rest))) {
      push(<code style={{ fontFamily: MONO, fontSize: '0.88em', color: '#7a4d2a', background: T.raised, padding: '1px 5px', borderRadius: 4, border: `0.5px solid ${T.border}` }}>{m[1]}</code>);
      i += m[0].length; continue;
    }
    if ((m = /^\*\*([^*]+)\*\*/.exec(rest))) { push(<strong style={{ fontWeight: 700, color: T.text }}>{mdInline(m[1], `${keyBase}b${k}`)}</strong>); i += m[0].length; continue; }
    if ((m = /^(?:\*([^*]+)\*|_([^_]+)_)/.exec(rest))) { push(<em style={{ fontStyle: 'italic' }}>{m[1] || m[2]}</em>); i += m[0].length; continue; }
    if ((m = /^~~([^~]+)~~/.exec(rest))) { push(<span style={{ textDecoration: 'line-through', color: T.text3 }}>{m[1]}</span>); i += m[0].length; continue; }
    if ((m = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest))) { push(<a href={m[2]} onClick={(e) => e.preventDefault()} style={{ color: ACCENT, textDecoration: 'none', borderBottom: `1px solid ${ACCENT}55`, cursor: 'pointer' }}>{m[1]}</a>); i += m[0].length; continue; }
    buf += text[i]; i++;
  }
  flush();
  return nodes;
}

// ── Block parser ──────────────────────────────────────────────────────
function MD({ text, size = 13.5, tight }) {
  const blocks = React.useMemo(() => parseMdBlocks(text || ''), [text]);
  const gap = tight ? 6 : 10;
  return (
    <div style={{ fontFamily: FONT, fontSize: size, lineHeight: 1.6, color: T.text, letterSpacing: -0.1, display: 'flex', flexDirection: 'column', gap }}>
      {blocks.map((b, i) => <MdBlock key={i} b={b} size={size}/>)}
    </div>
  );
}

function parseMdBlocks(src) {
  const lines = src.replace(/\t/g, '  ').split('\n');
  const blocks = []; let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    // fenced code
    let fm = /^```(\w+)?\s*$/.exec(line);
    if (fm) {
      const lang = fm[1] || ''; const body = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      i++; blocks.push({ t: 'code', lang, lines: body }); continue;
    }
    // heading
    let hm = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hm) { blocks.push({ t: 'h', level: hm[1].length, text: hm[2] }); i++; continue; }
    // hr
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }
    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push({ t: 'quote', text: body.join('\n') }); continue;
    }
    // table (header row + separator)
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      const rows = [];
      const cut = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
      const header = cut(line); i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(cut(lines[i])); i++; }
      blocks.push({ t: 'table', header, rows }); continue;
    }
    // lists
    let lm = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (lm) {
      const ordered = /\d+\./.test(lm[2]); const items = [];
      while (i < lines.length) {
        const im = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!im) break;
        let txt = im[3]; let task = null;
        const tm = /^\[([ xX])\]\s+(.*)$/.exec(txt);
        if (tm) { task = tm[1].toLowerCase() === 'x'; txt = tm[2]; }
        items.push({ indent: Math.floor(im[1].length / 2), text: txt, task });
        i++;
      }
      blocks.push({ t: 'list', ordered, items }); continue;
    }
    // paragraph (gather until blank or block start)
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*(?:---|\*\*\*|___)\s*$|\s*(?:[-*+]|\d+\.)\s)/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push({ t: 'p', text: para.join(' ') });
  }
  return blocks;
}

function MdBlock({ b, size }) {
  if (b.t === 'p') return <p style={{ margin: 0 }}>{mdInline(b.text, 'p')}</p>;
  if (b.t === 'h') {
    const sz = { 1: size + 7, 2: size + 4, 3: size + 2, 4: size + 0.5 }[b.level];
    return <div style={{ fontSize: sz, fontWeight: 700, color: T.text, letterSpacing: -0.3, marginTop: 2, lineHeight: 1.3 }}>{mdInline(b.text, 'h')}</div>;
  }
  if (b.t === 'hr') return <div style={{ height: 1, background: T.hairline, margin: '2px 0' }}/>;
  if (b.t === 'quote') return (
    <blockquote style={{ margin: 0, padding: '4px 0 4px 14px', borderLeft: `3px solid ${ACCENT}66`, color: T.text2, fontStyle: 'italic' }}>
      <MD text={b.text} size={size} tight/>
    </blockquote>
  );
  if (b.t === 'code') return <MdCode lang={b.lang} lines={b.lines}/>;
  if (b.t === 'table') return <MdTable header={b.header} rows={b.rows}/>;
  if (b.t === 'list') return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {b.items.map((it, i) => (
        <li key={i} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, marginLeft: it.indent * 18 }}>
          <span style={{ paddingTop: it.task != null ? 1 : 0, display: 'inline-flex', justifyContent: 'center' }}>
            {it.task != null ? (
              <span style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${it.task ? T.green : T.text4}`, background: it.task ? T.green : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {it.task && <Icon name="checkmark" size={10} color="#fff" stroke={2.6}/>}
              </span>
            ) : b.ordered ? (
              <span style={{ fontFamily: MONO, fontSize: size - 2.5, color: ACCENT, fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</span>
            ) : (
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.text3, marginTop: size / 2 - 2 }}/>
            )}
          </span>
          <span style={{ color: it.task ? T.text2 : T.text, textDecoration: it.task ? 'line-through' : 'none', textDecorationColor: T.text4 }}>{mdInline(it.text, `li${i}`)}</span>
        </li>
      ))}
    </ul>
  );
  return null;
}

function MdCode({ lang, lines }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: `0.5px solid ${T.border}`, background: T.codeBg }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 28, padding: '0 6px 0 12px', background: T.content2, borderBottom: `0.5px solid ${T.hairline}` }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: T.text3, letterSpacing: 0.3, textTransform: 'uppercase', flex: 1 }}>{lang || 'text'}</span>
        <button onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }} style={{
          height: 20, padding: '0 7px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT, fontSize: 10, fontWeight: 600, color: copied ? T.green : T.text3,
        }} onMouseEnter={(e) => { if (!copied) e.currentTarget.style.background = T.rowHover; }} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon name={copied ? 'checkmark' : 'copy'} size={11} color={copied ? T.green : T.text3}/>{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ padding: '9px 0', overflowX: 'auto' }}>
        {lines.map((ln, i) => (
          <div key={i} style={{ display: 'flex', minHeight: 18, lineHeight: '18px' }}>
            <span style={{ width: 34, flexShrink: 0, textAlign: 'right', paddingRight: 12, color: T.text4, fontFamily: MONO, fontSize: 10, userSelect: 'none' }}>{i + 1}</span>
            <span style={{ flex: 1, whiteSpace: 'pre', paddingRight: 14, fontFamily: MONO, fontSize: 12 }}>{mdCodeTokens(ln, lang)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MdTable({ header, rows }) {
  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: `0.5px solid ${T.border}` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 12 }}>
        <thead>
          <tr style={{ background: T.content2 }}>
            {header.map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '7px 12px', fontWeight: 700, color: T.text2, borderBottom: `0.5px solid ${T.hairline}` }}>{mdInline(h, `th${i}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? T.content2 : T.content }}>
              {r.map((c, ci) => <td key={ci} style={{ padding: '7px 12px', color: T.text, borderTop: ri === 0 ? 'none' : `0.5px solid ${T.hairline}` }}>{mdInline(c, `td${ri}-${ci}`)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

window.MD = MD;
window.mdCodeTokens = mdCodeTokens;
