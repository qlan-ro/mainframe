/**
 * useCommentPortals — open/close/registry for per-comment widget portals.
 *
 * Extracted from use-comment-gutter.tsx so the hook stays under the file-size
 * limit. A "portal" is one open (visible) comment card, rendered via
 * createPortal into the stable host <div> a CM6 block widget owns.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommentBlockWidget } from './comment-gutter';

export interface WidgetPortal {
  commentId: string;
  hostElement: HTMLDivElement;
}

export interface UseCommentPortalsResult {
  portalEntries: WidgetPortal[];
  portalsRef: React.RefObject<WidgetPortal[]>;
  setPortalEntries: React.Dispatch<React.SetStateAction<WidgetPortal[]>>;
  /** Open a portal into the block widget host for `commentId` (if not already open). */
  openPortalForWidget: (commentId: string, widget: CommentBlockWidget) => void;
  /** Close (unmount) a portal without deleting the comment data. */
  closePortal: (commentId: string) => void;
}

export function useCommentPortals(): UseCommentPortalsResult {
  const [portalEntries, setPortalEntries] = useState<WidgetPortal[]>([]);
  const portalsRef = useRef<WidgetPortal[]>([]);

  const openPortalForWidget = useCallback((commentId: string, widget: CommentBlockWidget) => {
    if (portalsRef.current.some((p) => p.commentId === commentId)) return;

    // Register a destroy callback on the widget so we clean up if CM6 removes it.
    widget.setDestroyCallback(() => {
      portalsRef.current = portalsRef.current.filter((p) => p.commentId !== commentId);
      setPortalEntries((prev) => prev.filter((p) => p.commentId !== commentId));
    });

    const entry: WidgetPortal = { commentId, hostElement: widget.hostElement };
    portalsRef.current = [...portalsRef.current, entry];
    setPortalEntries((prev) => [...prev, entry]);
  }, []);

  const closePortal = useCallback((commentId: string) => {
    portalsRef.current = portalsRef.current.filter((p) => p.commentId !== commentId);
    setPortalEntries((prev) => prev.filter((p) => p.commentId !== commentId));
  }, []);

  useEffect(() => {
    return () => {
      portalsRef.current = [];
    };
  }, []);

  return { portalEntries, portalsRef, setPortalEntries, openPortalForWidget, closePortal };
}
