import React, { useRef, useCallback, useState, useEffect } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as monacoType from 'monaco-editor';
import { InlineCommentWidget, type InlineCommentState } from './InlineCommentWidget';
import './setup';
import { registerDefinitionProvider } from './navigation';
import { useProjectsStore } from '../../store';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useTabsStore } from '../../store/tabs';

interface MonacoEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  filePath?: string;
  line?: number;
  column?: number;
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
  onChange,
  onLineComment,
}: MonacoEditorProps): React.ReactElement {
  const decorationsRef = useRef<monacoType.editor.IEditorDecorationsCollection | null>(null);
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const zoneIdRef = useRef<string | null>(null);
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
    setInlineComment(null);
  }, []);

  useEffect(() => () => closeInlineComment(), [closeInlineComment]);

  // Scroll to target position when navigating from references/definitions.
  useEffect(() => {
    if (!line || !editorRef.current) return;
    const editor = editorRef.current;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: column ?? 1 });
    // Focus so the caret is visible — this is an intentional navigation action.
    setTimeout(() => editor.focus(), 50);
  }, [line, column]);

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

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Scroll to target position on mount (from Go To Definition / References).
      if (lineRef.current) {
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

        // Get line position before adding the zone
        const pos = editor.getScrolledVisiblePosition({ lineNumber, column: 1 });
        if (!pos) return;

        // Empty ViewZone just for spacing (pushes lines down)
        const domNode = document.createElement('div');
        editor.changeViewZones((accessor) => {
          zoneIdRef.current = accessor.addZone({
            afterLineNumber: lineNumber,
            heightInPx: 120,
            domNode,
          });
        });

        setInlineComment({ line: lineNumber, lineContent, top: pos.top + pos.height });
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
      {inlineComment && (
        <div
          data-testid="line-comment-popover"
          className="absolute left-0 right-0 z-50 px-14"
          style={{ top: inlineComment.top }}
        >
          <InlineCommentWidget
            line={inlineComment.line}
            lineContent={inlineComment.lineContent}
            onSubmit={(comment) => {
              onLineCommentRef.current?.(inlineComment.line, inlineComment.lineContent, comment);
              closeInlineComment();
            }}
            onClose={closeInlineComment}
          />
        </div>
      )}
    </div>
  );
}
