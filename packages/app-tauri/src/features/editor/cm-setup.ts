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
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

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

export const warmTheme = EditorView.theme(
  {
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
      color: 'var(--mf-code-cmt)',
      border: 'none',
      paddingRight: '8px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--mf-code-fg)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255,255,255,0.04)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--mf-code-fg)',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(59,130,246,0.3)',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(59,130,246,0.4)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(251,191,36,0.2)',
      outline: '1px solid rgba(251,191,36,0.4)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(251,191,36,0.4)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(59,130,246,0.15)',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
  },
  { dark: true },
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
    default:
      return [];
  }
}
