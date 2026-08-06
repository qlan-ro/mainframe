/**
 * SkillsSection — the advisor's Skills section: one list of skills, the ones
 * you have first, then the registry's most-installed.
 *
 * Installed and available are not separate modes. A skill you have and a skill
 * you could have are the same object at different points in its life, and
 * making the user pick a tab first asks them to know which side a skill is on
 * before they can look for it.
 *
 * Search always goes to the registry's API rather than filtering the catalog:
 * the catalog is the top of a leaderboard, not the index, so filtering it would
 * quietly cap discovery at whatever happens to be popular. Installed rows are
 * filtered locally alongside it, because that index knows nothing about this
 * machine.
 *
 * The manifest is read on mount and again whenever the shared skills nonce
 * moves, so an install from anywhere in the app refreshes the list. With no CLI
 * there is nothing to install *to*, so `CliUnavailable` replaces the whole
 * thing rather than leaving a dead list.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { Input } from '@v2/components/ui/input';
import { SectionHeader } from '@/components/ui/section-header';
import { useSkillsNonce } from '@/features/skills/use-skills-revalidation';
import { CliUnavailable } from './CliUnavailable';
import { FailureTail } from './FailureTail';
import { InstallBand } from './InstallBand';
import { buildSkillRows, type SkillRow } from './skill-rows';
import { SkillsList } from './SkillsList';
import { selectBrowseMode, selectBrowseRows, useSkillsBrowseStore } from './use-skills-browse-store';
import { useSkillsCliStore } from './use-skills-cli-store';

interface SkillsSectionProps {
  projectId: string;
  adapterId?: string;
}

export function SkillsSection({ projectId, adapterId }: SkillsSectionProps) {
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const nonce = useSkillsNonce();

  const query = useSkillsBrowseStore((s) => s.query);
  const catalogStatus = useSkillsBrowseStore((s) => s.catalogStatus);
  const searchStatus = useSkillsBrowseStore((s) => s.searchStatus);
  const searchError = useSkillsBrowseStore((s) => s.searchError);
  const mode = useSkillsBrowseStore(selectBrowseMode);
  const items = useSkillsBrowseStore(selectBrowseRows);
  const setQuery = useSkillsBrowseStore((s) => s.setQuery);
  const loadCatalog = useSkillsBrowseStore((s) => s.loadCatalog);
  const resetBrowse = useSkillsBrowseStore((s) => s.reset);

  const status = useSkillsCliStore((s) => s.status);
  const loaded = useSkillsCliStore((s) => s.loaded);
  const entries = useSkillsCliStore((s) => s.entries);
  const unavailable = useSkillsCliStore((s) => s.unavailable);
  const installing = useSkillsCliStore((s) => s.installing);
  const uninstallingKey = useSkillsCliStore((s) => s.uninstallingKey);
  const failure = useSkillsCliStore((s) => s.failure);
  const loadManifest = useSkillsCliStore((s) => s.loadManifest);
  const install = useSkillsCliStore((s) => s.install);
  const uninstall = useSkillsCliStore((s) => s.uninstall);

  const rows = useMemo(() => buildSkillRows(entries, items, query.trim()), [entries, items, query]);

  useEffect(() => {
    void loadManifest(projectId, adapterId);
  }, [loadManifest, projectId, adapterId, nonce]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // The registry lists are global, but a stale query outliving the panel would
  // reopen it mid-search on a term the user has forgotten typing.
  useEffect(() => resetBrowse, [resetBrowse]);

  const busy = installing || uninstallingKey !== null;
  // Every read the panel makes, in one place: a refresh keeps its rows, so
  // without this the only sign of a slow manifest or search is that the list
  // changes under you some seconds later.
  const fetching =
    status === 'idle' ||
    status === 'loading' ||
    catalogStatus === 'idle' ||
    catalogStatus === 'loading' ||
    searchStatus === 'searching';

  async function run(row: SkillRow, work: Promise<unknown>) {
    setRunningKey(row.key);
    await work;
    setRunningKey(null);
  }

  function installSkill(row: SkillRow, scope: SkillsCliScope) {
    if (!row.source) return;
    void run(row, install(projectId, row.source, [row.skillId], scope, adapterId));
  }

  function uninstallSkill(row: SkillRow, scope: SkillsCliScope) {
    void run(row, uninstall(projectId, [row.skillId], scope, adapterId));
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
      {/* Search and the source band frame the list; only the list scrolls. */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="relative">
          <Input
            data-testid="skills-browse-search"
            className="pr-8"
            value={query}
            placeholder="Search your skills and skills.sh"
            aria-label="Search skills"
            onChange={(e) => setQuery(e.target.value)}
          />
          {fetching ? (
            <span
              data-testid="skills-browse-loading"
              role="status"
              aria-label="Loading skills"
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            </span>
          ) : null}
        </div>

        {adapterId && adapterId !== 'claude' ? (
          <p data-testid="skills-section-adapter-note" className="pt-1.5 text-xs text-muted-foreground">
            {"The composer and sidebar skill lists show Claude's skills."}
          </p>
        ) : null}

        {/* Without the manifest every row looks new, which is a claim the panel can't make. */}
        {status === 'error' ? (
          <p data-testid="skills-browse-manifest-error" className="pt-1.5 text-xs text-muted-foreground">
            {"Couldn't read your installed skills, so none are marked here."}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <SkillsList
          rows={rows}
          mode={mode}
          manifestLoaded={loaded}
          catalogStatus={catalogStatus}
          searchStatus={searchStatus}
          searchError={searchError}
          runningKey={runningKey}
          disabled={busy}
          onInstall={installSkill}
          onUninstall={uninstallSkill}
        />
      </div>

      <div className="shrink-0 border-t border-border px-4 pb-3 pt-2">
        <SectionHeader className="px-0 pt-0">Install from a source</SectionHeader>
        <InstallBand projectId={projectId} adapterId={adapterId} />
        {failure ? <FailureTail message={failure.message} tail={failure.tail} /> : null}
      </div>
    </section>
  );
}
