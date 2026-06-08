/**
 * FilterPill — shared pill button for the sidebar filter bars.
 *
 * Used by ProjectFilterPillBar (optional attention badge). Tag swatches live in
 * TagFilterBar's own TagPill, which paints inline via TAG_DOT_STYLE; this pill
 * carries no swatch.
 */
export interface FilterPillProps {
  label: string;
  active: boolean;
  testId: string;
  onClick: () => void;
  badgeCount?: number;
  badgeTestId?: string;
}

export function FilterPill({ label, active, testId, onClick, badgeCount = 0, badgeTestId }: FilterPillProps) {
  return (
    <button
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      type="button"
      className={[
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[11px] px-2.5 text-caption font-medium tracking-normal transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      <span className="max-w-[140px] truncate">{label}</span>
      {badgeCount > 0 && badgeTestId != null && (
        <span
          data-testid={badgeTestId}
          className={[
            'inline-flex h-4 min-w-4 items-center justify-center rounded-lg px-1 text-micro font-bold leading-none text-white',
            active ? 'bg-white/25' : 'bg-primary',
          ].join(' ')}
        >
          {badgeCount}
        </span>
      )}
    </button>
  );
}
