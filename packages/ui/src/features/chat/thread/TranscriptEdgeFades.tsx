/**
 * The plain list's top and bottom edge fades, as two gradient strips over the scroller instead of the
 * `scroll-fade-y` mask. A mask on a scroller that holds every row made WebKit re-composite the whole
 * content on each change: a streaming reply ran at 4 frames a second with 200 rows (130 frames in 10 s
 * against 486 without the mask). The strips are as tall as the content's vertical padding (1rem), so at
 * rest they cover no text, and rows pass under them as the reader scrolls.
 */
export function TranscriptEdgeFades() {
  return (
    <>
      <div
        aria-hidden
        data-testid="chat-thread-fade-top"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-linear-to-b from-background to-transparent"
      />
      <div
        aria-hidden
        data-testid="chat-thread-fade-bottom"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4 bg-linear-to-t from-background to-transparent"
      />
    </>
  );
}
