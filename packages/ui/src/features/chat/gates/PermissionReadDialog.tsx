import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { lastLine, type AllowedPart } from './use-shown-to-end';

export function PermissionReadDialog({
  part,
  onRead,
  onClose,
}: {
  part: AllowedPart;
  onRead: () => void;
  onClose: () => void;
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
        className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-2 p-3 sm:max-w-2xl"
      >
        <DialogTitle className="pr-10">Read {part.name}</DialogTitle>
        <ReadBody part={part} onRead={onRead} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function ReadBody({ part, onRead, onClose }: { part: AllowedPart; onRead: () => void; onClose: () => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLPreElement>(null);
  const [unmeasurable, setUnmeasurable] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
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
      setUnmeasurable(box.height === 0 || box.width === 0);
      if (line && box.height > 0 && line.top >= box.top && line.bottom <= box.bottom) {
        setReachedEnd(true);
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
  }, []);

  return (
    <>
      <div
        ref={scroll}
        tabIndex={0}
        aria-label={part.name}
        className="min-h-0 overflow-auto rounded focus-visible:focus-line-inset"
      >
        <pre ref={text} dir="ltr" className="stored-order font-mono wrap-anywhere whitespace-pre-wrap">
          {part.text}
        </pre>
      </div>
      {unmeasurable ? (
        <Button
          onClick={() => {
            onRead();
            onClose();
          }}
        >
          {"I've read it"}
        </Button>
      ) : (
        reachedEnd && <Button onClick={onClose}>Done</Button>
      )}
    </>
  );
}
