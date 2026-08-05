/**
 * SkillListRow — one skill, installed or not: name, an official marker, its
 * source, its install count, and a single action in a fixed-width trailing
 * slot. The slot is reserved so a row entering its running state cannot reflow
 * its neighbours.
 *
 * The official marker is an icon, not a chip: it is the only semantic hue in
 * the row, and it is withheld entirely when the flag is absent — search results
 * carry no flag, and unknown is not the same as "not official".
 *
 * The source is plain metadata, not a chip. Twenty filled pills down a list
 * read as the loudest column on screen and leave the skill name — the subject —
 * as the quietest thing in its own row.
 *
 * Hover and focus are tracked here rather than in CSS because they change what
 * the action *does*, not just how it looks: an installed row's button becomes
 * Uninstall. `focusWithin` keeps that reachable without a pointer.
 */
import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { SkillAction } from './SkillAction';
import type { SkillRow } from './skill-rows';

/** Matches the registry's own column: `2.8M`, `733.3K`, `842`. */
export function formatInstalls(installs: number): string {
  if (installs >= 1_000_000) return `${(installs / 1_000_000).toFixed(1)}M`;
  if (installs >= 1_000) return `${(installs / 1_000).toFixed(1)}K`;
  return String(installs);
}

interface SkillListRowProps {
  row: SkillRow;
  running: boolean;
  disabled: boolean;
  onInstall: (row: SkillRow, scope: SkillsCliScope) => void;
  onUninstall: (row: SkillRow, scope: SkillsCliScope) => void;
}

export function SkillListRow({ row, running, disabled, onInstall, onUninstall }: SkillListRowProps) {
  const [pointerOver, setPointerOver] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  // The scope popover renders outside the row, so leaving the row while it is
  // open must not flip the trigger back to "Installed" underneath it.
  const [openScope, setOpenScope] = useState(false);

  return (
    <div
      data-testid={`skills-row-${row.key}`}
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent"
      onMouseEnter={() => setPointerOver(true)}
      onMouseLeave={() => setPointerOver(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={() => setFocusWithin(false)}
    >
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{row.name}</span>
      {row.isOfficial ? <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-label="Official" /> : null}
      {row.source ? (
        <span className="min-w-0 max-w-[180px] truncate font-mono text-xs text-muted-foreground">{row.source}</span>
      ) : null}
      {/* Fixed width so the counts right-align into a column instead of raggedly trailing each source. */}
      <span className="w-[44px] shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {row.installs === undefined ? '' : formatInstalls(row.installs)}
      </span>
      <div className="flex w-[88px] shrink-0 justify-end">
        <SkillAction
          row={row}
          running={running}
          disabled={disabled}
          revealed={pointerOver || focusWithin || openScope}
          openScope={openScope}
          onOpenScope={setOpenScope}
          onInstall={onInstall}
          onUninstall={onUninstall}
        />
      </div>
    </div>
  );
}
