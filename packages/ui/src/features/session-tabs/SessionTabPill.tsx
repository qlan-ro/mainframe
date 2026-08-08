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
 * The active tab's outward-rounded bottom corner (Chrome's tab flare): a
 * FILLED quarter-arc pocket continuing the tab's solid shape into the
 * title/content divider. Like Chrome's own tabs the shape has no outline —
 * it reads purely by fill contrast against the tinted strip — so the flare
 * is one path: everything right of the arc, down to the toolbar's bottom
 * edge (covering the hairline row inside its footprint). Mirrored for the
 * right side via scale-x.
 */
function TabFlare({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 10"
      className={cn(
        'pointer-events-none absolute bottom-0 size-2.5',
        side === 'left' ? 'left-[-10px]' : 'right-[-10px] -scale-x-100',
      )}
    >
      <path d="M10 0 A10 10 0 0 1 0 10 H10 Z" className="fill-background" />
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
          ? // Chrome-style tab: a solid bg-background shape (no outline)
            // anchored to the toolbar's bottom edge, sitting on the tinted
            // strip and covering the hairline so it merges into the content
            // below; TabFlare rounds the bottom corners outward. h-9 + pb-3
            // keep the CONTENT on the toolbar's 24px midline: the box spans
            // y 12→48, the 12px-bottom-padded content area centers at 24 —
            // the same line the centered inactive pills sit on.
            'relative h-9 self-end rounded-t-xl bg-background pb-3 font-semibold text-foreground'
          : 'h-7 self-center rounded-md font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground',
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
