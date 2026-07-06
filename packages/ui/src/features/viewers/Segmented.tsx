import type { ReactNode } from 'react';
import { Hint } from '@/components/ui/hint';

/**
 * Segmented — the small pill toggle reused across viewers (Preview/Source,
 * Fit/100%, Preview/Code). Mirrors the prototype `VSeg` in
 * docs/design-reference/prototype/15-viewers.jsx: an 8px-radius chip track
 * (p-0.5, gap-px) holding 18px-tall buttons (px-8, 6px radius); the active
 * segment is a raised white card with a 0.5px ring + soft shadow.
 *
 * Replaces the divergent per-viewer `SEG_BTN` constants so all three toggles
 * render identically.
 */
export interface SegmentedOption {
  id: string;
  label?: string;
  icon?: ReactNode;
  title?: string;
  testId?: string;
}

interface SegmentedProps {
  value: string;
  onChange: (id: string) => void;
  options: SegmentedOption[];
}

const SEG_ACTIVE = 'bg-background text-foreground shadow-[var(--mf-shadow-segment)]';
const SEG_IDLE = 'text-mf-text-3 hover:text-foreground';

export function Segmented({ value, onChange, options }: SegmentedProps) {
  return (
    <div className="inline-flex items-center gap-px rounded-[8px] bg-mf-chip p-0.5">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Hint key={o.id} label={o.title ?? o.label}>
            <button
              type="button"
              data-testid={o.testId}
              aria-pressed={active}
              onClick={() => onChange(o.id)}
              className={[
                'inline-flex h-[18px] items-center gap-[4px] rounded-sm px-[8px] text-caption font-medium transition-colors',
                active ? SEG_ACTIVE : SEG_IDLE,
              ].join(' ')}
            >
              {o.icon}
              {o.label}
            </button>
          </Hint>
        );
      })}
    </div>
  );
}
