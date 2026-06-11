/**
 * CM6 extensions that wire the LSP seam into the editor:
 *
 *   1. hoverTooltip  — calls providers.getHover on cursor hover; renders
 *                      markdown/plaintext content in a warm-chrome tooltip.
 *   2. ⌘-click jump  — mousedown gated on metaKey → getDefinition →
 *                      emitSurfaceIntent({type:'open-file'}) + push history.
 *                      NEVER builds a peek widget (by design; ADR-001).
 *   3. diagnostics   — linter() backed by getDiagnostics if the server
 *                      advertises it (no-op otherwise).
 *
 * Usage:
 *   view.dispatch({ effects: lspExtensions(providers, opts) })
 *   or include `createLspExtensions(...)` in the initial extension array.
 */
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { LspProviders, LspPosition } from '@/lib/lsp';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { jumpHistory } from './navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LspExtensionOptions {
  /** LSP project id (passed to every provider call). */
  projectId: string;
  /** Language id (e.g. "typescript"). */
  language: string;
  /** Absolute path to the file open in this view. */
  filePath: string;
  /** Set true when the server is connected and ready. Hover/def are no-ops until then. */
  lspReady?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a CM6 document offset to an LSP {line, character} position. */
function offsetToLspPos(view: EditorView, offset: number): LspPosition {
  const line = view.state.doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

/** Sanitize markdown-ish hover content for safe display as HTML. */
function renderHoverHtml(value: string, kind: 'plaintext' | 'markdown'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cm-lsp-hover';
  if (kind === 'markdown') {
    // Minimal markdown: code fences → <code>, rest as pre-wrapped text.
    const lines = value.split('\n');
    let inCode = false;
    const parts: string[] = [];
    for (const raw of lines) {
      if (raw.startsWith('```')) {
        inCode = !inCode;
        parts.push(inCode ? '<code class="cm-lsp-hover-code">' : '</code>');
      } else {
        const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        parts.push(inCode ? escaped : `<span>${escaped}</span>`);
      }
    }
    el.innerHTML = parts.join('\n');
  } else {
    el.textContent = value;
  }
  return el;
}

// ---------------------------------------------------------------------------
// 1. hoverTooltip extension
// ---------------------------------------------------------------------------

function buildHoverExtension(providers: LspProviders, opts: LspExtensionOptions): Extension {
  return hoverTooltip(async (view: EditorView, pos: number): Promise<Tooltip | null> => {
    if (!opts.lspReady) return null;

    const position = offsetToLspPos(view, pos);
    let hover = null;
    try {
      hover = await providers.getHover(opts.projectId, opts.language, {
        filePath: opts.filePath,
        position,
      });
    } catch (err) {
      console.warn('[cm-lsp] getHover failed', err);
      return null;
    }

    if (!hover || hover.contents.length === 0) return null;

    const firstContent = hover.contents[0];
    if (!firstContent) return null;

    return {
      pos,
      above: true,
      create(): { dom: HTMLElement } {
        const container = document.createElement('div');
        container.className = 'cm-lsp-hover-container';
        for (const content of hover.contents) {
          container.appendChild(renderHoverHtml(content.value, content.kind));
        }
        return { dom: container };
      },
    };
  });
}

// ---------------------------------------------------------------------------
// 2. ⌘-click go-to-definition extension
// ---------------------------------------------------------------------------

function buildGoToDefExtension(providers: LspProviders, opts: LspExtensionOptions): Extension {
  return EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView) {
      if (!event.metaKey) return false;
      if (!opts.lspReady) return false;

      // Capture the current position before the async call.
      const clickPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (clickPos == null) return false;

      const fromEntry = {
        path: opts.filePath,
        ...offsetToLspPos(view, clickPos),
      };

      // Fire async — don't block the event.
      void (async () => {
        const lspPos = offsetToLspPos(view, clickPos);
        let locations: Awaited<ReturnType<LspProviders['getDefinition']>> = [];
        try {
          locations = await providers.getDefinition(opts.projectId, opts.language, {
            filePath: opts.filePath,
            position: lspPos,
          });
        } catch (err) {
          console.warn('[cm-lsp] getDefinition failed', err);
          return;
        }

        const target = locations[0];
        if (!target) return;

        // Push the from-position onto the jump history before navigating.
        jumpHistory.push(fromEntry);

        const targetPath = target.uri.startsWith('file://') ? target.uri.slice('file://'.length) : target.uri;

        emitSurfaceIntent({ type: 'open-file', path: targetPath });
      })();

      // Prevent the default text selection on meta-click.
      event.preventDefault();
      return true;
    },
  });
}

// ---------------------------------------------------------------------------
// 3. Diagnostics (linter) extension
// ---------------------------------------------------------------------------

/**
 * getDiagnostics is not part of the standard LspProviders interface (it's
 * an optional capability). We accept it via the options object so the linter
 * is a no-op for servers that don't support it.
 */
export interface DiagnosticsProvider {
  getDiagnostics(projectId: string, language: string, opts: { filePath: string }): Promise<DiagnosticItem[]>;
}

export interface DiagnosticItem {
  /** 0-based start line. */
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
}

function mapSeverity(s: DiagnosticItem['severity']): Diagnostic['severity'] {
  if (s === 'error') return 'error';
  if (s === 'warning') return 'warning';
  return 'info';
}

function buildDiagnosticsExtension(diagnosticsProvider: DiagnosticsProvider, opts: LspExtensionOptions): Extension {
  return linter(async (view: EditorView): Promise<Diagnostic[]> => {
    if (!opts.lspReady) return [];
    let items: DiagnosticItem[] = [];
    try {
      items = await diagnosticsProvider.getDiagnostics(opts.projectId, opts.language, {
        filePath: opts.filePath,
      });
    } catch (err) {
      console.warn('[cm-lsp] getDiagnostics failed', err);
      return [];
    }

    return items.map((d): Diagnostic => {
      const startLine = view.state.doc.line(d.line + 1);
      const endLine = view.state.doc.line(d.endLine + 1);
      const from = startLine.from + d.character;
      const to = endLine.from + d.endCharacter;
      return {
        from: Math.min(from, view.state.doc.length),
        to: Math.min(to, view.state.doc.length),
        severity: mapSeverity(d.severity),
        message: d.message,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export interface CreateLspExtensionsOptions extends LspExtensionOptions {
  /** Optional diagnostics provider — omit to disable lint gutter. */
  diagnosticsProvider?: DiagnosticsProvider;
}

/**
 * Build the array of CM6 extensions for LSP integration.
 * Include the result in the editor's `extensions` array (or add it to a
 * `Compartment` so it can be reconfigured when lspReady flips to true).
 */
export function createLspExtensions(providers: LspProviders, opts: CreateLspExtensionsOptions): Extension[] {
  const extensions: Extension[] = [buildHoverExtension(providers, opts), buildGoToDefExtension(providers, opts)];

  if (opts.diagnosticsProvider) {
    extensions.push(buildDiagnosticsExtension(opts.diagnosticsProvider, opts));
  }

  return extensions;
}
