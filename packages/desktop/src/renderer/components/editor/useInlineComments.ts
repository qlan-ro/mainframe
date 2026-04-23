import { useRef, useCallback, useState, useEffect } from 'react';
import type * as monacoType from 'monaco-editor';

const MAX_PREVIEW_LINES = 50;

export interface CommentEntry {
  id: string;
  startLine: number;
  endLine: number;
  lineContent: string;
  zoneId: string;
  domNode: HTMLDivElement;
  text: string;
}

type ChangeViewZones = (cb: (accessor: monacoType.editor.IViewZoneChangeAccessor) => void) => void;
type GetModel = () => monacoType.editor.ITextModel | null;

let nextId = 0;

function extractContent(model: monacoType.editor.ITextModel, startLine: number, endLine: number): string {
  if (endLine - startLine + 1 > MAX_PREVIEW_LINES) return '';
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(model.getLineContent(i));
  }
  return lines.join('\n');
}

export function useInlineComments(changeViewZones: ChangeViewZones | null, getModel: GetModel | null) {
  const [comments, setComments] = useState<CommentEntry[]>([]);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  // Tracks per-comment layout listeners so they can be disposed on close.
  const layoutListenersRef = useRef<Map<string, monacoType.IDisposable>>(new Map());

  const openComment = useCallback(
    (editor: monacoType.editor.ICodeEditor, targetLine?: number) => {
      if (!changeViewZones || !getModel) return;
      const model = getModel();
      if (!model) return;

      const selection = editor.getSelection();
      let startLine: number;
      let endLine: number;

      if (selection && !selection.isEmpty()) {
        startLine = selection.startLineNumber;
        endLine = selection.endLineNumber;
      } else if (targetLine !== undefined) {
        startLine = targetLine;
        endLine = targetLine;
      } else {
        const pos = editor.getPosition();
        if (!pos) return;
        startLine = pos.lineNumber;
        endLine = pos.lineNumber;
      }

      const lineContent = extractContent(model, startLine, endLine);

      const domNode = document.createElement('div');
      domNode.style.zIndex = '10';
      domNode.style.overflow = 'hidden';
      domNode.style.boxSizing = 'border-box';

      // Pin the view-zone node width to the editor's content column so it never
      // inflates Monaco's scrollWidth and causes the horizontal scrollbar to diverge.
      const layoutInfo = editor.getLayoutInfo();
      domNode.style.width = `${layoutInfo.contentWidth}px`;
      const layoutListener = editor.onDidLayoutChange((info) => {
        domNode.style.width = `${info.contentWidth}px`;
      });

      let zoneId = '';
      changeViewZones((accessor) => {
        zoneId = accessor.addZone({
          afterLineNumber: endLine,
          heightInPx: 100,
          domNode,
        });
      });

      const id = `comment-${++nextId}`;
      layoutListenersRef.current.set(id, layoutListener);
      setComments((prev) => [...prev, { id, startLine, endLine, lineContent, zoneId, domNode, text: '' }]);
    },
    [changeViewZones, getModel],
  );

  const closeComment = useCallback(
    (id: string) => {
      const entry = commentsRef.current.find((c) => c.id === id);
      if (entry && changeViewZones) {
        changeViewZones((accessor) => accessor.removeZone(entry.zoneId));
      }
      layoutListenersRef.current.get(id)?.dispose();
      layoutListenersRef.current.delete(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    },
    [changeViewZones],
  );

  const closeAll = useCallback(() => {
    if (changeViewZones) {
      changeViewZones((accessor) => {
        for (const c of commentsRef.current) {
          accessor.removeZone(c.zoneId);
        }
      });
    }
    for (const listener of layoutListenersRef.current.values()) {
      listener.dispose();
    }
    layoutListenersRef.current.clear();
    setComments([]);
  }, [changeViewZones]);

  const updateText = useCallback((id: string, text: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }, []);

  useEffect(() => () => closeAll(), [closeAll]);

  return { comments, openComment, closeComment, closeAll, updateText };
}
