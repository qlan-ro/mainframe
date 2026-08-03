/**
 * BrowseTab — the registry side of the Skills section: search skills.sh, or
 * pick from its leaderboard, and install to the chosen scope.
 *
 * Search always goes to the registry's API rather than filtering the catalog:
 * the catalog is the top of a leaderboard, not the index, so filtering it would
 * quietly cap discovery at whatever happens to be popular.
 *
 * The source band stays underneath as a secondary path — it is the only way to
 * install from a private, unlisted or self-hosted repository, which the
 * registry cannot list.
 */
import { useEffect, useState } from 'react';
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { Input } from '@/components/ui/input';
import { SectionHeader } from '@/components/ui/section-header';
import { BrowseBody } from './BrowseBody';
import { InstallBand } from './InstallBand';
import { ScopeChoice } from './ScopeChoice';
import {
  browseKey,
  selectBrowseMode,
  selectBrowseRows,
  useSkillsBrowseStore,
  type BrowseItem,
} from './use-skills-browse-store';
import { useSkillsCliStore } from './use-skills-cli-store';

interface BrowseTabProps {
  projectId: string;
  adapterId?: string;
}

export function BrowseTab({ projectId, adapterId }: BrowseTabProps) {
  const [scope, setScope] = useState<SkillsCliScope>('project');
  const [installingKey, setInstallingKey] = useState<string | null>(null);

  const query = useSkillsBrowseStore((s) => s.query);
  const catalogStatus = useSkillsBrowseStore((s) => s.catalogStatus);
  const searchStatus = useSkillsBrowseStore((s) => s.searchStatus);
  const searchError = useSkillsBrowseStore((s) => s.searchError);
  const mode = useSkillsBrowseStore(selectBrowseMode);
  const rows = useSkillsBrowseStore(selectBrowseRows);
  const setQuery = useSkillsBrowseStore((s) => s.setQuery);
  const loadCatalog = useSkillsBrowseStore((s) => s.loadCatalog);

  const installing = useSkillsCliStore((s) => s.installing);
  const uninstallingKey = useSkillsCliStore((s) => s.uninstallingKey);
  const install = useSkillsCliStore((s) => s.install);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  async function installSkill(item: BrowseItem) {
    setInstallingKey(browseKey(item));
    await install(projectId, item.source, [item.skillId], scope, adapterId);
    setInstallingKey(null);
  }

  const busy = installing || uninstallingKey !== null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          data-testid="skills-browse-search"
          className="min-w-[160px] flex-1 text-label"
          value={query}
          placeholder="Search skills.sh"
          aria-label="Search the skills registry"
          onChange={(e) => setQuery(e.target.value)}
        />
        <ScopeChoice value={scope} disabled={busy} onChange={setScope} />
      </div>

      <BrowseBody
        mode={mode}
        catalogStatus={catalogStatus}
        searchStatus={searchStatus}
        searchError={searchError}
        rows={rows}
        installingKey={installingKey}
        disabled={busy}
        onInstall={(item) => void installSkill(item)}
      />

      <SectionHeader>Install from a source</SectionHeader>
      <InstallBand projectId={projectId} adapterId={adapterId} scope={scope} />
    </div>
  );
}
