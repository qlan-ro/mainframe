/**
 * Assemble the base CM6 extension set shared across all CmEditor instances.
 *
 * Returns:
 *   - Static extensions: line numbers, active-line highlight, history, keymaps,
 *     warm-chrome theme, syntax highlight style.
 *   - Two reconfigurable Compartments so CmEditor can hot-swap language packs
 *     and toggle read-only without destroying the view.
 *   - resolveLanguage() — maps a LangPackId to the matching @codemirror/lang-*
 *     Extension; shared by CmEditor and CmDiffEditor.
 */
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import type { LangPackId } from '@/lib/editor/file-types';
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  keymap,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { syntaxHighlighting, HighlightStyle, foldGutter, codeFolding, StreamLanguage } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { go } from '@codemirror/legacy-modes/mode/go';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { java, scala } from '@codemirror/legacy-modes/mode/clike';

// ── Warm-chrome highlight style from --mf-code-* tokens ─────────────────────
//
// Token-to-CSS-var mapping mirrors the spike and the desktop setup.ts palette.
// CM6 theme reads CSS vars at paint time so the tokens update with the page
// theme without needing a view rebuild.

export const warmHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--mf-code-kw)' },
  { tag: tags.operator, color: 'var(--mf-code-op, var(--mf-code-fg))' },
  { tag: tags.string, color: 'var(--mf-code-str)' },
  { tag: tags.number, color: 'var(--mf-code-num)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--mf-code-fn)' },
  { tag: tags.typeName, color: 'var(--mf-code-type)' },
  { tag: tags.className, color: 'var(--mf-code-type)' },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: 'var(--mf-code-cmt)', fontStyle: 'italic' },
  { tag: tags.propertyName, color: 'var(--mf-code-prop, var(--mf-code-fg))' },
  { tag: tags.bool, color: 'var(--mf-code-kw)' },
  { tag: tags.null, color: 'var(--mf-code-kw)' },
  { tag: tags.variableName, color: 'var(--mf-code-fg)' },
  { tag: tags.punctuation, color: 'var(--mf-code-fg)' },
  { tag: tags.heading, color: 'var(--mf-code-fn)', fontWeight: 'bold' },
]);

// ── Warm-chrome base theme ───────────────────────────────────────────────────
//
// All colors are CSS-var references so they update automatically when the app
// theme changes — no view rebuild needed.
//
// The CM6 `dark` flag controls internal default assumptions (unfocused selection
// tint, cursor visibility) for properties NOT overridden by our theme spec. We
// derive it from the document class at call time so light and dark schemes both
// get correct CM6-internal defaults.

const CM6_THEME_SPEC = {
  '&': {
    backgroundColor: 'var(--mf-code-bg)',
    color: 'var(--mf-code-fg)',
    fontSize: '12px',
    height: '100%',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    caretColor: 'var(--mf-code-fg)',
    padding: '4px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--mf-code-bg)',
    color: 'var(--mf-text-4)',
    border: 'none',
    paddingRight: '8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--mf-code-fg)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--mf-cm-active-line)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--mf-code-fg)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--mf-cm-selection)',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--mf-cm-selection-focused)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--mf-cm-match)',
    outline: '1px solid var(--mf-cm-match-border)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--mf-cm-match-selected)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--mf-cm-sel-match)',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-foldGutter': {
    color: 'var(--mf-code-cmt)',
  },
} as const;

/**
 * Build the warm-chrome CM6 base theme with a mode-aware `dark` flag.
 *
 * Pass `isDark = true` for dark color schemes so CM6's internal defaults
 * (unfocused selection tint, cursor visibility) match the scheme. Callers
 * that don't track the theme can use the exported `warmTheme` singleton which
 * reads `document.documentElement.classList.contains('dark')` at module load.
 */
export function makeWarmTheme(isDark: boolean): ReturnType<typeof EditorView.theme> {
  return EditorView.theme(CM6_THEME_SPEC, { dark: isDark });
}

/**
 * Default warm-chrome theme instance. Reads the document's `dark` class at
 * module evaluation time so the CM6 dark flag matches the app's initial scheme.
 * This covers the common case; hot-swap on scheme change uses a Compartment.
 */
export const warmTheme = makeWarmTheme(
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
);

// ── Per-instance compartments ────────────────────────────────────────────────

/**
 * Create a fresh pair of Compartments for one CmEditor instance.
 *
 * Compartments are per-state objects in CM6 — sharing a Compartment across
 * multiple EditorView instances causes reconfigure() to target the wrong state.
 * Always call this once per component mount (inside a useRef initialiser or a
 * mount effect) and never export module-level singletons.
 */
export function createEditorCompartments() {
  return {
    /** Swap the active language pack at runtime via `.reconfigure`. */
    lang: new Compartment(),
    /** Toggle read-only at runtime via `.reconfigure`. */
    readOnly: new Compartment(),
    /** Reconfigurable slot for caller-supplied extra extensions (e.g. LSP). */
    extra: new Compartment(),
  };
}

// ── Base extension array ─────────────────────────────────────────────────────

/**
 * Build the base extension set for a CmEditor instance.
 *
 * Language and read-only are **not** included here — they are injected as
 * compartment-wrapped extensions by CmEditor directly so it can reconfigure
 * them on prop changes without rebuilding the whole state.
 */
export function buildBaseExtensions(): Extension[] {
  return [
    lineNumbers(),
    foldGutter(),
    codeFolding(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    history(),
    EditorState.allowMultipleSelections.of(true),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    warmTheme,
    syntaxHighlighting(warmHighlight, { fallback: true }),
  ];
}

// ── Language pack resolver (shared) ─────────────────────────────────────────

/**
 * Map a LangPackId to its @codemirror/lang-* Extension.
 * Returns an empty extension array for 'plaintext' (no grammar needed).
 * Used by both CmEditor and CmDiffEditor so the mapping stays in one place.
 */
export function resolveLanguage(lang: LangPackId): Extension {
  switch (lang) {
    case 'typescript':
      return javascript({ typescript: true, jsx: true });
    case 'javascript':
      return javascript({ jsx: true });
    case 'css':
      return css();
    case 'html':
      return html();
    case 'json':
      return json();
    case 'markdown':
      return markdown();
    case 'python':
      return python();
    case 'rust':
      return rust();
    case 'yaml':
      return StreamLanguage.define(yaml);
    case 'toml':
      return StreamLanguage.define(toml);
    case 'go':
      return StreamLanguage.define(go);
    case 'sql':
      return StreamLanguage.define(standardSQL);
    case 'shell':
      return StreamLanguage.define(shell);
    case 'scala':
      return StreamLanguage.define(scala);
    case 'java':
      return StreamLanguage.define(java);
    default:
      return [];
  }
}
