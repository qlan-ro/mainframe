import React, { useRef, useLayoutEffect, useCallback, useState } from 'react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import type * as monacoType from 'monaco-editor';
import { InlineCommentWidget, type InlineCommentState } from './InlineCommentWidget';
import './setup';

interface MonacoDiffEditorProps {
  original: string;
  modified: string;
  language?: string;
  startLine?: number;
  onLineComment?: (line: number, lineContent: string, comment: string) => void;
}

export function MonacoDiffEditor({
  original,
  modified,
  language,
  startLine,
  onLineComment,
}: MonacoDiffEditorProps): React.ReactElement {
  const lineOffset = startLine && startLine > 1 ? startLine - 1 : 0;
  const editorRef = useRef<monacoType.editor.IStandaloneDiffEditor | null>(null);
  const decorationsRef = useRef<monacoType.editor.IEditorDecorationsCollection | null>(null);
  const zoneIdRef = useRef<string | null>(null);
  const [inlineComment, setInlineComment] = useState<InlineCommentState | null>(null);
  const onLineCommentRef = useRef(onLineComment);
  onLineCommentRef.current = onLineComment;

  const closeInlineComment = useCallback(() => {
    const diffEditor = editorRef.current;
    const id = zoneIdRef.current;
    if (diffEditor && id) {
      const inner = diffEditor.getModifiedEditor();
      inner.changeViewZones((accessor) => accessor.removeZone(id));
    }
    zoneIdRef.current = null;
    setInlineComment(null);
  }, []);

  const handleMount: DiffOnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      if (!onLineComment) return;

      const inner = editor.getModifiedEditor();
      decorationsRef.current = inner.createDecorationsCollection([]);

      inner.onMouseMove((e) => {
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

      inner.onMouseLeave(() => {
        decorationsRef.current?.set([]);
      });

      inner.onMouseDown((e) => {
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const lineNumber = e.target.position?.lineNumber;
          if (lineNumber) {
            const model = inner.getModel();
            const lineContent = model?.getLineContent(lineNumber) ?? '';

            closeInlineComment();

            const pos = inner.getScrolledVisiblePosition({ lineNumber, column: 1 });
            if (!pos) return;

            const domNode = document.createElement('div');
            inner.changeViewZones((accessor) => {
              zoneIdRef.current = accessor.addZone({
                afterLineNumber: lineNumber,
                heightInPx: 120,
                domNode,
              });
            });

            setInlineComment({
              line: lineNumber,
              lineContent,
              top: pos.top + pos.height,
            });
          }
        }
      });

      inner.onDidScrollChange(() => {
        closeInlineComment();
      });
    },
    [onLineComment, closeInlineComment],
  );

  // The library's disposeEditor() disposes models BEFORE the editor widget,
  // triggering "TextModel got disposed before DiffEditorWidget model got reset".
  // Fix: tell the library to skip model disposal (keepCurrent*Model), and handle
  // it ourselves in the correct order via useLayoutEffect (runs before passive effects).
  useLayoutEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (editor) {
        const model = editor.getModel();
        editor.dispose();
        model?.original?.dispose();
        model?.modified?.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  return (
    <div className="h-full relative overflow-hidden">
      <DiffEditor
        height="100%"
        language={language}
        original={original}
        modified={modified}
        theme="mainframe-dark"
        onMount={handleMount}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        options={{
          readOnly: true,
          minimap: { enabled: false },
          lineNumbersMinChars: 5,
          lineDecorationsWidth: 4,
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineHeight: 20,
          fontFamily: "'JetBrains Mono', monospace",
          renderSideBySide: false,
          hideUnchangedRegions: { enabled: true },
          renderOverviewRuler: false,
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          glyphMargin: !!onLineComment,
          folding: false,
          renderIndicators: false,
          ignoreTrimWhitespace: true,
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          padding: { top: 4, bottom: 4 },
          ...(lineOffset > 0 ? { lineNumbers: (n: number) => String(n + lineOffset) } : {}),
        }}
      />
      {inlineComment && (
        <div className="absolute left-0 right-0 z-50 px-14" style={{ top: inlineComment.top }}>
          <InlineCommentWidget
            line={inlineComment.line + lineOffset}
            lineContent={inlineComment.lineContent}
            onSubmit={(comment) => {
              onLineCommentRef.current?.(inlineComment.line + lineOffset, inlineComment.lineContent, comment);
              closeInlineComment();
            }}
            onClose={closeInlineComment}
          />
        </div>
      )}
    </div>
  );
}
