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
 *
 * Rows the CLI has already installed are marked from the manifest, so the list
 * says what is new to this machine rather than offering everything equally.
 */
import { useEffect, useMemo, useState } from 'react';
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { Input } from '@/components/ui/input';
import { SectionHeader } from '@/components/ui/section-header';
import { BrowseBody } from './BrowseBody';
import { buildInstalledIndex } from './installed-index';
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
  const entries = useSkillsCliStore((s) => s.entries);
  const manifestStatus = useSkillsCliStore((s) => s.status);

  // The section owns the manifest fetch, and every install re-reads it, so the
  // markers follow an install without this tab tracking anything itself.
  const installed = useMemo(() => buildInstalledIndex(entries), [entries]);

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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search, scope and the source band frame the list; only the list scrolls. */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            data-testid="skills-browse-search"
            className="min-w-[160px] flex-1"
            value={query}
            placeholder="Search skills.sh"
            aria-label="Search the skills registry"
            onChange={(e) => setQuery(e.target.value)}
          />
          <ScopeChoice value={scope} disabled={busy} onChange={setScope} />
        </div>

        {/* Without the manifest every row looks new, which is a claim the panel can't make. */}
        {manifestStatus === 'error' ? (
          <p data-testid="skills-browse-manifest-error" className="pt-1.5 text-label text-muted-foreground">
            {"Couldn't read your installed skills, so none are marked here."}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <BrowseBody
          mode={mode}
          catalogStatus={catalogStatus}
          searchStatus={searchStatus}
          searchError={searchError}
          rows={rows}
          installingKey={installingKey}
          disabled={busy}
          installed={installed}
          scope={scope}
          onInstall={(item) => void installSkill(item)}
        />
      </div>

      <div className="shrink-0 border-t border-border px-4 pb-3 pt-2">
        <SectionHeader className="px-0 pt-0">Install from a source</SectionHeader>
        <InstallBand projectId={projectId} adapterId={adapterId} scope={scope} />
      </div>
    </div>
  );
}
