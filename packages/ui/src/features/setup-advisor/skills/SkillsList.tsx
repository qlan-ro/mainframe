/**
 * SkillsList — the one list, installed first.
 *
 * The registry's states (loading, no results, catalog unreadable) replace only
 * the registry half. What you already have does not depend on skills.sh being
 * reachable, so those rows keep rendering underneath a failed catalog rather
 * than disappearing with it.
 *
 * Headers appear only once both halves exist. With nothing installed the list
 * is just the registry, and labelling that "From skills.sh" would be captioning
 * the only thing on screen.
 *
 * Nothing renders until the manifest's first read lands, even when the registry
 * has already answered: every row's action depends on whether that skill is
 * installed, so rendering early offers to install skills the user already has
 * and then silently corrects itself. Skeletons say "not yet" instead. Only the
 * first read blanks the list — a refresh keeps the rows and reports itself in
 * the search field.
 */
import type { SkillsCliScope } from '@qlan-ro/mainframe-types';
import { SectionHeader } from '@/components/ui/section-header';
import { SkillListRow } from './SkillListRow';
import type { SkillRow, SkillRows } from './skill-rows';
import type { CatalogStatus, SearchStatus } from './use-skills-browse-store';

const SKELETON_ROWS = 5;

interface SkillsListProps {
  rows: SkillRows;
  mode: 'catalog' | 'search';
  /** False until the manifest's first read lands — a refetch does not clear it. */
  manifestLoaded: boolean;
  catalogStatus: CatalogStatus;
  searchStatus: SearchStatus;
  searchError: string | null;
  /** Key of the row whose install or uninstall is in flight, or null. */
  runningKey: string | null;
  disabled: boolean;
  onInstall: (row: SkillRow, scope: SkillsCliScope) => void;
  onUninstall: (row: SkillRow, scope: SkillsCliScope) => void;
}

export function SkillsList(props: SkillsListProps) {
  const { rows, mode, manifestLoaded, catalogStatus, searchStatus } = props;
  const { runningKey, disabled, onInstall, onUninstall } = props;

  const registryLoading =
    mode === 'search' ? searchStatus === 'searching' : catalogStatus === 'idle' || catalogStatus === 'loading';

  if (!manifestLoaded) return <Skeletons />;

  const renderRow = (row: SkillRow) => (
    <SkillListRow
      key={row.key}
      row={row}
      running={runningKey === row.key}
      disabled={disabled}
      onInstall={onInstall}
      onUninstall={onUninstall}
    />
  );

  const showHeaders = rows.installed.length > 0 && (rows.available.length > 0 || registryLoading);

  return (
    <div className="flex flex-col gap-0.5">
      {rows.installed.length > 0 ? (
        <>
          {showHeaders ? <SectionHeader className="px-2 pt-0">Installed</SectionHeader> : null}
          {rows.installed.map(renderRow)}
        </>
      ) : null}

      {showHeaders ? <SectionHeader className="px-2">From skills.sh</SectionHeader> : null}
      <RegistryHalf {...props} registryLoading={registryLoading} renderRow={renderRow} />
    </div>
  );
}

function RegistryHalf({
  rows,
  mode,
  catalogStatus,
  searchStatus,
  searchError,
  registryLoading,
  renderRow,
}: SkillsListProps & { registryLoading: boolean; renderRow: (row: SkillRow) => React.ReactNode }) {
  if (registryLoading) return <Skeletons />;

  if (mode === 'search') {
    if (searchStatus === 'error') {
      return (
        <p data-testid="skills-browse-search-error" className="px-2 py-1.5 text-xs text-destructive">
          {searchError ?? 'Could not search the skills registry'}
        </p>
      );
    }
    if (rows.available.length === 0 && rows.installed.length === 0) {
      return <Note testId="skills-browse-no-results">No skills match that search</Note>;
    }
  } else {
    if (catalogStatus === 'unavailable') {
      return <Note testId="skills-browse-catalog-unavailable">Search skills.sh to find a skill to install</Note>;
    }
    if (rows.available.length === 0 && rows.installed.length === 0) {
      return <Note testId="skills-browse-catalog-empty">The registry returned no skills</Note>;
    }
  }

  return <>{rows.available.map(renderRow)}</>;
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-0.5">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} data-testid="skills-browse-skeleton" className="h-9 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function Note({ testId, children }: { testId: string; children: string }) {
  return (
    <p data-testid={testId} className="px-2 py-1.5 text-xs text-muted-foreground">
      {children}
    </p>
  );
}
