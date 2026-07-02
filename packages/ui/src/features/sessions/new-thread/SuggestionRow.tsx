/**
 * SuggestionRow — one repo-derived starting point. Icon tile tinted by kind
 * (accent = --primary; amber = --mf-warning) at ~8% fill, title + `source · detail`
 * meta, and a trailing "⏎ insert" that fades in on hover. Click pre-fills the
 * composer (never auto-sends).
 */
import { CornerDownLeft, icons as LUCIDE_ICONS } from 'lucide-react';
import type { Suggestion } from '@qlan-ro/mainframe-types';

/** Resolve a lucide icon by kebab name; falls back to a neutral glyph. */
function resolveIcon(name: string) {
  const pascal = name
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return (LUCIDE_ICONS as Record<string, typeof CornerDownLeft>)[pascal] ?? CornerDownLeft;
}

export function SuggestionRow({
  suggestion,
  index,
  onInsert,
}: {
  suggestion: Suggestion;
  index: number;
  onInsert: (prefill: string) => void;
}) {
  const Icon = resolveIcon(suggestion.icon);
  const tintVar = suggestion.tint === 'amber' ? 'var(--mf-warning)' : 'var(--primary)';
  return (
    <button
      type="button"
      data-testid={`sessions-welcome-suggestion-${index}`}
      onClick={() => onInsert(suggestion.prefill)}
      className="group flex w-full items-center gap-[10px] rounded-[8px] border border-border px-2.5 py-2 text-left transition-colors hover:bg-accent"
    >
      <span
        aria-hidden
        className="flex size-[26px] flex-shrink-0 items-center justify-center rounded-[7px]"
        style={{ color: tintVar, background: `color-mix(in srgb, ${tintVar} 8%, transparent)` }}
      >
        <Icon size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-foreground">{suggestion.title}</span>
        <span className="truncate text-micro text-mf-text-3">{suggestion.meta}</span>
      </span>
      <span
        data-testid={`sessions-welcome-suggestion-insert-${index}`}
        className="flex flex-shrink-0 items-center gap-1 text-micro text-mf-text-3 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <CornerDownLeft size={11} /> insert
      </span>
    </button>
  );
}
