/**
 * ManifestRow — one CLI-installed skill: name, its source, a scope chip, and an
 * Uninstall button in a fixed-width trailing slot. The slot is reserved so a
 * row entering its running state cannot reflow its neighbours.
 *
 * Only the scope is a chip. A filled pill on every source too would put two
 * tinted shapes in every row and leave the skill name — the subject — as the
 * quietest thing in it; the source reads as plain metadata instead.
 */
import { Loader2 } from 'lucide-react';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { CHIP_BASE } from '@/components/ui/chip';
import { cn } from '@/lib/utils';

const CHIP_TONE = 'border-transparent bg-mf-chip text-muted-foreground';

interface ManifestRowProps {
  entry: SkillsCliEntry;
  /** This row's uninstall is in flight. */
  running: boolean;
  /** Any skills-CLI operation is in flight — one at a time, per project. */
  disabled: boolean;
  onUninstall: (entry: SkillsCliEntry) => void;
}

export function ManifestRow({ entry, running, disabled, onUninstall }: ManifestRowProps) {
  const { name, scope, source } = entry;

  return (
    <div
      data-testid={`skills-section-row-${scope}-${name}`}
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">{name}</span>
      {source ? (
        <span className="min-w-0 max-w-[180px] truncate font-mono text-caption text-muted-foreground">{source}</span>
      ) : null}
      <span className={cn(CHIP_BASE, CHIP_TONE, 'h-[20px] text-caption')}>{scope}</span>
      <div className="flex w-[88px] shrink-0 justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid={`skills-section-uninstall-${scope}-${name}`}
          aria-busy={running}
          disabled={disabled}
          onClick={() => onUninstall(entry)}
        >
          {running ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Removing
            </>
          ) : (
            'Uninstall'
          )}
        </Button>
      </div>
    </div>
  );
}
