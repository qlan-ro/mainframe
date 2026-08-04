/**
 * SetupAdvisorSheet — presentational Setup Advisor body, rendered as the flex
 * children of the host's DialogContent column (header and dialog chrome live
 * in SetupAdvisorHost). Props-driven so the host owns nav/data (open state,
 * fetch, cross-project copy ledger) and this owns layout/local UI: the active
 * category tab and per-row copy-failure flashes. Copy state is not mirrored
 * here — `onCopy` fires only on a successful clipboard write, and the host
 * feeds the result back down as `copiedIds` (per-row) and `copiedCount` (the
 * footer's report-scoped total).
 */
import { Button } from '@v2/components/ui/button';
import { useEffect, useState } from 'react';
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
  copiedIds: ReadonlySet<string>;
  /** Copied ids intersected with the current report — the store's `selectCopiedCount`. */
  copiedCount: number;
  onCopy: (recId: string) => void;
  onRetry: () => void;
}

function LoadingBody() {
  return (
    <div data-testid="automation-recommender-loading" className="p-4">
      <p className="mb-3 text-body text-muted-foreground">Fingerprinting your project…</p>
      <div className="mb-3 h-8 animate-pulse rounded-md bg-muted" />
      <div className="h-16 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

function ErrorBody({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="p-4">
      <p className="text-body font-medium text-foreground">Couldn&apos;t analyze this project.</p>
      <p className="mt-1 text-caption text-muted-foreground">{error}</p>
      <Button size="sm" className="mt-3" data-testid="automation-recommender-retry" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function Footer({ done, total, rows }: { done: number; total: number; rows: AutomationRecommendation[] }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2.5 text-caption">
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
    <>
      {loading && <LoadingBody />}
      {!loading && error && <ErrorBody error={error} onRetry={onRetry} />}

      {!loading && !error && report && (
        <>
          <div className="shrink-0 px-4 py-3">
            <EvidenceDisclosure signals={report.fingerprint.signals} />
            {isThin && <p className="mt-2 text-caption text-muted-foreground">{THIN_NOTE}</p>}
          </div>

          {isEmpty ? (
            <p className="px-4 pb-4 text-body text-muted-foreground">No recommendations for this project yet.</p>
          ) : (
            <>
              <CategoryTabs recommendations={recommendations} active={activeCategory} onSelect={setActiveCategory} />
              <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
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
    </>
  );
}
