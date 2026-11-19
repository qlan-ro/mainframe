import { LayersIcon } from 'lucide-react';
import type { CompactionMetadata } from '@qlan-ro/mainframe-types';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { Hint } from '@/components/ui/hint';

const tokenFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function IdleCompactionMarker({ messageId, compaction }: { messageId: string; compaction: CompactionMetadata }) {
  const { beforeTokens, afterTokens } = compaction;
  return (
    <Hint side="top" label="Compacted before the prompt cache expired, so returning to this chat is cheaper.">
      <Marker variant="separator" data-testid={`idle-compaction-${messageId}`} className="my-2 select-none">
        <MarkerIcon>
          <LayersIcon />
        </MarkerIcon>
        <MarkerContent>
          Compacted while idle
          {beforeTokens !== undefined && afterTokens !== undefined && (
            <span className="text-muted-foreground/60">
              {' · '}
              {tokenFormat.format(beforeTokens).toLowerCase()} → {tokenFormat.format(afterTokens).toLowerCase()} tokens
            </span>
          )}
        </MarkerContent>
      </Marker>
    </Hint>
  );
}
