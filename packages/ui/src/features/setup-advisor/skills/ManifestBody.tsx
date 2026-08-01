/**
 * ManifestBody — the four states the manifest itself can be in: still
 * loading, failed to read, empty, or a list of rows.
 */
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';
import { ManifestRow } from './ManifestRow';
import { skillKey, type SkillsCliStatus } from './use-skills-cli-store';

const SKELETON_ROWS = 3;

interface ManifestBodyProps {
  status: SkillsCliStatus;
  error: string | null;
  entries: SkillsCliEntry[];
  uninstallingKey: string | null;
  disabled: boolean;
  onUninstall: (entry: SkillsCliEntry) => void;
}

export function ManifestBody({ status, error, entries, uninstallingKey, disabled, onUninstall }: ManifestBodyProps) {
  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex flex-col gap-1">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div key={i} data-testid="skills-section-skeleton" className="h-8 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return <p className="px-2 text-label text-destructive">{error ?? 'Could not read the skills manifest'}</p>;
  }

  if (entries.length === 0) {
    return (
      <p data-testid="skills-section-empty" className="px-2 py-1.5 text-label text-muted-foreground">
        No skills installed by the CLI
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <ManifestRow
          key={skillKey(entry.scope, entry.name)}
          entry={entry}
          running={uninstallingKey === skillKey(entry.scope, entry.name)}
          disabled={disabled}
          onUninstall={onUninstall}
        />
      ))}
    </div>
  );
}
