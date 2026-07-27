/**
 * Collapsed-by-default "What we detected" toggle — expands to one chip per
 * fingerprint signal. Presentational only; the thin-signals note lives in
 * SetupAdvisorSheet since it depends on the sparse threshold, not disclosure.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface EvidenceDisclosureProps {
  signals: string[];
}

export function EvidenceDisclosure({ signals }: EvidenceDisclosureProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        data-testid="automation-recommender-evidence-toggle"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        What we detected ({signals.length})
      </button>
      {expanded && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {signals.map((signal) => (
            <span
              key={signal}
              className="rounded-full border border-border bg-mf-glass px-2 py-0.5 text-caption text-muted-foreground"
            >
              {signal}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
