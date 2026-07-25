/**
 * SetupAdvisorSheet — presentational Setup Advisor body. Props-driven so
 * SetupAdvisorHost owns nav/data (open state, fetch, cross-project copy
 * ledger) and this owns layout/local UI: the active category tab and per-row
 * copy-failure flashes. Copy state is not mirrored here — `onCopy` fires only
 * on a successful clipboard write, and the host feeds the result back down as
 * `copiedIds` (per-row) and `copiedCount` (the footer's report-scoped total).
 */
import { useEffect, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutomationRecommendation, RecommendationCategory, SetupAdvisorReport } from '@qlan-ro/mainframe-types';
import { firstPresentCategory } from './categories';
import { payloadFooterText } from './payload';
import { EvidenceDisclosure } from './EvidenceDisclosure';
import { CategoryTabs } from './CategoryTabs';
import { RecommendationRow } from './RecommendationRow';

/** Scopes the claim to our detection: a short list can equally mean we missed something. */
const THIN_NOTE = 'We detected only a few signals here, so the list is short.';

interface SetupAdvisorSheetProps {
  report: SetupAdvisorReport | null;
  loading: boolean;
  error: string | null;
  projectName: string;
  copiedIds: ReadonlySet<string>;
  /** Copied ids intersected with the current report — the store's `selectCopiedCount`. */
  copiedCount: number;
  onCopy: (recId: string) => void;
  onRetry: () => void;
}

function Header({ projectName }: { projectName: string }) {
  return (
    <div className="flex items-center gap-2 px-4 pb-3 pt-4">
      <ScanSearch size={16} className="text-muted-foreground" />
      <span className="text-heading font-semibold text-foreground">Setup Advisor</span>
      <span className="font-normal text-muted-foreground">{projectName}</span>
    </div>
  );
}

function LoadingBody() {
  return (
    <div data-testid="automation-recommender-loading" className="px-4 pb-4">
      <p className="mb-3 text-body text-muted-foreground">Fingerprinting your project…</p>
      <div className="mb-3 h-8 animate-pulse rounded-md bg-muted" />
      <div className="h-16 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

function ErrorBody({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="px-4 pb-4">
      <p className="text-body font-medium text-foreground">Couldn&apos;t analyze this project.</p>
      <p className="mt-1 text-caption text-muted-foreground">{error}</p>
      <button
        type="button"
        data-testid="automation-recommender-retry"
        onClick={onRetry}
        className="mt-3 rounded-md bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground"
      >
        Try again
      </button>
    </div>
  );
}

function Footer({ done, total, rows }: { done: number; total: number; rows: AutomationRecommendation[] }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-caption">
      <span className="text-muted-foreground">{payloadFooterText(rows)}</span>
      <span className={cn('tabular-nums', done > 0 ? 'text-mf-success' : 'text-muted-foreground')}>
        {done} of {total} copied
      </span>
    </div>
  );
}

export function SetupAdvisorSheet({
  report,
  loading,
  error,
  projectName,
  copiedIds,
  copiedCount,
  onCopy,
  onRetry,
}: SetupAdvisorSheetProps) {
  const recommendations = report?.recommendations ?? [];
  const [activeCategory, setActiveCategory] = useState<RecommendationCategory>(() =>
    firstPresentCategory(recommendations),
  );

  useEffect(() => {
    setActiveCategory(firstPresentCategory(recommendations));
  }, [recommendations]);

  const isEmpty = report != null && recommendations.length === 0;
  const isThin = report != null && report.fingerprint.signals.length < 3;
  const activeRows = recommendations.filter((rec) => rec.category === activeCategory);

  return (
    <div data-testid="automation-recommender-sheet">
      <Header projectName={projectName} />

      {loading && <LoadingBody />}
      {!loading && error && <ErrorBody error={error} onRetry={onRetry} />}

      {!loading && !error && report && (
        <>
          <div className="px-4 pb-3">
            <EvidenceDisclosure signals={report.fingerprint.signals} />
            {isThin && <p className="mt-2 text-caption text-muted-foreground">{THIN_NOTE}</p>}
          </div>

          {isEmpty ? (
            <p className="px-4 pb-4 text-body text-muted-foreground">No recommendations for this project yet.</p>
          ) : (
            <>
              <CategoryTabs recommendations={recommendations} active={activeCategory} onSelect={setActiveCategory} />
              <div className="max-h-[380px] divide-y divide-border/60 overflow-y-auto">
                {activeRows.map((rec: AutomationRecommendation) => (
                  <RecommendationRow
                    key={rec.id}
                    rec={rec}
                    copied={copiedIds.has(rec.id)}
                    onCopied={() => onCopy(rec.id)}
                  />
                ))}
              </div>
            </>
          )}

          {!isEmpty && <Footer done={copiedCount} total={recommendations.length} rows={activeRows} />}
        </>
      )}
    </div>
  );
}
