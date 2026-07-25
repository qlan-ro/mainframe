/**
 * SetupAdvisorSheet — presentational Setup Advisor body. Props-driven so
 * SetupAdvisorHost owns nav/data (open state, fetch, cross-project copy
 * ledger) and this owns layout/local UI: the active category tab, a
 * per-project copy set seeded from `copiedIds`, and per-row copy-failure
 * flashes. `onCopy` fires only on a successful clipboard write.
 */
import { useEffect, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutomationRecommendation, RecommendationCategory, SetupAdvisorReport } from '@qlan-ro/mainframe-types';
import { CATEGORY_FOOTER_TEXT, firstPresentCategory } from './categories';
import { EvidenceDisclosure } from './EvidenceDisclosure';
import { CategoryTabs } from './CategoryTabs';
import { RecommendationRow } from './RecommendationRow';

const THIN_NOTE =
  "Recommendations are sparse because little was detected — there's genuinely not much to automate yet.";

interface SetupAdvisorSheetProps {
  report: SetupAdvisorReport | null;
  loading: boolean;
  error: string | null;
  projectName: string;
  copiedIds: Set<string>;
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

function Footer({ done, total, category }: { done: number; total: number; category: RecommendationCategory }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-caption">
      <span className="text-muted-foreground">{CATEGORY_FOOTER_TEXT[category]}</span>
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
  copiedIds: copiedIdsProp,
  onCopy,
  onRetry,
}: SetupAdvisorSheetProps) {
  const recommendations = report?.recommendations ?? [];
  const [activeCategory, setActiveCategory] = useState<RecommendationCategory>(() =>
    firstPresentCategory(recommendations),
  );
  const [copiedIds, setCopiedIds] = useState<Set<string>>(() => new Set(copiedIdsProp));

  useEffect(() => {
    setActiveCategory(firstPresentCategory(recommendations));
  }, [recommendations]);

  useEffect(() => {
    setCopiedIds(new Set(copiedIdsProp));
  }, [copiedIdsProp]);

  const isEmpty = report != null && recommendations.length === 0;
  const isThin = report != null && report.fingerprint.signals.length < 3;
  const reportIds = new Set(recommendations.map((rec) => rec.id));
  const done = [...copiedIds].filter((id) => reportIds.has(id)).length;
  const activeRows = recommendations.filter((rec) => rec.category === activeCategory);

  function handleCopied(recId: string) {
    setCopiedIds((prev) => new Set(prev).add(recId));
    onCopy(recId);
  }

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
                    onCopied={() => handleCopied(rec.id)}
                  />
                ))}
              </div>
            </>
          )}

          {!isEmpty && <Footer done={done} total={recommendations.length} category={activeCategory} />}
        </>
      )}
    </div>
  );
}
