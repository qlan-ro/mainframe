import React, { useRef, useCallback, useState, useEffect } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as monacoType from 'monaco-editor';
import { InlineCommentWidget, type InlineCommentState } from './InlineCommentWidget';
import './setup';
import { registerDefinitionProvider } from './navigation';

interface MonacoEditorProps {
  value: string;
  language?: string;
  readOnly?: boolean;
  filePath?: string;
  onChange?: (value: string | undefined) => void;
  onLineComment?: (line: number, lineContent: string, comment: string) => void;
}

export function MonacoEditor({
  value,
  language,
  readOnly = true,
  filePath,
  onChange,
  onLineComment,
}: MonacoEditorProps): React.ReactElement {
  const decorationsRef = useRef<monacoType.editor.IEditorDecorationsCollection | null>(null);
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const zoneIdRef = useRef<string | null>(null);
  const [inlineComment, setInlineComment] = useState<InlineCommentState | null>(null);
  const onLineCommentRef = useRef(onLineComment);
  onLineCommentRef.current = onLineComment;

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

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

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
        // Cmd+Click on line content
        if (e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT && e.event.metaKey) {
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
