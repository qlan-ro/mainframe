/**
 * SessionTabPill — one session tab in the title-bar strip: a project-colored
 * dot, the session title, and a hover close (×). Follows the workspace strip's
 * pill recipe (`div role="tab"` carrying a v2 Button — a closeable tab is never
 * Radix Tabs, and a real <button> pill would nest buttons).
 *
 * The pill lives inside the toolbar's window-drag region; the strip container
 * opts out via `data-no-drag` (see host `init()`), so pointer-downs here reach
 * the pill instead of starting an OS window drag.
 *
 * data-testid: session-tab-<id> / session-tab-close-<id>.
 */
import { X } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { cn } from '@v2/lib/utils';
import { projectColor } from '@/features/sessions/sidebar/project-color';

export interface SessionTabEntry {
  id: string;
  title: string;
  projectId: string | undefined;
  active: boolean;
}

interface SessionTabPillProps {
  tab: SessionTabEntry;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

/**
 * The active tab's outward-rounded bottom corner (Chrome's tab flare). One
 * quarter-arc joins the tab's side border to the toolbar hairline; the filled
 * path also erases the straight border segment and the hairline inside the
 * flare, so the stroke reads as ONE continuous curve. Mirrored for the right
 * side via scale-x.
 *
 * The geometry is EXACT-tangent, which is what makes the joint seamless: the
 * tab's border-left center sits at x=10.5 (svg is offset -10px, the border is
 * the 1px column at the tab's edge), the hairline center at y=9.5 (the
 * toolbar's bottom 1px row). A circle tangent to both lines has its center at
 * (1, 0) with r=9.5 — so the arc leaves the border VERTICALLY at (10.5, 0) and
 * lands HORIZONTALLY at (1, 9.5). Endpoints derived any other way make the
 * renderer bend the circle to fit and the lines visibly kink.
 */
function TabFlare({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 11 10"
      className={cn(
        'pointer-events-none absolute bottom-0 h-2.5 w-[11px]',
        side === 'left' ? 'left-[-10px]' : 'right-[-10px] -scale-x-100',
      )}
    >
      {/* Erase the tab's straight border and the hairline inside the flare. */}
      <path d="M11 0 H10.5 A9.5 9.5 0 0 1 1 9.5 H0 V10 H11 Z" className="fill-background" />
      {/* The flare stroke: down the border line, around, out along the hairline. */}
      <path d="M10.5 0 A9.5 9.5 0 0 1 1 9.5 L0 9.5" className="fill-none stroke-border" strokeWidth="1" />
    </svg>
  );
}

export function SessionTabPill({ tab, onActivate, onClose }: SessionTabPillProps) {
  return (
    <div
      data-testid={`session-tab-${tab.id}`}
      role="tab"
      aria-selected={tab.active}
      onClick={() => onActivate(tab.id)}
      className={cn(
        'group flex w-45 min-w-24 shrink cursor-pointer items-center gap-1.5 pr-1 pl-2 text-xs select-none',
        tab.active
          ? // Chrome-style joint: the active tab is a bordered, top-rounded box
            // anchored to the toolbar's bottom edge. Its opaque background sits
            // on top of the toolbar's inset bottom hairline, so the title/content
            // divider visually OPENS into the tab; TabFlare curves the side
            // borders outward into the hairline at both bottom corners.
            // h-10 + pb-2 keep the CONTENT on the toolbar's 24px midline: the
            // box spans y 8→48, the padded content area centers at 24 — the
            // same line the centered inactive pills sit on.
            'relative h-10 self-end rounded-t-xl border border-b-0 border-border bg-background pb-2 font-semibold text-foreground'
          : 'h-7 self-center rounded-md font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {tab.active && (
        <>
          <TabFlare side="left" />
          <TabFlare side="right" />
        </>
      )}
      <span
        className={cn('size-1.5 shrink-0 rounded-full', !tab.projectId && 'bg-muted-foreground/40')}
        style={tab.projectId ? { background: projectColor(tab.projectId) } : undefined}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      <Hint label={`Close ${tab.title}`}>
        <Button
          data-testid={`session-tab-close-${tab.id}`}
          variant="ghost"
          size="icon-2xs"
          className={cn('opacity-0 group-hover:opacity-100', tab.active && 'opacity-60')}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
        >
          <X />
        </Button>
      </Hint>
    </div>
  );
}
