import React, { useRef, useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as monacoType from 'monaco-editor';
import { InlineCommentWidget, type InlineCommentState } from './InlineCommentWidget';
import './setup';
import { registerDefinitionProvider } from './navigation';
import { useProjectsStore } from '../../store';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useTabsStore } from '../../store/tabs';
import { updateEditorViewState, updateCursorPosition, clearEditorViewState } from './editor-state';

interface MonacoEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  filePath?: string;
  line?: number;
  column?: number;
  /** Opaque Monaco view state for restoring scroll + folds. */
  viewState?: unknown;
  /** Cursor position tracked separately — applied after viewState restore. */
  cursorLine?: number;
  cursorColumn?: number;
  onChange?: (value: string | undefined) => void;
  onLineComment?: (line: number, lineContent: string, comment: string) => void;
}

export function MonacoEditor({
  value,
  language,
  readOnly = true,
  filePath,
  line,
  column,
  viewState,
  cursorLine,
  cursorColumn,
  onChange,
  onLineComment,
}: MonacoEditorProps): React.ReactElement {
  const decorationsRef = useRef<monacoType.editor.IEditorDecorationsCollection | null>(null);
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const zoneIdRef = useRef<string | null>(null);
  const zoneDomRef = useRef<HTMLDivElement | null>(null);
  const [inlineComment, setInlineComment] = useState<InlineCommentState | null>(null);
  const onLineCommentRef = useRef(onLineComment);
  onLineCommentRef.current = onLineComment;

  const activeProjectId = useActiveProjectId();
  const { projects } = useProjectsStore();
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const activeProjectRef = useRef(activeProject);
  activeProjectRef.current = activeProject;

  const closeInlineComment = useCallback(() => {
    const editor = editorRef.current;
    const id = zoneIdRef.current;
    if (editor && id) {
      editor.changeViewZones((accessor) => accessor.removeZone(id));
    }
    zoneIdRef.current = null;
    zoneDomRef.current = null;
    setInlineComment(null);
  }, []);

  useEffect(() => () => closeInlineComment(), [closeInlineComment]);

  // Restore view state (scroll + folds) then override cursor position.
  // Falls back to line/column positioning for non-view-state navigation (e.g. file tree).
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const cursorLineRef = useRef(cursorLine);
  cursorLineRef.current = cursorLine;
  const cursorColumnRef = useRef(cursorColumn);
  cursorColumnRef.current = cursorColumn;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (viewState) {
      editor.restoreViewState(viewState as monacoType.editor.ICodeEditorViewState);
      // Override cursor — viewState's cursor is the click target, not where user was.
      if (cursorLine) {
        editor.setPosition({ lineNumber: cursorLine, column: cursorColumn ?? 1 });
      }
      setTimeout(() => editor.focus(), 50);
    } else if (line) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: column ?? 1 });
      setTimeout(() => editor.focus(), 50);
    }
  }, [viewState, cursorLine, cursorColumn, line, column]);

  // Sync external value changes into the Monaco model (e.g. agent edits).
  // The `path` prop makes @monaco-editor/react ignore `value` after initial mount.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (model.getValue() !== value) {
      model.setValue(value);
    }
  }, [value]);

  const lineRef = useRef(line);
  lineRef.current = line;
  const columnRef = useRef(column);
  columnRef.current = column;

  // Clear view state tracking on unmount.
  useEffect(() => {
    return () => clearEditorViewState();
  }, []);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Track view state (scroll + folds) and cursor position separately.
      const snapshotViewState = () => updateEditorViewState(editor.saveViewState());
      snapshotViewState();
      editor.onDidScrollChange(snapshotViewState);
      editor.onDidChangeCursorPosition((e) => {
        snapshotViewState();
        updateCursorPosition({ line: e.position.lineNumber, column: e.position.column });
      });
      // Seed cursor position
      const pos = editor.getPosition();
      if (pos) updateCursorPosition({ line: pos.lineNumber, column: pos.column });

      // Restore view state + cursor override, or fall back to line/column on mount.
      if (viewStateRef.current) {
        editor.restoreViewState(viewStateRef.current as monacoType.editor.ICodeEditorViewState);
        if (cursorLineRef.current) {
          editor.setPosition({ lineNumber: cursorLineRef.current, column: cursorColumnRef.current ?? 1 });
        }
        setTimeout(() => editor.focus(), 50);
      } else if (lineRef.current) {
        editor.revealLineInCenter(lineRef.current);
        editor.setPosition({ lineNumber: lineRef.current, column: columnRef.current ?? 1 });
        setTimeout(() => editor.focus(), 50);
      }

      // Cmd+Option+Left / Cmd+Option+Right for back/forward navigation.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow, () => {
        useTabsStore.getState().navigateBack();
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.RightArrow, () => {
        useTabsStore.getState().navigateForward();
      });

      if (filePath && language) {
        registerDefinitionProvider(monaco, language, filePath);
      }

      if (!onLineComment) return;

      decorationsRef.current = editor.createDecorationsCollection([]);

      editor.onMouseMove((e) => {
        const collection = decorationsRef.current;
        if (!collection) return;
        if (
          e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
          e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
        ) {
          const lineNumber = e.target.position?.lineNumber;
          if (lineNumber) {
            collection.set([
              {
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: { glyphMarginClassName: 'mf-line-comment-glyph' },
              },
            ]);
            return;
          }
        }
        collection.set([]);
      });

      editor.onMouseLeave(() => {
        decorationsRef.current?.set([]);
      });

      const openCommentAtLine = (lineNumber: number) => {
        const model = editor.getModel();
        const lineContent = model?.getLineContent(lineNumber) ?? '';

        closeInlineComment();

        const domNode = document.createElement('div');
        domNode.style.zIndex = '10';
        editor.changeViewZones((accessor) => {
          zoneIdRef.current = accessor.addZone({
            afterLineNumber: lineNumber,
            heightInPx: 120,
            domNode,
          });
        });

        zoneDomRef.current = domNode;
        setInlineComment({ line: lineNumber, lineContent });
      };

      editor.onMouseDown((e) => {
        const lineNumber = e.target.position?.lineNumber;
        if (!lineNumber) return;

        // Glyph margin click (hover icon)
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          openCommentAtLine(lineNumber);
        }
      });

      editor.onDidScrollChange(() => {
        closeInlineComment();
      });
    },
    [filePath, language, onLineComment, closeInlineComment],
  );

  return (
    <div className="h-full relative overflow-hidden">
      <Editor
        height="100%"
        language={language}
        value={value}
        path={activeProject && filePath ? `file://${activeProject.path}/${filePath}` : filePath}
        onChange={onChange}
        theme="mainframe-dark"
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: 'on',
          lineNumbersMinChars: 3,
          lineDecorationsWidth: 0,
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', monospace",
          renderWhitespace: 'none',
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          padding: { top: 8 },
          glyphMargin: !!onLineComment,
          stickyScroll: { enabled: true },
          cursorBlinking: 'smooth',
          renderLineHighlight: 'gutter',
        }}
      />
      {inlineComment &&
        zoneDomRef.current &&
        createPortal(
          <div data-testid="line-comment-widget" className="px-14 h-full">
            <InlineCommentWidget
              line={inlineComment.line}
              lineContent={inlineComment.lineContent}
              onSubmit={(comment) => {
                onLineCommentRef.current?.(inlineComment.line, inlineComment.lineContent, comment);
                closeInlineComment();
              }}
              onClose={closeInlineComment}
            />
          </div>,
          zoneDomRef.current,
        )}
    </div>
  );
}
