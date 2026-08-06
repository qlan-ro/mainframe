/**
 * ComposerSegments — the stack of committed quote+prose boxes plus the
 * pending live-quote pill, mounted above the native composer input (spec
 * §2.2, 280-A3/A5). The live segment's prose is never rendered here — it
 * lives only in `ComposerPrimitive.Input`, outside this component.
 *
 * Focus-on-append: `ComposerPrimitive.Input` does not forward a ref on the
 * installed assistant-ui version, so the effect below scopes a
 * `querySelector` to the enclosing `chat-composer` root — the whole composer,
 * so inserting a wrapper between the segments block and the input can't break
 * it, and never a second composer (edit mode renders its own input testid).
 */
import { useEffect, useRef } from 'react';
import { useComposerSegments } from './segment-store';
import { SegmentQuotePill } from './SegmentQuotePill';

const EMPTY_COMPOSITION = { committed: [], liveQuote: null } as const;

/**
 * A committed segment's prose box. Plain textarea semantics on purpose (spec
 * §2.2 Decision 9): no `ComposerHighlight` overlay and no `@`/`/` triggers —
 * those are wired to the single native `ComposerPrimitive.Input` — and Enter
 * inserts a newline here where the identical-looking box below sends.
 */
function ComposerSegmentTextarea({
  segmentId,
  value,
  placeholder,
  onChange,
}: {
  segmentId: string;
  value: string;
  placeholder: string;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 22)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      data-testid="composer-segment-input"
      data-segment-id={segmentId}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className="w-full resize-none overflow-hidden bg-transparent px-3 py-1.5 font-sans text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
    />
  );
}

export function ComposerSegments({ threadId }: { threadId: string }) {
  const composition = useComposerSegments((s) => s.byThread[threadId]) ?? EMPTY_COMPOSITION;
  const dismiss = useComposerSegments((s) => s.dismiss);
  const updateText = useComposerSegments((s) => s.updateText);
  const liveQuoteId = composition.liveQuote?.id;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!liveQuoteId) return;
    containerRef.current
      ?.closest('[data-testid="chat-composer"]')
      ?.querySelector<HTMLTextAreaElement>('[data-testid="chat-composer-input"]')
      ?.focus();
  }, [liveQuoteId]);

  if (composition.committed.length === 0 && !composition.liveQuote) return null;

  return (
    <div data-testid="composer-segments" ref={containerRef}>
      {composition.committed.map((segment) => (
        <div key={segment.id} data-testid="composer-segment" data-segment-id={segment.id}>
          {segment.quote != null && (
            <SegmentQuotePill
              segmentId={segment.id}
              quote={segment.quote}
              onDismiss={() => dismiss(threadId, segment.id)}
            />
          )}
          <ComposerSegmentTextarea
            segmentId={segment.id}
            value={segment.text}
            placeholder={segment.quote != null ? 'Add a message…' : 'Reply to Mainframe…'}
            onChange={(text) => updateText(threadId, segment.id, text)}
          />
        </div>
      ))}
      {composition.liveQuote && (
        <SegmentQuotePill
          segmentId={composition.liveQuote.id}
          quote={composition.liveQuote.text}
          onDismiss={() => dismiss(threadId, composition.liveQuote!.id)}
        />
      )}
    </div>
  );
}
