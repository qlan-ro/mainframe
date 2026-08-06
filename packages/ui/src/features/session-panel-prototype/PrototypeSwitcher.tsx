/**
 * THROWAWAY PROTOTYPE — the variant switcher. Deliberately foreign chrome: an
 * inverted pill (`bg-foreground text-background`, the tooltip's own inversion)
 * so it never reads as part of the design under test. Hand-rolled rather than
 * built from `Button`, because every variant of that primitive is tuned to
 * blend into the app — which is the opposite of what this needs.
 */
import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PrototypeSwitcherProps {
  label: string;
  onCycle: (delta: 1 | -1) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function PrototypeSwitcher({ label, onCycle }: PrototypeSwitcherProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      onCycle(event.key === 'ArrowRight' ? 1 : -1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCycle]);

  return (
    <div
      data-testid="proto-switcher"
      className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-1 py-1 text-background shadow-lg"
    >
      <button
        type="button"
        data-testid="proto-switcher-prev"
        aria-label="Previous variant"
        onClick={() => onCycle(-1)}
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
        onClick={() => onCycle(1)}
        className="flex size-6 items-center justify-center rounded-full transition-colors hover:bg-background/20"
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}
