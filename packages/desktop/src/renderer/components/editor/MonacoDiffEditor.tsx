import React, { useRef, useLayoutEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import type * as monacoType from 'monaco-editor';
import { Send } from 'lucide-react';
import { InlineCommentWidget } from './InlineCommentWidget';
import { useInlineComments } from './useInlineComments';
import './setup';

interface MonacoDiffEditorProps {
  original: string;
  modified: string;
  language?: string;
  startLine?: number;
  onLineComment?: (startLine: number, endLine: number, lineContent: string, comment: string) => void;
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
  const onLineCommentRef = useRef(onLineComment);
  onLineCommentRef.current = onLineComment;

  const [changeViewZones, setChangeViewZones] = useState<
    ((cb: (a: monacoType.editor.IViewZoneChangeAccessor) => void) => void) | null
  >(null);
  const [getModel, setGetModel] = useState<(() => monacoType.editor.ITextModel | null) | null>(null);
  const { comments, openComment, closeComment, closeAll, updateText } = useInlineComments(changeViewZones, getModel);
  const openCommentRef = useRef(openComment);
  openCommentRef.current = openComment;

  const handleSubmitComment = useCallback(
    (id: string, start: number, end: number, lineContent: string, text: string) => {
      onLineCommentRef.current?.(start + lineOffset, end + lineOffset, lineContent, text);
      closeComment(id);
    },
    [closeComment, lineOffset],
  );

  const handleSubmitReview = useCallback(() => {
    for (const c of comments) {
      if (c.text.trim()) {
        onLineCommentRef.current?.(c.startLine + lineOffset, c.endLine + lineOffset, c.lineContent, c.text.trim());
      }
    }
    closeAll();
  }, [comments, closeAll, lineOffset]);

  const handleMount: DiffOnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      const inner = editor.getModifiedEditor();

      setChangeViewZones(() => (cb: (a: monacoType.editor.IViewZoneChangeAccessor) => void) => {
        inner.changeViewZones(cb);
      });
      setGetModel(() => () => inner.getModel());

      if (!onLineComment) return;

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
          openComment(inner);
        }
      });

      inner.addAction({
        id: 'mainframe.addComment',
        label: 'Add Comment',
        contextMenuGroupId: '0_ai',
        contextMenuOrder: 1,
        run: () => openCommentRef.current(inner),
      });
    },
    [onLineComment, openComment],
  );

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
            hideUnchangedRegions: { enabled: false },
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
        {comments.map((c) =>
          createPortal(
            <div key={c.id} data-testid="line-comment-widget" className="px-14 h-full">
              <InlineCommentWidget
                startLine={c.startLine + lineOffset}
                endLine={c.endLine + lineOffset}
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
