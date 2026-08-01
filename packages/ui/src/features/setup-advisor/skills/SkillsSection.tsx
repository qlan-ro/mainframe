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
import { ManifestBody } from './ManifestBody';
import { useSkillsCliStore } from './use-skills-cli-store';

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

  function removeSkill(entry: SkillsCliEntry) {
    void uninstall(projectId, [entry.name], entry.scope, adapterId);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
      {status === 'unavailable' && unavailable ? (
        <CliUnavailable executable={unavailable.executable} packageRunner={unavailable.packageRunner} />
      ) : (
        <>
          <InstallBand projectId={projectId} adapterId={adapterId} />

          {adapterId && adapterId !== 'claude' ? (
            <p data-testid="skills-section-adapter-note" className="px-2 text-label text-muted-foreground">
              {"The composer and sidebar skill lists show Claude's skills."}
            </p>
          ) : null}

          <SectionHeader>Installed</SectionHeader>

          <ManifestBody
            status={status}
            error={error}
            entries={entries}
            uninstallingKey={uninstallingKey}
            disabled={installing || uninstallingKey !== null}
            onUninstall={removeSkill}
          />
        </>
      )}

      {failure ? <FailureTail message={failure.message} tail={failure.tail} /> : null}
    </section>
  );
}
