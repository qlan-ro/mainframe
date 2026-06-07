/**
 * FilterPill — shared pill button for the sidebar filter bars.
 *
 * Used by ProjectFilterPillBar (no swatch, optional attention badge) and reusable
 * by the tag filter bar (color swatch via bg-mf-tag-<color>). CSS-var tokens are
 * hex, so we NEVER use the `/opacity` modifier here — solid tokens only.
 */
import type { TagColor } from '@qlan-ro/mainframe-types';

export interface FilterPillProps {
  label: string;
  active: boolean;
  testId: string;
  onClick: () => void;
  badgeCount?: number;
  badgeTestId?: string;
  swatchColor?: TagColor;
}

export function FilterPill({
  label,
  active,
  testId,
  onClick,
  badgeCount = 0,
  badgeTestId,
  swatchColor,
}: FilterPillProps) {
  return (
    <button
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      type="button"
      className={[
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-caption font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      {swatchColor != null && (
        <span
          data-testid={`${testId}-swatch`}
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full bg-mf-tag-${swatchColor}`}
        />
      )}
      <span className="max-w-[140px] truncate">{label}</span>
      {badgeCount > 0 && badgeTestId != null && (
        <span
          data-testid={badgeTestId}
          className={[
            'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-micro font-bold leading-none',
            active ? 'bg-white text-primary opacity-90' : 'bg-primary text-white',
          ].join(' ')}
        >
          {badgeCount}
        </span>
      )}
    </button>
  );
}
