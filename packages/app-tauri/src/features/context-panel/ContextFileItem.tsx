import { FileText } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { emitSurfaceIntent } from '@/store/surface-intents';

interface ContextFileItemProps {
  path: string;
  displayName?: string;
  badge?: string;
}

/**
 * A context file row: icon + basename + optional badge, full path in a tooltip.
 * Click opens the file via the surface-intent bus (mirrors desktop's
 * ContextFileItem → openEditorTab). Out-of-project global files are best-effort.
 */
export function ContextFileItem({ path, displayName, badge }: ContextFileItemProps) {
  const fileName = displayName ?? path.split('/').pop() ?? path;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`sidebar-context-item-${path}`}
          aria-label={path}
          onClick={() => emitSurfaceIntent({ type: 'open-file', path })}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-[12px] py-1 text-left text-caption text-foreground hover:bg-mf-hover"
        >
          <FileText size={14} className="shrink-0 text-mf-text-3" aria-hidden />
          <span className="flex-1 truncate">{fileName}</span>
          {badge && (
            <span className="shrink-0 rounded-full bg-mf-hover px-1.5 text-micro text-mf-text-3">{badge}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{path}</TooltipContent>
    </Tooltip>
  );
}
