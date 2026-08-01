/**
 * SkillsSection — the advisor's Skills section: install band, the CLI's
 * manifest as rows, and whatever the last failed run printed.
 *
 * The manifest is read on mount and again whenever the shared skills nonce
 * moves, so an install from anywhere in the app refreshes this list. The
 * section is mounted only while the advisor is open, which is what makes a
 * mount effect the right place for the fetch.
 */
import { useEffect } from 'react';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';
import { SectionHeader } from '@/components/ui/section-header';
import { useSkillsNonce } from '@/features/skills/use-skills-revalidation';
import { CliUnavailable } from './CliUnavailable';
import { FailureTail } from './FailureTail';
import { InstallBand } from './InstallBand';
import { ManifestRow } from './ManifestRow';
import { skillKey, useSkillsCliStore } from './use-skills-cli-store';

const SKELETON_ROWS = 3;

interface SkillsSectionProps {
  projectId: string;
  adapterId?: string;
}

export function SkillsSection({ projectId, adapterId }: SkillsSectionProps) {
  const nonce = useSkillsNonce();
  const status = useSkillsCliStore((s) => s.status);
  const entries = useSkillsCliStore((s) => s.entries);
  const unavailable = useSkillsCliStore((s) => s.unavailable);
  const error = useSkillsCliStore((s) => s.error);
  const installing = useSkillsCliStore((s) => s.installing);
  const uninstallingKey = useSkillsCliStore((s) => s.uninstallingKey);
  const failure = useSkillsCliStore((s) => s.failure);
  const loadManifest = useSkillsCliStore((s) => s.loadManifest);
  const uninstall = useSkillsCliStore((s) => s.uninstall);

  useEffect(() => {
    void loadManifest(projectId, adapterId);
  }, [loadManifest, projectId, adapterId, nonce]);

  const busy = installing || uninstallingKey !== null;

  function removeSkill(entry: SkillsCliEntry) {
    void uninstall(projectId, [entry.name], entry.scope, adapterId);
  }

  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeader>Skills</SectionHeader>

      {adapterId && adapterId !== 'claude' ? (
        <p data-testid="skills-section-adapter-note" className="px-2 text-label text-muted-foreground">
          {"The composer and sidebar skill lists show Claude's skills."}
        </p>
      ) : null}

      {status === 'unavailable' && unavailable ? (
        <CliUnavailable executable={unavailable.executable} packageRunner={unavailable.packageRunner} />
      ) : (
        <>
          <InstallBand projectId={projectId} adapterId={adapterId} />

          {status === 'error' ? (
            <p className="px-2 text-label text-destructive">{error ?? 'Could not read the skills manifest'}</p>
          ) : null}

          {status === 'idle' || status === 'loading' ? (
            <div className="flex flex-col gap-1">
              {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <div key={i} data-testid="skills-section-skeleton" className="h-8 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : null}

          {status === 'available' && entries.length === 0 ? (
            <p data-testid="skills-section-empty" className="px-2 py-1.5 text-label text-muted-foreground">
              No skills installed by the CLI
            </p>
          ) : null}

          {entries.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {entries.map((entry) => (
                <ManifestRow
                  key={skillKey(entry.scope, entry.name)}
                  entry={entry}
                  running={uninstallingKey === skillKey(entry.scope, entry.name)}
                  disabled={busy}
                  onUninstall={removeSkill}
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      {failure ? <FailureTail message={failure.message} tail={failure.tail} /> : null}
    </section>
  );
}
