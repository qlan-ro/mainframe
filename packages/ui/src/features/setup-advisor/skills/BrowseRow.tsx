/**
 * BrowseRow — one skill from the registry: name, its source, an official
 * marker, the install count, and Install. Same row recipe as `ManifestRow`,
 * including the fixed-width trailing slot that keeps a running row from
 * reflowing its neighbours.
 *
 * The official marker is an icon, not a chip: it is the only semantic hue in
 * the row, and it is withheld entirely when the flag is `null` — search
 * results carry no flag, and absent is not the same as "not official".
 *
 * The source is plain metadata, not a chip. Twenty filled pills down a
 * leaderboard read as the loudest column on screen and leave the skill name —
 * the subject — as the quietest thing in its own row.
 *
 * Already-installed reads two ways, and the row shows exactly one of them.
 * Installed in the scope the toolbar has selected: the button says so and is
 * spent. Installed only in the other scope: a chip names that scope and the
 * button stays live, because installing it here as well is a real thing to do.
 */
import { BadgeCheck, Check, Loader2 } from 'lucide-react';
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { CHIP_BASE } from '@/components/ui/chip';
import { cn } from '@/lib/utils';
import type { BrowseItem } from './use-skills-browse-store';

const INSTALLED_TONE = 'h-[20px] border-transparent bg-primary/10 text-caption text-primary';

const ELSEWHERE_LABEL: Record<SkillsCliScope, string> = {
  project: 'Installed in project',
  global: 'Installed globally',
};

/** Matches the registry's own column: `2.8M`, `733.3K`, `842`. */
export function formatInstalls(installs: number): string {
  if (installs >= 1_000_000) return `${(installs / 1_000_000).toFixed(1)}M`;
  if (installs >= 1_000) return `${(installs / 1_000).toFixed(1)}K`;
  return String(installs);
}

interface BrowseRowProps {
  item: BrowseItem;
  /** This row's install is in flight. */
  running: boolean;
  /** Any skills-CLI operation is in flight — one at a time, per project. */
  disabled: boolean;
  /** Scopes this skill is already installed in, per the CLI manifest. */
  installedScopes: SkillsCliScope[];
  /** The scope the toolbar is set to — the one an install would land in. */
  scope: SkillsCliScope;
  onInstall: (item: BrowseItem) => void;
}

export function BrowseRow({ item, running, disabled, installedScopes, scope, onInstall }: BrowseRowProps) {
  const { source, skillId, name, installs, isOfficial } = item;
  const installedHere = installedScopes.includes(scope);
  const elsewhere = installedHere ? null : installedScopes[0];

  return (
    <div
      data-testid={`skills-browse-row-${source}-${skillId}`}
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">{name}</span>
      {isOfficial ? <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-label="Official" /> : null}
      {elsewhere ? (
        <span data-testid={`skills-browse-installed-${source}-${skillId}`} className={cn(CHIP_BASE, INSTALLED_TONE)}>
          <span className="truncate">{ELSEWHERE_LABEL[elsewhere]}</span>
        </span>
      ) : null}
      <span className="min-w-0 max-w-[180px] truncate font-mono text-caption text-muted-foreground">{source}</span>
      {/* Fixed width so the counts right-align into a column instead of raggedly trailing each source. */}
      <span className="w-[44px] shrink-0 text-right text-caption tabular-nums text-muted-foreground">
        {formatInstalls(installs)}
      </span>
      <div className="flex w-[88px] shrink-0 justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid={`skills-browse-install-${source}-${skillId}`}
          aria-busy={running}
          disabled={disabled || installedHere}
          onClick={() => onInstall(item)}
        >
          {running ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Installing
            </>
          ) : installedHere ? (
            <>
              <Check aria-hidden />
              Installed
            </>
          ) : (
            'Install'
          )}
        </Button>
      </div>
    </div>
  );
}
