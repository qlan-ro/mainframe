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
        className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-2 p-3 sm:max-w-2xl [@media(max-height:100px)]:max-h-dvh [@media(max-height:100px)]:grid-rows-[minmax(0,1fr)_auto] [@media(max-height:100px)]:gap-1 [@media(max-height:100px)]:p-1 [@media(max-height:100px)]:pr-10"
        closeButtonClassName="[@media(max-height:100px)]:top-1 [@media(max-height:100px)]:right-1"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogTitle className="pr-10 [@media(max-height:100px)]:sr-only">Read {part.name}</DialogTitle>
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
      const measurable = !!line && box.height > 0 && box.width > 0;
      setUnmeasurable(!measurable);
      if (measurable && line.top >= box.top && line.bottom <= box.bottom) {
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
        className="min-h-0 overflow-auto rounded focus-visible:focus-line-inset"
      >
        <pre ref={text} dir="ltr" className="stored-order font-mono wrap-anywhere whitespace-pre-wrap">
          {part.text}
        </pre>
      </div>
      {unmeasurable ? (
        <Button
          size="xs"
          onClick={() => {
            onRead();
            onClose();
          }}
        >
          {"I've read it"}
        </Button>
      ) : (
        reachedEnd && (
          <Button size="xs" onClick={onClose}>
            Done
          </Button>
        )
      )}
    </>
  );
}
