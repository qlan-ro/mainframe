/**
 * BrowseBody — the states the registry list can be in, split by which list is
 * on screen. The catalog is a convenience: when it can't be read the panel says
 * so as a prompt to search, not as an error, because searching still works and
 * there is nothing the user could do about the scrape anyway.
 */
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { BrowseRow } from './BrowseRow';
import { installedScopesFor, type InstalledIndex } from './installed-index';
import { browseKey, type BrowseItem, type CatalogStatus, type SearchStatus } from './use-skills-browse-store';

const SKELETON_ROWS = 5;

interface BrowseBodyProps {
  mode: 'catalog' | 'search';
  catalogStatus: CatalogStatus;
  searchStatus: SearchStatus;
  searchError: string | null;
  rows: BrowseItem[];
  /** Key of the row whose install is in flight, or null. */
  installingKey: string | null;
  disabled: boolean;
  /** What the CLI already has installed, keyed the same way the rows are. */
  installed: InstalledIndex;
  /** The scope an install from this list would land in. */
  scope: SkillsCliScope;
  onInstall: (item: BrowseItem) => void;
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} data-testid="skills-browse-skeleton" className="h-8 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function Note({ testId, children }: { testId: string; children: string }) {
  return (
    <p data-testid={testId} className="px-2 py-1.5 text-label text-muted-foreground">
      {children}
    </p>
  );
}

export function BrowseBody(props: BrowseBodyProps) {
  const { mode, catalogStatus, searchStatus, searchError, rows } = props;
  const { installingKey, disabled, installed, scope, onInstall } = props;

  if (mode === 'search') {
    if (searchStatus === 'searching') return <Skeletons />;
    if (searchStatus === 'error') {
      return (
        <p data-testid="skills-browse-search-error" className="px-2 py-1.5 text-label text-destructive">
          {searchError ?? 'Could not search the skills registry'}
        </p>
      );
    }
    if (rows.length === 0) return <Note testId="skills-browse-no-results">No skills match that search</Note>;
  } else {
    if (catalogStatus === 'idle' || catalogStatus === 'loading') return <Skeletons />;
    if (catalogStatus === 'unavailable') {
      return <Note testId="skills-browse-catalog-unavailable">Search skills.sh to find a skill to install</Note>;
    }
    if (rows.length === 0) return <Note testId="skills-browse-catalog-empty">The registry returned no skills</Note>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((item) => (
        <BrowseRow
          key={browseKey(item)}
          item={item}
          running={installingKey === browseKey(item)}
          disabled={disabled}
          installedScopes={installedScopesFor(installed, item)}
          scope={scope}
          onInstall={onInstall}
        />
      ))}
    </div>
  );
}
