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
            // divider visually OPENS into the tab; the side borders meet the
            // hairline left and right of it.
            'h-8 self-end rounded-t-md border border-b-0 border-border bg-background font-semibold text-foreground'
          : 'h-7 self-center rounded-md font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
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
