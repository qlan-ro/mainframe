/**
 * A sidebar section whose header parks at an edge of the scroll region until its
 * content scrolls into view, and jumps to that content when clicked.
 *
 * This is the whole reason the panel can scroll as one unit: the sections around
 * the session list would otherwise be unreachable behind hundreds of rows — the
 * list's own controls at the top edge, Tasks and Tags at the bottom.
 *
 * Header and content are SIBLINGS, not a wrapped group — a sticky element can
 * never be lifted above its own containing block, so a per-section wrapper would
 * pin each header inside a box that starts below the fold and it would never
 * park at all. Flat, their containing block is the whole scroll content.
 *
 * The label no longer collapses its section — with one scroller a collapse only
 * shortens the scroll, and the jump is the affordance that earns the click.
 */
import { useRef, type ReactNode } from 'react';
import { SidebarGroupLabel } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

/** The parked header's own height, in px — what a jump has to clear. */
export const JUMP_HEADER_HEIGHT = 32;

interface SidebarJumpSectionProps {
  label: string;
  /** Root testid; the jump control takes `<testId>-jump`. */
  testId: string;
  /**
   * Where the header parks — `top-0`, or an offset from the bottom. Sections
   * stack inward from their edge, so the outermost takes 0 and each one behind
   * it clears the ones in front.
   */
  sticky: string;
  /** Controls that belong to this section, kept reachable with the header. */
  actions?: ReactNode;
  children: ReactNode;
}

export function SidebarJumpSection({ label, testId, sticky, actions, children }: SidebarJumpSectionProps) {
  const content = useRef<HTMLDivElement>(null);

  return (
    <>
      {/* Full-bleed so a parked header occludes the rows sliding under it, but
          padded to the same 16px as a SidebarGroup's label so the two align. */}
      <SidebarGroupLabel className={cn('sticky z-10 shrink-0 bg-sidebar pr-2 pl-4', sticky)}>
        <button
          type="button"
          data-testid={`${testId}-jump`}
          className="min-w-0 flex-1 truncate text-left"
          // Scrolls the content, not the header: a parked header already counts
          // as in view, so asking the browser to reveal it does nothing.
          onClick={() => content.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
        >
          {label}
        </button>
        {actions != null && <span className="flex shrink-0 items-center gap-0.5">{actions}</span>}
      </SidebarGroupLabel>
      {/* The scroll margin reserves the header's own height, so the jump lands
          with the label at the top edge rather than scrolled past it. */}
      {/* px-2 insets every row in the section, so the hover and selection fills
          are rectangles inside the panel rather than edge-to-edge bands — and
          the overlay scrollbar lands in the gutter instead of on the content. */}
      <div ref={content} data-testid={testId} className="px-2" style={{ scrollMarginTop: JUMP_HEADER_HEIGHT }}>
        {children}
      </div>
    </>
  );
}
