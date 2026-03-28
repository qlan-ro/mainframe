import { useRef, useCallback, useState, useEffect } from 'react';
import type * as monacoType from 'monaco-editor';

export interface CommentEntry {
  id: string;
  line: number;
  lineContent: string;
  zoneId: string;
  domNode: HTMLDivElement;
  text: string;
}

type ChangeViewZones = (cb: (accessor: monacoType.editor.IViewZoneChangeAccessor) => void) => void;

let nextId = 0;

export function useInlineComments(changeViewZones: ChangeViewZones | null) {
  const [comments, setComments] = useState<CommentEntry[]>([]);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const openComment = useCallback(
    (lineNumber: number, lineContent: string) => {
      if (!changeViewZones) return;

      const domNode = document.createElement('div');
      domNode.style.zIndex = '10';

      let zoneId = '';
      changeViewZones((accessor) => {
        zoneId = accessor.addZone({
          afterLineNumber: lineNumber,
          heightInPx: 120,
          domNode,
        });
      });

      const id = `comment-${++nextId}`;
      setComments((prev) => [...prev, { id, line: lineNumber, lineContent, zoneId, domNode, text: '' }]);
    },
    [changeViewZones],
  );

  const closeComment = useCallback(
    (id: string) => {
      const entry = commentsRef.current.find((c) => c.id === id);
      if (entry && changeViewZones) {
        changeViewZones((accessor) => accessor.removeZone(entry.zoneId));
      }
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
    setComments([]);
  }, [changeViewZones]);

  const updateText = useCallback((id: string, text: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }, []);

  useEffect(() => () => closeAll(), [closeAll]);

  return { comments, openComment, closeComment, closeAll, updateText };
}
