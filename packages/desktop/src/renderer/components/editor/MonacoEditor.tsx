import React, { useRef, useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as monacoType from 'monaco-editor';
import { Send } from 'lucide-react';
import { InlineCommentWidget } from './InlineCommentWidget';
import { useInlineComments } from './useInlineComments';
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
  viewState?: unknown;
  cursorLine?: number;
  cursorColumn?: number;
  onChange?: (value: string | undefined) => void;
  onLineComment?: (startLine: number, endLine: number, lineContent: string, comment: string) => void;
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
  const onLineCommentRef = useRef(onLineComment);
  onLineCommentRef.current = onLineComment;

  const [changeViewZones, setChangeViewZones] = useState<
    ((cb: (a: monacoType.editor.IViewZoneChangeAccessor) => void) => void) | null
  >(null);
  const [getModel, setGetModel] = useState<(() => monacoType.editor.ITextModel | null) | null>(null);
  const { comments, openComment, closeComment, closeAll, updateText } = useInlineComments(changeViewZones, getModel);

  const activeProjectId = useActiveProjectId();
  const { projects } = useProjectsStore();
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const activeProjectRef = useRef(activeProject);
  activeProjectRef.current = activeProject;

  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const cursorLineRef = useRef(cursorLine);
  cursorLineRef.current = cursorLine;
  const cursorColumnRef = useRef(cursorColumn);
  cursorColumnRef.current = cursorColumn;
  const lineRef = useRef(line);
  lineRef.current = line;
  const columnRef = useRef(column);
  columnRef.current = column;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (viewState) {
      editor.restoreViewState(viewState as monacoType.editor.ICodeEditorViewState);
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

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (model.getValue() !== value) {
      model.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    return () => clearEditorViewState();
  }, []);

  const handleSubmitComment = useCallback(
    (id: string, start: number, end: number, lineContent: string, text: string) => {
      onLineCommentRef.current?.(start, end, lineContent, text);
      closeComment(id);
    },
    [closeComment],
  );

  const handleSubmitReview = useCallback(() => {
    for (const c of comments) {
      if (c.text.trim()) {
        onLineCommentRef.current?.(c.startLine, c.endLine, c.lineContent, c.text.trim());
      }
    }
    closeAll();
  }, [comments, closeAll]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      setChangeViewZones(() => (cb: (a: monacoType.editor.IViewZoneChangeAccessor) => void) => {
        editor.changeViewZones(cb);
      });
      setGetModel(() => () => editor.getModel());

      const snapshotViewState = () => updateEditorViewState(editor.saveViewState());
      snapshotViewState();
      editor.onDidScrollChange(snapshotViewState);
      editor.onDidChangeCursorPosition((e) => {
        snapshotViewState();
        updateCursorPosition({ line: e.position.lineNumber, column: e.position.column });
      });
      const pos = editor.getPosition();
      if (pos) updateCursorPosition({ line: pos.lineNumber, column: pos.column });

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

      editor.onMouseDown((e) => {
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          openComment(editor);
        }
      });
    },
    [filePath, language, onLineComment, openComment],
  );

  const hasComments = comments.length > 0;
  const hasNonEmpty = comments.some((c) => c.text.trim());

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {hasComments && (
        <div className="flex items-center justify-end px-3 py-1 shrink-0 border-b border-mf-divider">
          <button
            onClick={handleSubmitReview}
            disabled={!hasNonEmpty}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-mf-small font-medium text-mf-accent hover:bg-mf-accent/10 disabled:opacity-30 transition-colors"
          >
            <Send size={12} />
            Submit review ({comments.length})
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
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
        {comments.map((c) =>
          createPortal(
            <div key={c.id} data-testid="line-comment-widget" className="px-14 h-full">
              <InlineCommentWidget
                startLine={c.startLine}
                endLine={c.endLine}
                lineContent={c.lineContent}
                text={c.text}
                onTextChange={(t) => updateText(c.id, t)}
                onSubmit={() => handleSubmitComment(c.id, c.startLine, c.endLine, c.lineContent, c.text.trim())}
                onClose={() => closeComment(c.id)}
              />
            </div>,
            c.domNode,
          ),
        )}
      </div>
    </div>
  );
}
