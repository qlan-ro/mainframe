import type { LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { emitSurfaceIntent } from '@/store/surface-intents';

interface ScopedListRowProps {
  testId: string;
  icon: LucideIcon;
  name: string;
  description?: string;
  scope: string;
  filePath: string;
}

/** Shared skill/agent row: accent icon + name/description + scope chip; opens the file. */
export function ScopedListRow({ testId, icon: Icon, name, description, scope, filePath }: ScopedListRowProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => emitSurfaceIntent({ type: 'open-file', path: filePath })}
      className="grid w-full grid-cols-[14px_1fr_auto] items-center gap-[7px] px-[12px] py-1 text-left hover:bg-mf-hover"
    >
      <Icon size={11} className="text-primary" aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-caption font-medium text-foreground">{name}</div>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="truncate text-micro text-mf-text-3" tabIndex={0}>
                {description}
              </div>
            </TooltipTrigger>
            <TooltipContent>{description}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <span className="rounded-lg bg-mf-hover px-[5px] text-micro uppercase tracking-wide text-mf-text-3">{scope}</span>
    </button>
  );
}
