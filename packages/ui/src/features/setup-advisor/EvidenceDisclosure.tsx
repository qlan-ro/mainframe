/**
 * Collapsed-by-default "What we detected" toggle — expands to one chip per
 * fingerprint signal. Presentational only; the thin-signals note lives in
 * SetupAdvisorSheet since it depends on the sparse threshold, not disclosure.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface EvidenceDisclosureProps {
  signals: string[];
}

export function EvidenceDisclosure({ signals }: EvidenceDisclosureProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger
        data-testid="automation-recommender-evidence-toggle"
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        What we detected ({signals.length})
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-wrap gap-1.5">
        {signals.map((signal) => (
          <Badge key={signal} variant="outline" className="text-xs font-normal text-muted-foreground">
            {signal}
          </Badge>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
