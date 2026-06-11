/**
 * EditorContextMenu — shadcn context-menu wrapping the CM6 editor.
 *
 * Items:
 *   Copy Reference      — builds `path:line (word)` and writes to clipboard.
 *   Add Agent Context   — quotes `path:line` into the active chat composer via
 *                         `useAui().thread().composer().setQuote(...)`.
 *   Go to Definition    — ⌘-click equivalent via providers.getDefinition.
 *   Find All References — calls providers.getReferences + shows the panel.
 *
 * Browser default context menu is suppressed by Radix ContextMenuTrigger.
 * `data-testid="editor-context-menu"` on the trigger wrapper.
 *
 * Props are intentionally minimal — the context (cursor position, word under
 * cursor) is read from the EditorView ref at the moment the menu opens.
 */
import { useCallback, useRef, useState } from 'react';
import { useAui } from '@assistant-ui/react';
import type { EditorView } from '@codemirror/view';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { LspProviders, LspLocation } from '@/lib/lsp';
import { buildReferenceForCm, writeToClipboard } from '@/lib/editor/copy-reference';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { jumpHistory } from '../lsp/navigation';
import { ReferencesPanel } from '../lsp/references-panel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorContextMenuProps {
  /** Absolute file path of the file currently open in the editor. */
  filePath: string;
  /** A ref to the live EditorView — read-only from this component. */
  viewRef: React.RefObject<EditorView | null>;
  /** LSP provider seam. Omit to disable LSP menu items. */
  providers?: LspProviders;
  /** LSP config (required when providers is set). */
  lspConfig?: { projectId: string; language: string; lspReady?: boolean };
  /** The editor content (React children passed straight through). */
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CursorContext {
  /** CM6 0-based line number. */
  line: number;
  /** 0-based character offset within the line. */
  character: number;
  /** Word under the cursor (may be undefined). */
  word: string | undefined;
}

function readCursorContext(view: EditorView): CursorContext {
  const sel = view.state.selection.main;
  const docLine = view.state.doc.lineAt(sel.head);
  const line = docLine.number - 1; // 0-based
  const character = sel.head - docLine.from;

  // Try to extract the word under the cursor using the editor's word-at-range.
  let word: string | undefined;
  try {
    const wordRange = view.state.wordAt(sel.head);
    if (wordRange) {
      word = view.state.sliceDoc(wordRange.from, wordRange.to);
    }
  } catch {
    // wordAt may throw in edge cases (empty doc) — silently ignore.
  }

  return { line, character, word };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EditorContextMenu({ filePath, viewRef, providers, lspConfig, children }: EditorContextMenuProps) {
  const aui = useAui();
  // References panel visibility state.
  const [references, setReferences] = useState<LspLocation[] | null>(null);
  const [refSymbol, setRefSymbol] = useState<string | undefined>(undefined);
  // Capture cursor context when the menu opens (Radix fires onOpenChange(true)).
  const cursorRef = useRef<CursorContext | null>(null);

  const handleMenuOpen = useCallback(
    (open: boolean) => {
      if (!open) return;
      const view = viewRef.current;
      if (!view) return;
      cursorRef.current = readCursorContext(view);
    },
    [viewRef],
  );

  // ── Copy Reference ────────────────────────────────────────────────────────

  const handleCopyReference = useCallback(async () => {
    const ctx = cursorRef.current;
    if (!ctx) return;
    const ref = buildReferenceForCm(filePath, ctx.line, ctx.word);
    await writeToClipboard(ref);
  }, [filePath]);

  // ── Add Agent Context ─────────────────────────────────────────────────────

  const handleAddAgentContext = useCallback(() => {
    const ctx = cursorRef.current;
    if (!ctx) return;
    // Build the same `path:line (word)` string the Copy Reference command uses.
    const ref = buildReferenceForCm(filePath, ctx.line, ctx.word);
    try {
      // assistant-ui 0.14.14: setQuote requires a messageId (selection-toolbar
      // path). The editor has no message origin, so we synthesize an empty
      // messageId — the composer only uses it for display/dismiss, not for send.
      aui.thread().composer().setQuote({ text: ref, messageId: '' });
    } catch (err) {
      // Composer may not be mounted (e.g. no active thread).
      console.warn('[editor-context-menu] setQuote failed — no active composer', err);
    }
  }, [filePath, aui]);

  // ── Go to Definition ──────────────────────────────────────────────────────

  const handleGoToDefinition = useCallback(async () => {
    const ctx = cursorRef.current;
    if (!ctx || !providers || !lspConfig?.lspReady) return;

    const position = { line: ctx.line, character: ctx.character };
    const fromEntry = { path: filePath, line: ctx.line, character: ctx.character };

    let locations: LspLocation[] = [];
    try {
      locations = await providers.getDefinition(lspConfig.projectId, lspConfig.language, {
        filePath,
        position,
      });
    } catch (err) {
      console.warn('[editor-context-menu] getDefinition failed', err);
      return;
    }

    const target = locations[0];
    if (!target) return;

    jumpHistory.push(fromEntry);
    const targetPath = target.uri.startsWith('file://') ? target.uri.slice('file://'.length) : target.uri;
    emitSurfaceIntent({ type: 'open-file', path: targetPath });
  }, [filePath, providers, lspConfig]);

  // ── Find All References ───────────────────────────────────────────────────

  const handleFindReferences = useCallback(async () => {
    const ctx = cursorRef.current;
    if (!ctx || !providers || !lspConfig?.lspReady) return;

    const position = { line: ctx.line, character: ctx.character };
    let locations: LspLocation[] = [];
    try {
      locations = await providers.getReferences(lspConfig.projectId, lspConfig.language, {
        filePath,
        position,
        includeDeclaration: true,
      });
    } catch (err) {
      console.warn('[editor-context-menu] getReferences failed', err);
      return;
    }

    setRefSymbol(ctx.word);
    setReferences(locations);
  }, [filePath, providers, lspConfig]);

  const lspAvailable = Boolean(providers && lspConfig?.lspReady);

  return (
    <>
      <ContextMenu onOpenChange={handleMenuOpen}>
        <ContextMenuTrigger data-testid="editor-context-menu" asChild>
          {/* children must accept a ref — it's the editor host div */}
          <div className="contents">{children}</div>
        </ContextMenuTrigger>

        <ContextMenuContent data-testid="editor-context-menu-content" className="min-w-[200px]">
          {/* Copy Reference */}
          <ContextMenuItem data-testid="editor-context-menu-copy-ref" onSelect={() => void handleCopyReference()}>
            Copy Reference
            <ContextMenuShortcut>⌘⇧C</ContextMenuShortcut>
          </ContextMenuItem>

          {/* Add Agent Context */}
          <ContextMenuItem data-testid="editor-context-menu-add-context" onSelect={handleAddAgentContext}>
            Add Agent Context
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Go to Definition */}
          <ContextMenuItem
            data-testid="editor-context-menu-go-to-def"
            onSelect={() => void handleGoToDefinition()}
            disabled={!lspAvailable}
          >
            Go to Definition
            <ContextMenuShortcut>⌘Click</ContextMenuShortcut>
          </ContextMenuItem>

          {/* Find All References */}
          <ContextMenuItem
            data-testid="editor-context-menu-find-refs"
            onSelect={() => void handleFindReferences()}
            disabled={!lspAvailable}
          >
            Find All References
            <ContextMenuShortcut>⌘⇧F12</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* References panel — rendered outside the context menu so it survives menu close. */}
      {references !== null && (
        <div className="absolute bottom-0 left-0 right-0 z-50 p-2">
          <ReferencesPanel locations={references} symbolName={refSymbol} onClose={() => setReferences(null)} />
        </div>
      )}
    </>
  );
}
