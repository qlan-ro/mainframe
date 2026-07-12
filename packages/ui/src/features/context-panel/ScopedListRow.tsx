import type { LucideIcon } from 'lucide-react';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
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
      className="grid w-full grid-cols-[14px_1fr_auto] items-center gap-[7px] px-[12px] py-[4px] text-left hover:bg-accent"
    >
      <Icon size={14} className="text-primary" aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-label font-medium text-foreground">{name}</div>
        {description && (
          <TruncatedWithTooltip text={description} tabIndex={0} className="block text-caption text-muted-foreground" />
        )}
      </div>
      <span className="rounded-[8px] bg-mf-chip px-[5px] py-[1px] text-caption text-muted-foreground">{scope}</span>
    </button>
  );
}
