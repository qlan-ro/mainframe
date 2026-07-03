/**
 * ReadMore — shared "Read more / Show less" clamp primitive.
 *
 * Clamping strategy: character-length heuristic against `measureText`
 * (jsdom has no layout engine to measure rendered line height), so callers
 * pass the plain-text length source separately from the rendered `children`.
 * A `ui/` primitive — must not import from `features/`.
 */
import { useState, type ReactNode, type CSSProperties } from 'react';
import { ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReadMoreProps {
  children: ReactNode;
  /** Plain-text length source for the clamp heuristic (jsdom has no layout engine). */
  measureText: string;
  threshold?: number;
  clampLines?: number;
  /** CSS color for the fade end-stop; omit for no fade. */
  fadeColor?: string;
  fadeOffsetClass?: string;
  contentClassName?: string;
  className?: string;
  testId: string;
}

export function ReadMore({
  children,
  measureText,
  threshold = 600,
  clampLines = 4,
  fadeColor,
  fadeOffsetClass = 'bottom-6',
  contentClassName,
  className,
  testId,
}: ReadMoreProps) {
  const [expanded, setExpanded] = useState(false);
  const needsToggle = measureText.length > threshold;
  const collapsed = needsToggle && !expanded;

  const clampStyle: CSSProperties | undefined = collapsed
    ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: clampLines, overflow: 'hidden' }
    : undefined;

  return (
    <div className={cn('relative flex flex-col gap-[5px]', className)}>
      <div data-clamp={needsToggle ? '' : undefined} className={contentClassName} style={clampStyle}>
        {children}
      </div>

      {collapsed && fadeColor && (
        <div
          aria-hidden
          className={cn('pointer-events-none absolute left-0 right-0 h-8', fadeOffsetClass)}
          style={{ background: `linear-gradient(to bottom, transparent, ${fadeColor})` }}
        />
      )}

      {needsToggle && (
        <button
          data-testid={testId}
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="inline-flex items-center gap-2 text-caption font-semibold text-primary hover:underline"
          aria-label={expanded ? 'Show less' : 'Read more'}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Read more'}
          {expanded ? (
            <ChevronsUpDown size={10} className="text-primary" />
          ) : (
            <ChevronDown size={10} className="text-primary" />
          )}
        </button>
      )}
    </div>
  );
}
