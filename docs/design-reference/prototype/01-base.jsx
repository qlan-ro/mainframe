// Mainframe — Tabbed Workspace with Editor Groups (the 50/50 ethos)
// Every panel — Chat, Code, Terminal, Preview, Diff — is a Tab.
// Tabs live in Editor Groups. Groups can be split horizontally or vertically.
// Default: 50/50 chat on the left, code on the right.

const ACCENT = '#0a84ff';
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';
const MONO = '"SF Mono", ui-monospace, Menlo, Monaco, monospace';
const FONT_DISPLAY = FONT;  // native system stack also serves display — no separate brand face by design

// ── Type scale · 8 rungs ──────────────────────────────────────────────
// The single source of truth for font sizes. Inline `fontSize:` values
// across the app are snapped to these rungs (no more 0.5px half-steps).
// Granular at the dense-UI bottom (10/11/12/13), opening up for display.
//   micro 10 · caption 11 · label 12 · body 13 · heading 15 · title 17
//   display 22 · hero 28
const FS = {
  micro:   10,   // mono metadata, status bars, badges, log counts
  caption: 11,   // help text, chips, keycaps, secondary captions
  label:   12,   // buttons, tabs, breadcrumbs, menu items
  body:    13,   // chat & user-message body — the reading size
  heading: 15,   // strong rows, command-palette input, window-state titles
  title:   17,   // settings pane headings, preview app title
  display: 22,   // about-panel name, viewer doc title, section headers
  hero:    28,   // brand mark, pair code
};

// ── Font weight · 5 rungs ─────────────────────────────────────────────
const FW = {
  normal:   400,   // muted / inline contexts
  medium:   500,   // resting UI weight (labels, body)
  semibold: 600,   // active / selected state, buttons
  bold:     700,   // titles & headings
  heavy:    800,   // brand mark only
};

// ── Line height · 3 rungs ─────────────────────────────────────────────
const LH = {
  tight:   1.15,   // display & titles (1.05–1.18 in app)
  normal:  1.5,    // body, chat, prose (1.45–1.58)
  relaxed: 1.65,   // code & terminal (1.55–1.65)
};

// ── Letter spacing · 3 rungs ──────────────────────────────────────────
const LS = {
  tight:  '-0.02em',  // display / titles — negative tracking
  normal: '0',        // body & labels
  wide:   '0.06em',   // uppercase eyebrows & micro-labels
};

// ── Corner radius · 5 rungs ───────────────────────────────────────────
//   xs 4 · sm 6 · md 8 · lg 11 · xl 13   (circles use 50%, pills use 999)
const RADIUS = {
  xs:  4,   // badges, chips, keycaps
  sm:  6,   // list rows, segmented controls, small icon buttons
  md:  8,   // buttons, fields, cards, menus, popovers
  lg: 11,   // panels, code blocks, composer surfaces
  xl: 13,   // message bubbles, modals
  full: 999,// pills & toggles (circles use 50%)
};

// ── Spacing · 4px base, 13 rungs (0–12) ───────────────────────────────
// Dense-desktop rhythm: a 2px half-step at the bottom for tight chrome,
// settling onto a 4px grid. Values in px (inline styles consume numbers).
const SPACE = {
  0: 0,  1: 2,  2: 4,  3: 6,  4: 8,  5: 12, 6: 16,
  7: 20, 8: 24, 9: 32, 10: 40, 11: 48, 12: 64,
};

// ── Motion · durations (ms) + easing curves ───────────────────────────
const DURATION = {
  instant: 50,   fast: 150,  normal: 250,  slow: 400,  slower: 600,
};
const EASING = {
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  in:      'cubic-bezier(0.4, 0, 1, 1)',
  out:     'cubic-bezier(0, 0, 0.2, 1)',
  bounce:  'cubic-bezier(0.34, 1.56, 0.64, 1)',
  signature:'cubic-bezier(0.22, 1, 0.36, 1)',  // the app's slide-in ease
};


// ── Design tokens · two themes ────────────────────────────────────────
// `T` is the single token object every component reads as `T.x` at render
// time. It is THEME-SWAPPABLE: at module-eval the active theme's values are
// copied into `T` (Object.assign), so every component — and every module-level
// style atom that bakes a `T.*` color at eval — gets the right theme with no
// per-call-site branching. Light is warm paper; dark is warm charcoal.
// The host page opts in by setting `window.__mfTheme = 'dark'` BEFORE these
// modules load; `setMfTheme(mode)` persists + reloads. Review pages that don't
// opt in stay light. ACCENT is shared by both themes.
const MF_LIGHT = {
  windowBg:    '#e9e7e2',
  glass:       'rgba(240,237,231,0.84)',  // frosted chrome — titlebar + sidebar (blur 40px)
  content:     '#ffffff',
  content2:    '#f8f6f2',
  raised:      '#f3efe7',
  tabBar:      '#f3f0ea',
  tabBarActive:'#ffffff',
  popBg:       '#ffffff',
  popShadow:   '0 16px 40px rgba(0,0,0,0.20), 0 0 0 0.5px rgba(0,0,0,0.14)',
  border:      'rgba(0,0,0,0.08)',
  borderH:     'rgba(0,0,0,0.14)',
  borderFocus: ACCENT,
  hairline:    'rgba(0,0,0,0.06)',
  focusRing:   '0 0 0 3px rgba(10,132,255,0.35)',  // keyboard :focus-visible
  text:        '#1c1c1e',
  text2:       '#5e5d5a',
  text3:       '#92918d',
  text4:       '#bcbab5',
  chipBg:      'rgba(0,0,0,0.05)',
  selBg:       'rgba(10,132,255,0.10)',
  rowHover:    'rgba(0,0,0,0.04)',
  termBg:      '#1d1d20',
  termFg:      '#e7e6e3',
  termCmt:     '#7a7a82',
  termGreen:   '#30d158',
  termCyan:    '#5ac8fa',
  termAmber:   '#ff9f0a',
  red:         '#dc3545',
  amber:       '#d97706',
  green:       '#28a745',
  // Code colors
  codeBg:      '#fbfaf7',
  codeKw:      '#9b2393',
  codeStr:     '#c41a16',
  codeFn:      '#326d74',
  codeType:    '#5b269a',
  codeNum:     '#1c00cf',
  codeCmt:     '#707f8c',
  codeFg:      '#1f1f24',
  shadow:      '0 24px 60px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.18)',
  // User-turn cool card (module 11)
  umInk:       '#1b1e26',
  umCard:      'linear-gradient(180deg, #f4f6fb 0%, #eef1f9 100%)',
  umEdge:      'rgba(40,70,150,0.13)',
  umDash:      'rgba(40,70,150,0.32)',
  umFade:      '#eef1f9',
  // Viewer matte / transparency checkerboard (module 15)
  viewerMatte: '#e6e2da',
  viewerCheckA:'#efece6',
  viewerCheckB:'#dcd8d0',
};
const MF_DARK = {
  windowBg:    '#1a1714',
  glass:       'rgba(30,27,22,0.85)',     // frosted chrome — titlebar + sidebar (blur 40px)
  content:     '#221f1a',
  content2:    '#1c1915',
  raised:      '#2c2820',
  tabBar:      '#1e1b16',
  tabBarActive:'#332e25',
  popBg:       '#2a261f',
  popShadow:   '0 18px 44px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.10)',
  border:      'rgba(255,255,255,0.10)',
  borderH:     'rgba(255,255,255,0.18)',
  borderFocus: ACCENT,
  hairline:    'rgba(255,255,255,0.06)',
  focusRing:   '0 0 0 3px rgba(10,132,255,0.50)',  // keyboard :focus-visible
  text:        '#f1ede5',
  text2:       '#ada89f',
  text3:       '#847f76',
  text4:       '#585349',
  chipBg:      'rgba(255,255,255,0.06)',
  selBg:       'rgba(10,132,255,0.26)',
  rowHover:    'rgba(255,255,255,0.05)',
  termBg:      '#141310',
  termFg:      '#e7e6e3',
  termCmt:     '#7f7a72',
  termGreen:   '#30d158',
  termCyan:    '#5ac8fa',
  termAmber:   '#ff9f0a',
  red:         '#ff6b6b',
  amber:       '#e6a23c',
  green:       '#3ad06a',
  // Code colors (warm dark editor)
  codeBg:      '#1b1814',
  codeKw:      '#e592d6',
  codeStr:     '#eaa48f',
  codeFn:      '#7fcfd6',
  codeType:    '#c6a6f5',
  codeNum:     '#9fb4ff',
  codeCmt:     '#6f7a83',
  codeFg:      '#e6e2da',
  shadow:      '0 28px 64px rgba(0,0,0,0.66), 0 0 0 0.5px rgba(255,255,255,0.10)',
  umInk:       '#e9ecf5',
  umCard:      'linear-gradient(180deg, #262a35 0%, #20242e 100%)',
  umEdge:      'rgba(150,175,235,0.20)',
  umDash:      'rgba(150,175,235,0.34)',
  umFade:      '#20242e',
  viewerMatte: '#16140f',
  viewerCheckA:'#1c1a16',
  viewerCheckB:'#26231d',
};

const __mfMode = (typeof window !== 'undefined' && window.__mfTheme === 'dark') ? 'dark' : 'light';
const T = {};
Object.assign(T, __mfMode === 'dark' ? MF_DARK : MF_LIGHT);
if (typeof document !== 'undefined') document.documentElement.setAttribute('data-mf-theme', __mfMode);
if (typeof window !== 'undefined') {
  window.MF_LIGHT = MF_LIGHT;
  window.MF_DARK = MF_DARK;
  // Persist + reload so module-eval re-bakes every token under the new theme.
  window.setMfTheme = (mode) => {
    try { localStorage.setItem('mfTheme', mode === 'dark' ? 'dark' : 'light'); } catch (e) {}
    location.reload();
  };
}

// Make the focus-ring token live: a themed, conservative keyboard-only ring
// on native focusables (mouse clicks stay ring-free via :focus-visible).
if (typeof document !== 'undefined') {
  const __fr = document.createElement('style');
  // Global ring for keyboard focus. Controls that already provide their own
  // focus affordance (e.g. a field nested in an accent-bordered card) opt out
  // with [data-noring] — they still suppress the native outline, just no ring.
  __fr.textContent =
    '[data-noring]:focus-visible{outline:none;}' +
    'button:not([data-noring]):focus-visible,a:not([data-noring]):focus-visible,input:not([data-noring]):focus-visible,textarea:not([data-noring]):focus-visible,select:not([data-noring]):focus-visible,[tabindex]:not([data-noring]):focus-visible{' +
      'outline:none;box-shadow:' + T.focusRing + ';border-radius:' + RADIUS.sm + 'px;}';
  (document.head || document.documentElement).appendChild(__fr);
}

// ── Icons ─────────────────────────────────────────────────────────────
function Icon({ name, size = 13, color = 'currentColor', stroke = 1.6 }) {
  const s = size;
  const c = { width: s, height: s, viewBox: '0 0 18 18', fill: 'none',
    stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'chat': return (<svg {...c}><path d="M3 4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7.5L4.5 15v-3z"/></svg>);
    case 'sparkles': return (<svg {...c}><path d="M6 2.5l.9 2.1L9 5.5l-2.1.9L6 8.5l-.9-2.1L3 5.5l2.1-.9zM12 9l.7 1.6 1.6.7-1.6.7L12 13l-.7-1.6L9.7 10.7l1.6-.7z"/></svg>);
    case 'code': return (<svg {...c}><path d="M6 5.5 2.5 9 6 12.5M12 5.5 15.5 9 12 12.5M10.5 4 7.5 14"/></svg>);
    case 'doc': return (<svg {...c}><path d="M4.5 2.5h6l3 3V15a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M10.5 2.5V5.5h3"/></svg>);
    case 'doc.text': return (<svg {...c}><path d="M4.5 2.5h6l3 3V15a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M10.5 2.5V5.5h3M6 8.5h6M6 10.5h6M6 12.5h4"/></svg>);
    case 'folder': return (<svg {...c}><path d="M2.5 5a1 1 0 0 1 1-1h3l1.2 1.2h6.8a1 1 0 0 1 1 1v7.3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/></svg>);
    case 'folder.fill': return (<svg {...c} fill={color}><path d="M2.5 5a1 1 0 0 1 1-1h3l1.2 1.2h6.8a1 1 0 0 1 1 1v7.3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/></svg>);
    case 'terminal': return (<svg {...c}><rect x="2.5" y="3.5" width="13" height="11" rx="1.5"/><path d="M5 7l2.5 2L5 11M9.5 11.5h3.5"/></svg>);
    case 'eye': return (<svg {...c}><path d="M1.5 9C3 5.5 6 3.5 9 3.5s6 2 7.5 5.5c-1.5 3.5-4.5 5.5-7.5 5.5S3 12.5 1.5 9z"/><circle cx="9" cy="9" r="2"/></svg>);
    case 'eye.slash': return (<svg {...c}><path d="M7 4c.65-.2 1.3-.3 2-.3 3 0 6 2 7.5 5.3a11 11 0 0 1-2 2.7M11.4 10.6A2 2 0 0 1 7.4 7.6M4.7 5.4A11 11 0 0 0 1.5 9c1.5 3.3 4.5 5.3 7.5 5.3.9 0 1.8-.18 2.6-.5M2 2l14 14"/></svg>);
    case 'grip': return (<svg {...c}><circle cx="6.5" cy="5" r="1"/><circle cx="11.5" cy="5" r="1"/><circle cx="6.5" cy="9" r="1"/><circle cx="11.5" cy="9" r="1"/><circle cx="6.5" cy="13" r="1"/><circle cx="11.5" cy="13" r="1"/></svg>);
    case 'diff': return (<svg {...c}><path d="M5.5 3v8a2 2 0 0 0 2 2h3M12.5 15V7a2 2 0 0 0-2-2h-3M5.5 1v3M5.5 1l-1.5 1.5M5.5 1l1.5 1.5M12.5 17v-3M12.5 17l-1.5-1.5M12.5 17l1.5-1.5"/></svg>);
    case 'branch': return (<svg {...c}><circle cx="5" cy="4.5" r="1.6"/><circle cx="5" cy="13.5" r="1.6"/><circle cx="13" cy="4.5" r="1.6"/><path d="M5 6.1v5.8M5 9h4a4 4 0 0 0 4-4V6.1"/></svg>);
    case 'plus': return (<svg {...c}><path d="M9 3.5v11M3.5 9h11"/></svg>);
    case 'checklist.box': return (<svg {...c}><rect x="3" y="3" width="12" height="12" rx="3"/><path d="M6.2 9.2 8.2 11.2 12 6.8"/></svg>);
    case 'xmark': return (<svg {...c}><path d="M4.5 4.5l9 9M13.5 4.5l-9 9"/></svg>);
    case 'checkmark': return (<svg {...c}><path d="M3.5 9.5 7 13l7.5-8.5"/></svg>);
    case 'lock': return (<svg {...c}><rect x="4" y="8" width="10" height="7" rx="1.5"/><path d="M6 8V6a3 3 0 0 1 6 0v2"/></svg>);
    case 'shield': return (<svg {...c}><path d="M9 2.5 4 4.2v4.3c0 3 2.1 5.4 5 6.5 2.9-1.1 5-3.5 5-6.5V4.2L9 2.5z"/></svg>);
    case 'gauge': return (<svg {...c}><path d="M3.5 13a6 6 0 1 1 11 0"/><path d="M9 11.5 12 7"/><circle cx="9" cy="11.8" r="0.6" fill={color}/></svg>);
    case 'clipboard': return (<svg {...c}><rect x="4" y="3.5" width="10" height="11.5" rx="1.6"/><path d="M7 3.5a2 2 0 0 1 4 0"/></svg>);
    case 'clipboard.check': return (<svg {...c}><rect x="4" y="3.5" width="10" height="11.5" rx="1.6"/><path d="M7 3.5a2 2 0 0 1 4 0"/><path d="M6.6 9.6 8.1 11.1 11.4 7.8"/></svg>);
    case 'worktree': return (<svg {...c}><circle cx="5" cy="4.6" r="1.5"/><path d="M5 6.1v7.3"/><circle cx="5" cy="13.4" r="1.5"/><path d="M5 9h4.5a2 2 0 0 0 2-2V6.4"/><path d="M11.5 4.2 13 5.7l-1.5 1.5"/></svg>);
    case 'exclamationmark.triangle': return (<svg {...c}><path d="M9 3 2.5 14.5h13L9 3z"/><path d="M9 7v3.5"/><circle cx="9" cy="12.4" r="0.6" fill={color}/></svg>);
    case 'folder.git': return (<svg {...c}><path d="M2.5 5.2a1 1 0 0 1 1-1h3l1.2 1.2h6.8a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/><circle cx="7" cy="8.3" r="1"/><circle cx="7" cy="12.5" r="1"/><path d="M7 9.3v2.2"/><circle cx="11.3" cy="8.3" r="1"/><path d="M11.3 9.3a3 3 0 0 1-3 3"/></svg>);
    case 'folder.plus': return (<svg {...c}><path d="M2.5 5a1 1 0 0 1 1-1h3l1.2 1.2h6.8a1 1 0 0 1 1 1v7.3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/><path d="M9 8.2v4.2M6.9 10.3h4.2"/></svg>);
    case 'locate': return (<svg {...c}><circle cx="9" cy="9" r="3.2"/><path d="M9 1.8v2.4M9 13.8v2.4M1.8 9h2.4M13.8 9h2.4"/></svg>);
    case 'refresh': return (<svg {...c}><path d="M14.8 7.5a6 6 0 1 0 .2 3"/><path d="M15 3v4h-4"/></svg>);
    case 'camera': return (<svg {...c}><path d="M2.5 6.5a1 1 0 0 1 1-1h1.8l1-1.6h5.4l1 1.6h1.8a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1z"/><circle cx="9" cy="9.8" r="2.4"/></svg>);
    case 'frame': return (<svg {...c}><path d="M5.5 2v14M12.5 2v14M2 5.5h14M2 12.5h14"/></svg>);
    case 'smartphone': return (<svg {...c}><rect x="5" y="2.5" width="8" height="13" rx="1.6"/><path d="M8 13.2h2"/></svg>);
    case 'trash': return (<svg {...c}><path d="M3.5 4.5h11M7 4.5V3a.8.8 0 0 1 .8-.8h2.4A.8.8 0 0 1 11 3v1.5M5 4.5l.6 9.2a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-9.2"/></svg>);
    case 'eraser': return (<svg {...c}><path d="M7.5 15h7.5"/><path d="M3.4 11.2l5-5a1.3 1.3 0 0 1 1.8 0l3.6 3.6a1.3 1.3 0 0 1 0 1.8L9.7 15H6.3l-2.9-2.9a1.3 1.3 0 0 1 0-1.9z"/><path d="M7 7.6l4.4 4.4"/></svg>);
    case 'chevron.left': return (<svg {...c}><path d="M11.5 3.5 5.5 9l6 5.5"/></svg>);
    case 'chevron.right': return (<svg {...c}><path d="M6.5 3.5 12.5 9l-6 5.5"/></svg>);
    case 'chevron.down': return (<svg {...c}><path d="M3.5 6.5 9 12l5.5-5.5"/></svg>);
    case 'chevron.up.down': return (<svg {...c}><path d="M5.5 7 9 3.5 12.5 7M5.5 11 9 14.5l3.5-3.5"/></svg>);
    case 'magnifyingglass': return (<svg {...c}><circle cx="8" cy="8" r="4.5"/><path d="M11.5 11.5 15 15"/></svg>);
    case 'sidebar.left': return (<svg {...c}><rect x="2.5" y="3.5" width="13" height="11" rx="2"/><path d="M7 3.5v11"/></svg>);
    case 'sidebar.right': return (<svg {...c}><rect x="2.5" y="3.5" width="13" height="11" rx="2"/><path d="M11 3.5v11"/></svg>);
    case 'square.split.2x1': return (<svg {...c}><rect x="2.5" y="4.5" width="13" height="9" rx="1.5"/><path d="M9 4.5v9"/></svg>);
    case 'square.split.1x2': return (<svg {...c}><rect x="2.5" y="4.5" width="13" height="9" rx="1.5"/><path d="M2.5 9h13"/></svg>);
    case 'square.split.top2': return (<svg {...c}><rect x="2.5" y="4.5" width="13" height="9" rx="1.5"/><path d="M2.5 9h13M9 4.5v4.5"/></svg>);
    case 'square.grid.2x2': return (<svg {...c}><rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1"/><rect x="10" y="2.5" width="5.5" height="5.5" rx="1"/><rect x="2.5" y="10" width="5.5" height="5.5" rx="1"/><rect x="10" y="10" width="5.5" height="5.5" rx="1"/></svg>);
    case 'rectangle.stack': return (<svg {...c}><rect x="2.5" y="4.5" width="4" height="9" rx="1"/><rect x="7" y="4.5" width="4" height="9" rx="1"/><rect x="11.5" y="4.5" width="4" height="9" rx="1"/></svg>);
    case 'ellipsis': return (<svg {...c} fill={color} stroke="none"><circle cx="4.5" cy="9" r="1.1"/><circle cx="9" cy="9" r="1.1"/><circle cx="13.5" cy="9" r="1.1"/></svg>);
    case 'paperclip': return (<svg {...c}><path d="M14 7.5 7.5 14a3.2 3.2 0 0 1-4.5-4.5l7-7a2.1 2.1 0 0 1 3 3l-7 7a1 1 0 0 1-1.4-1.4l5.7-5.7"/></svg>);
    case 'at': return (<svg {...c}><circle cx="9" cy="9" r="3.2"/><path d="M12.2 9v1.4a2 2 0 0 0 3.6 0V9a6.8 6.8 0 1 0-2.7 5.4"/></svg>);
    case 'arrow.up': return (<svg {...c}><path d="M9 14.5V3.5M4.5 8 9 3.5 13.5 8"/></svg>);
    case 'bolt': return (<svg {...c}><path d="M10 2 5 10h3l-1 6 5-8H9l1-6z" fill={color} stroke="none"/></svg>);
    case 'circle.dot': return (<svg {...c} fill={color} stroke="none"><circle cx="9" cy="9" r="3.5"/></svg>);
    case 'circle.dotted': return (<svg {...c} strokeDasharray="1.6 2"><circle cx="9" cy="9" r="5.5"/></svg>);
    case 'play.fill': return (<svg {...c} fill={color} stroke="none"><path d="M5 3.5v11l9-5.5z"/></svg>);
    case 'stop.fill': return (<svg {...c} fill={color} stroke="none"><rect x="4.5" y="4.5" width="9" height="9" rx="1"/></svg>);
    case 'pin': return (<svg {...c}><path d="M6 2.8h6M7.6 2.8v4.3c0 .8-.4 1.5-1 2l-1.1.8h7l-1.1-.8c-.6-.5-1-1.2-1-2V2.8M9 11.4V15.2"/></svg>);
    case 'tag': return (<svg {...c}><path d="M2.5 8V3.5a1 1 0 0 1 1-1H8L15.5 10 10 15.5 2.5 8z"/><circle cx="6" cy="6" r=".8" fill={color}/></svg>);
    case 'arrow.clockwise': return (<svg {...c}><path d="M14.5 8a5.5 5.5 0 1 1-2.2-4.4M14.5 3v3h-3"/></svg>);
    case 'wifi': return (<svg {...c}><path d="M9 13.5h.01M5 10.5a5.5 5.5 0 0 1 8 0M2.5 7.5a9 9 0 0 1 13 0"/></svg>);
    case 'wand': return (<svg {...c}><path d="M3 15 12.5 5.5M11.5 4 14 6.5M5.5 2v2M9.5 2.5l-.5 1 1 .5-1 .5.5 1-1-.5-.5 1-.5-1-1 .5.5-1-1-.5 1-.5-.5-1 1 .5z"/></svg>);
    case 'wand.sparkles': return (<svg {...c}><path d="M3 15.5 10.5 8"/><path d="M12.5 3l.7 1.6L14.8 5.3l-1.6.7L12.5 7.6 11.8 6l-1.6-.7L11.8 4.6zM6 3l.45 1.05L7.5 4.5l-1.05.45L6 6l-.45-1.05L4.5 4.5l1.05-.45zM14 9.5l.4.95.95.4-.95.4-.4.95-.4-.95-.95-.4.95-.4z"/></svg>);
    case 'bot': return (<svg {...c}><rect x="3.5" y="6" width="11" height="8" rx="2.4"/><path d="M9 3v3"/><circle cx="9" cy="2.6" r="1"/><path d="M6.8 9.6v1.2M11.2 9.6v1.2"/><path d="M1.8 9v2M16.2 9v2"/></svg>);
    case 'archive': return (<svg {...c}><rect x="2.5" y="3.5" width="13" height="3.5" rx="0.8"/><path d="M3.5 7v7.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V7M7 10h4"/></svg>);
    case 'arrow.down': return (<svg {...c}><path d="M9 3.5v11M4.5 10 9 14.5 13.5 10"/></svg>);
    case 'pop': return (<svg {...c}><path d="M8 3.5H4.5a1 1 0 0 0-1 1V13.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10M9.5 8.5 15 3M15 3h-4M15 3v4"/></svg>);
    case 'gear': return (<svg {...c}><g transform="scale(0.75)"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></g></svg>);
    case 'sun': return (<svg {...c}><circle cx="9" cy="9" r="3.2"/><path d="M9 1.5v1.8M9 14.7v1.8M1.5 9h1.8M14.7 9h1.8M3.7 3.7l1.3 1.3M13 13l1.3 1.3M3.7 14.3l1.3-1.3M13 5l1.3-1.3"/></svg>);
    case 'moon': return (<svg {...c}><path d="M14.5 10.6A6 6 0 0 1 7.4 3.5 6 6 0 1 0 14.5 10.6z"/></svg>);
    case 'lightbulb': return (<svg {...c}><path d="M9 2.5a4.5 4.5 0 0 0-2.5 8.3V13a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-2.2A4.5 4.5 0 0 0 9 2.5zM7.5 15.5h3"/></svg>);
    case 'sliders': return (<svg {...c}><path d="M3 5.5h6M12 5.5h3M3 12.5h3M9 12.5h6"/><circle cx="10.5" cy="5.5" r="1.6"/><circle cx="7.5" cy="12.5" r="1.6"/></svg>);
    case 'bell': return (<svg {...c}><path d="M9 2.6a4 4 0 0 0-4 4c0 3.2-1.2 4.6-1.7 5.2a.5.5 0 0 0 .4.8h10.6a.5.5 0 0 0 .4-.8C14.2 11.2 13 9.8 13 6.6a4 4 0 0 0-4-4z"/><path d="M7.5 15a1.7 1.7 0 0 0 3 0"/></svg>);
    case 'keyboard': return (<svg {...c}><rect x="2" y="5" width="14" height="8" rx="1.6"/><path d="M5 7.6h.01M7.5 7.6h.01M10 7.6h.01M12.6 7.6h.01M5.6 10.4h6.8"/></svg>);
    case 'globe': return (<svg {...c}><circle cx="9" cy="9" r="6.3"/><path d="M2.7 9h12.6M9 2.7c1.8 1.8 2.6 4 2.6 6.3S10.8 13.5 9 15.3C7.2 13.5 6.4 11.3 6.4 9S7.2 4.5 9 2.7z"/></svg>);
    case 'info': return (<svg {...c}><circle cx="9" cy="9" r="6.3"/><path d="M9 8.2v4M9 5.7h.01"/></svg>);
    case 'cpu': return (<svg {...c}><rect x="5" y="5" width="8" height="8" rx="1.4"/><path d="M7 2.6v2.4M11 2.6v2.4M7 13v2.4M11 13v2.4M2.6 7H5M2.6 11H5M13 7h2.4M13 11h2.4"/></svg>);
    case 'copy': return (<svg {...c}><rect x="6" y="6" width="8.5" height="8.5" rx="1.6"/><path d="M11.5 6V4.5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1V11a1 1 0 0 0 1 1h1.5"/></svg>);
    case 'return': return (<svg {...c}><path d="M14 4.5v3a2 2 0 0 1-2 2H4M6.5 7 4 9.5 6.5 12"/></svg>);
    case 'pencil': return (<svg {...c}><path d="M11.5 3.5l3 3M3 13.5l.5-2.5 8-8 2 2-8 8-2.5.5z"/></svg>);
    case 'quote': return (<svg {...c} fill={color} stroke="none"><path d="M6.8 4.4C5 5.1 3.7 6.8 3.7 8.8V13.2h4.4V8.8H5.8c0-1 .6-1.8 1.6-2.3l-.6-2.1zM14.3 4.4c-1.8.7-3.1 2.4-3.1 4.4V13.2h4.4V8.8h-2.3c0-1 .6-1.8 1.6-2.3l-.6-2.1z"/></svg>);
    case 'wrench': return (<svg {...c}><path d="M13.6 3.4a3 3 0 0 0-3.8 3.7L4 12.9a1.35 1.35 0 0 0 1.9 1.9l5.8-5.8a3 3 0 0 0 3.7-3.8l-1.9 1.9-1.7-.4-.4-1.7 1.8-1.6z"/></svg>);
    case 'clock': return (<svg {...c}><circle cx="9" cy="9" r="6.3"/><path d="M9 5.4V9l2.6 1.6"/></svg>);
    case 'photo': return (<svg {...c}><rect x="2.5" y="3.5" width="13" height="11" rx="1.8"/><circle cx="6.4" cy="7.3" r="1.3"/><path d="M3 12.6l3.6-3.1 2.4 2 3-3.4 3 4.4"/></svg>);
    case 'plug': return (<svg {...c}><path d="M6 2v3.4M12 2v3.4"/><path d="M4.6 5.4h8.8V8.5a4.4 4.4 0 0 1-8.8 0z"/><path d="M9 12.9V16"/></svg>);
    case 'layers': return (<svg {...c}><path d="M9 2.4 16 6.1 9 9.8 2 6.1z"/><path d="M2.4 9.7 9 13.3l6.6-3.6"/><path d="M2.4 12.5 9 16.1l6.6-3.6"/></svg>);
    case 'calendar': return (<svg {...c}><rect x="2.8" y="4" width="12.4" height="11" rx="1.6"/><path d="M2.8 7.4h12.4M6 2.4v3M12 2.4v3"/></svg>);
    case 'activity': return (<svg {...c}><path d="M2.5 9h2.8l1.8-5 3 11 2-6 1.4 0h2"/></svg>);
    case 'table': return (<svg {...c}><rect x="2.8" y="3.5" width="12.4" height="11" rx="1.4"/><path d="M2.8 7.2h12.4M2.8 10.8h12.4M7 3.7v10.6"/></svg>);
    case 'vector': return (<svg {...c}><rect x="2.5" y="2.5" width="3" height="3" rx="0.5"/><rect x="12.5" y="2.5" width="3" height="3" rx="0.5"/><rect x="2.5" y="12.5" width="3" height="3" rx="0.5"/><rect x="12.5" y="12.5" width="3" height="3" rx="0.5"/><path d="M5.6 4h6.8M4 5.6v6.8M14 5.6v6.8M5.6 14h6.8"/></svg>);
    case 'doc.pdf': return (<svg {...c}><path d="M4.5 2.5h6l3 3V15a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M10.5 2.5V5.5h3"/><rect x="5.8" y="9.3" width="6.4" height="3.6" rx="0.7"/></svg>);
    case 'arrow.up.left.down.right': return (<svg {...c}><path d="M3 3h4M3 3v4M3 3l4 4M15 15h-4M15 15v-4M15 15l-4-4"/></svg>);
    case 'plus.magnifyingglass': return (<svg {...c}><circle cx="8" cy="8" r="4.5"/><path d="M11.5 11.5 15 15M8 6v4M6 8h4"/></svg>);
    case 'minus.magnifyingglass': return (<svg {...c}><circle cx="8" cy="8" r="4.5"/><path d="M11.5 11.5 15 15M6 8h4"/></svg>);
    default: return null;
  }
}

// Tab-type registry ----------------------------------------------------
const TAB_TYPES = {
  chat:     { icon: 'chat',       color: ACCENT,    label: 'Chat' },
  code:     { icon: 'code',       color: '#5b269a', label: 'Code' },
  terminal: { icon: 'terminal',   color: '#5ac8fa', label: 'Terminal' },
  preview:  { icon: 'eye',        color: '#34c759', label: 'Preview' },
  diff:     { icon: 'diff',       color: '#ff9500', label: 'Diff' },
  markdown: { icon: 'doc.text',   color: '#2f6f78', label: 'Markdown' },
  csv:      { icon: 'table',      color: '#1f8a4c', label: 'CSV' },
  image:    { icon: 'photo',      color: '#d97706', label: 'Image' },
  svg:      { icon: 'vector',     color: '#7a3fb0', label: 'SVG' },
  pdf:      { icon: 'doc.pdf',    color: '#c4362b', label: 'PDF' },
};

// Traffic lights -------------------------------------------------------