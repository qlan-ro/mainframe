/**
 * SkillsSection — the advisor's Skills section: Browse the skills.sh registry,
 * or manage what the CLI has already installed.
 *
 * Browse is the default tab: the section exists to get skills onto the machine,
 * and the installed list is what you check afterwards. The manifest is read on
 * mount and again whenever the shared skills nonce moves, so an install from
 * anywhere in the app refreshes it — including one made from Browse while the
 * Installed tab is off screen.
 *
 * With no CLI there is nothing to install *to*, so `CliUnavailable` replaces
 * both tabs rather than leaving Browse as a dead end.
 */
import { useEffect, useState } from 'react';
import type { SkillsCliEntry } from '@qlan-ro/mainframe-types';
import { useSkillsNonce } from '@/features/skills/use-skills-revalidation';
import { BrowseTab } from './BrowseTab';
import { CliUnavailable } from './CliUnavailable';
import { FailureTail } from './FailureTail';
import { ManifestBody } from './ManifestBody';
import { SkillsTabs, type SkillsTab } from './SkillsTabs';
import { useSkillsBrowseStore } from './use-skills-browse-store';
import { useSkillsCliStore } from './use-skills-cli-store';

interface SkillsSectionProps {
  projectId: string;
  adapterId?: string;
}

export function SkillsSection({ projectId, adapterId }: SkillsSectionProps) {
  const [tab, setTab] = useState<SkillsTab>('browse');
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
  const resetBrowse = useSkillsBrowseStore((s) => s.reset);

  useEffect(() => {
    void loadManifest(projectId, adapterId);
  }, [loadManifest, projectId, adapterId, nonce]);

  // The registry lists are global, but a stale query outliving the panel would
  // reopen it mid-search on a term the user has forgotten typing.
  useEffect(() => resetBrowse, [resetBrowse]);

  function removeSkill(entry: SkillsCliEntry) {
    void uninstall(projectId, [entry.name], entry.scope, adapterId);
  }

  if (status === 'unavailable' && unavailable) {
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        <CliUnavailable executable={unavailable.executable} packageRunner={unavailable.packageRunner} />
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <SkillsTabs active={tab} onSelect={setTab} />

      {adapterId && adapterId !== 'claude' ? (
        <p data-testid="skills-section-adapter-note" className="shrink-0 px-4 pt-2 text-label text-muted-foreground">
          {"The composer and sidebar skill lists show Claude's skills."}
        </p>
      ) : null}

      {tab === 'browse' ? (
        <BrowseTab projectId={projectId} adapterId={adapterId} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <ManifestBody
            status={status}
            error={error}
            entries={entries}
            uninstallingKey={uninstallingKey}
            disabled={installing || uninstallingKey !== null}
            onUninstall={removeSkill}
          />
        </div>
      )}

      {failure ? (
        <div className="shrink-0 px-4 pb-3 pt-2">
          <FailureTail message={failure.message} tail={failure.tail} />
        </div>
      ) : null}
    </section>
  );
}
