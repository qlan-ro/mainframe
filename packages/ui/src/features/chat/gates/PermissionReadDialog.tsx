import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { lastLine, type AllowedPart } from './use-shown-to-end';

export function PermissionReadDialog({
  part,
  onRead,
  onClose,
  onRestoreFocus,
}: {
  part: AllowedPart;
  onRead: () => void;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(64px,1fr)_auto] gap-2 p-3 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogTitle className="max-h-[25dvh] overflow-auto wrap-anywhere pr-10">Read {part.name}</DialogTitle>
        <ReadBody part={part} onRead={onRead} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function useReadProgress(partText: string, onRead: () => void) {
  const scroll = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLPreElement>(null);
  const [unmeasurable, setUnmeasurable] = useState(false);
  const [readText, setReadText] = useState<string>();
  const onReadRef = useRef(onRead);

  useLayoutEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  useLayoutEffect(() => {
    const viewport = scroll.current;
    const content = text.current;
    if (!viewport || !content) return;
    const measure = () => {
      const box = viewport.getBoundingClientRect();
      const line = lastLine(content);
      const laidOut = viewport.getClientRects().length > 0;
      setUnmeasurable(!laidOut);
      if (laidOut && line && line.top >= box.top && line.bottom <= box.bottom) {
        setReadText(partText);
        onReadRef.current();
      }
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(content);
    viewport.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      viewport.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [partText]);

  return { scroll, text, unmeasurable, reachedEnd: readText === partText };
}

function ReadBody({ part, onRead, onClose }: { part: AllowedPart; onRead: () => void; onClose: () => void }) {
  const { scroll, text, unmeasurable, reachedEnd } = useReadProgress(part.text, onRead);
  return (
    <>
      <div
        ref={scroll}
        tabIndex={0}
        role="region"
        aria-label={part.name}
        className="min-h-16 overflow-auto rounded focus-visible:focus-line-inset"
      >
        <pre ref={text} dir="ltr" className="stored-order font-mono wrap-anywhere whitespace-pre-wrap">
          {part.text}
        </pre>
      </div>
      <div className="flex min-h-6 justify-end">
        {unmeasurable ? (
          <Button
            size="xs"
            onClick={() => {
              if (scroll.current?.getClientRects().length !== 0) return;
              onRead();
              onClose();
            }}
          >
            {"I've read it"}
          </Button>
        ) : (
          <Button size="xs" disabled={!reachedEnd} onClick={onClose}>
            Done
          </Button>
        )}
      </div>
    </>
  );
}
