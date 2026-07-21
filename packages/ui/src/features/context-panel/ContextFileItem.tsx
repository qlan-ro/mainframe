import { FileText } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { CONTEXT_SECTION_BASE_INSET_PX, CONTEXT_INDENT_STEP_PX } from './layout-constants';

interface ContextFileItemProps {
  path: string;
  displayName?: string;
  badge?: string;
}

/** Per-badge-type text color: '@'=accent, auto=muted, plan=amber, skill=violet. */
const BADGE_COLOR_CLASS: Record<string, string> = {
  '@': 'text-primary',
  auto: 'text-muted-foreground',
  plan: 'text-mf-accent-amber',
  skill: 'text-mf-accent-violet',
};

/** Per-badge-type background tint: same hue as BADGE_COLOR_CLASS at 20% opacity. */
const BADGE_BG_CLASS: Record<string, string> = {
  '@': 'bg-primary/[0.20]',
  auto: 'bg-mf-text-3/[0.20]',
  plan: 'bg-mf-accent-amber/[0.20]',
  skill: 'bg-mf-accent-violet/[0.20]',
};

/**
 * A context file row: icon + basename + optional badge, full path in a tooltip.
 * Click opens the file via the surface-intent bus (mirrors desktop's
 * ContextFileItem → openEditorTab). Out-of-project global files are best-effort.
 */
export function ContextFileItem({ path, displayName, badge }: ContextFileItemProps) {
  const fileName = displayName ?? path.split('/').pop() ?? path;
  const badgeColorClass = badge ? (BADGE_COLOR_CLASS[badge] ?? 'text-muted-foreground') : '';
  const badgeBgClass = badge ? (BADGE_BG_CLASS[badge] ?? 'bg-mf-text-3/[0.20]') : '';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`sidebar-context-item-${path}`}
          aria-label={path}
          onClick={() => emitSurfaceIntent({ type: 'open-file', path })}
          style={{ paddingLeft: CONTEXT_SECTION_BASE_INSET_PX + CONTEXT_INDENT_STEP_PX }}
          className="flex w-full min-w-0 items-center gap-2 rounded-md py-[3px] pr-[14px] text-left text-label text-foreground hover:bg-accent"
        >
          <FileText size={12} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate">{fileName}</span>
          {badge && (
            <span
              className={`shrink-0 rounded-[4px] px-1.5 font-mono text-caption font-semibold ${badgeColorClass} ${badgeBgClass}`}
            >
              {badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{path}</TooltipContent>
    </Tooltip>
  );
}
