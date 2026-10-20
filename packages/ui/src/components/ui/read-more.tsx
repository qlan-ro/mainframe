/**
 * App-owned primitive on v2 tokens. `components/ui/` is no longer a v1 mirror of
 * the shadcn registry (the stock primitives live beside it in this same dir
 * since the 2026-08-09 v2 fold). What lives
 * here has no registry counterpart and is ours to shape.
 *
 * ReadMore — shared "Read more / Show less" clamp primitive.
 *
 * Clamping strategy: character-length heuristic against `measureText`
 * (jsdom has no layout engine to measure rendered line height), so callers
 * pass the plain-text length source separately from the rendered `children`.
 * A `ui/` primitive — must not import from `features/`.
 */
import { type ReactNode, type CSSProperties, type HTMLAttributes } from 'react';
import { useRetainedValue } from './disclosure-state';
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
  /**
   * Extra props spread onto the content div, before `data-clamp`/`className`/`style`
   * (so those still win on conflict). Lets feature callers attach their own DOM
   * anchors (e.g. `data-text-part` for in-chat Find) without ReadMore itself
   * hardcoding a features-specific attribute.
   */
  contentProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string>;
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
  contentProps,
}: ReadMoreProps) {
  const [expanded, setExpanded] = useRetainedValue(`read-more:${testId}`, false);
  const needsToggle = measureText.length > threshold;
  const collapsed = needsToggle && !expanded;

  const clampStyle: CSSProperties | undefined = collapsed
    ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: clampLines, overflow: 'hidden' }
    : undefined;

  return (
    <div className={cn('relative flex flex-col gap-[5px]', className)}>
      <div {...contentProps} data-clamp={needsToggle ? '' : undefined} className={contentClassName} style={clampStyle}>
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
        <ReadMoreToggle expanded={expanded} testId={testId} onToggle={() => setExpanded((value) => !value)} />
      )}
    </div>
  );
}

function ReadMoreToggle({ expanded, testId, onToggle }: { expanded: boolean; testId: string; onToggle: () => void }) {
  return (
    <button
      data-testid={testId}
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
      aria-label={expanded ? 'Show less' : 'Read more'}
      aria-expanded={expanded}
    >
      {expanded ? 'Show less' : 'Read more'}
      {expanded ? (
        <ChevronsUpDown size={12} className="text-primary" />
      ) : (
        <ChevronDown size={12} className="text-primary" />
      )}
    </button>
  );
}
