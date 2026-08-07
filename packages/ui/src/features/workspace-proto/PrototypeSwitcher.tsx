/**
 * THROWAWAY PROTOTYPE — the variant switcher, lifted from proto/session-panel.
 * Deliberately foreign chrome: an inverted pill (`bg-foreground text-background`)
 * so it never reads as part of the design under test.
 */
import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WS_PROTO_VARIANTS, useWsProto } from './proto-store';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function PrototypeSwitcher() {
  const variant = useWsProto((s) => s.variant);
  const cycle = useWsProto((s) => s.cycle);
  const label = WS_PROTO_VARIANTS.find((v) => v.id === variant)?.label ?? variant;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      cycle(event.key === 'ArrowRight' ? 1 : -1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cycle]);

  return (
    <div
      data-testid="proto-switcher"
      className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-1 py-1 text-background shadow-lg"
    >
      <button
        type="button"
        data-testid="proto-switcher-prev"
        aria-label="Previous variant"
        onClick={() => cycle(-1)}
        className="flex size-6 items-center justify-center rounded-full transition-colors hover:bg-background/20"
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <span data-testid="proto-switcher-label" className="px-1.5 text-xs font-semibold whitespace-nowrap">
        {label}
      </span>
      <button
        type="button"
        data-testid="proto-switcher-next"
        aria-label="Next variant"
        onClick={() => cycle(1)}
        className="flex size-6 items-center justify-center rounded-full transition-colors hover:bg-background/20"
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}
