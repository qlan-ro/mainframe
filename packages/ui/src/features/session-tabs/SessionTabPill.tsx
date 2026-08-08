/**
 * SessionTabPill — one session tab in the title-bar strip: a project-colored
 * dot, the session title, and a hover close (×).
 *
 * Styled as the v2 Tabs primitive's `line` variant (verdict after trying the
 * boxed and Chrome-filled treatments): transparent pills, the active tab
 * marked by a 2px `bg-foreground` underline sitting ON the toolbar's bottom
 * hairline. The vocabulary is borrowed rather than the primitive used — a
 * closeable tab is never Radix Tabs, because `TabsTrigger` renders a <button>
 * and the close control would nest buttons (the workspace strip's rule).
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
        // h-full puts the underline on the toolbar's bottom hairline and the
        // label on the toolbar midline — one alignment for every tab state.
        'group relative flex h-full w-45 min-w-24 shrink cursor-pointer items-center gap-1.5 px-2 text-xs select-none',
        'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity',
        tab.active
          ? 'font-semibold text-foreground after:opacity-100'
          : 'font-medium text-muted-foreground hover:text-foreground',
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
