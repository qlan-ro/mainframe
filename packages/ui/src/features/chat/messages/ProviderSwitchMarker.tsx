'use client';

/**
 * ProviderSwitchMarker — the divider a provider segment opens with (a switch
 * between providers, or a fresh session on the same one). The CompactionPill
 * recipe (`Marker variant="separator"`); the
 * hint names the target model and the totals of the segment that ended.
 */
import { providerSwitchLabel, type ProviderSwitchMarker as Marker_ } from '@qlan-ro/mainframe-types';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { Hint } from '@/components/ui/hint';
import { Repeat } from 'lucide-react';
import { useAdapters } from '@/store/adapters';

const tokenFormat = new Intl.NumberFormat('en-US');

/** The hint's lines: target model, the previous segment's totals, and why a
 *  returning provider started fresh, when it did. */
export function providerSwitchHint(marker: Marker_, modelLabel: string | null): string[] {
  const lines = [modelLabel ? `${marker.toAdapterName} · ${modelLabel}` : marker.toAdapterName];
  const prev = marker.previous;
  const turns = prev.turnCount === 1 ? '1 turn' : `${prev.turnCount} turns`;
  lines.push(`${marker.fromAdapterName}: ${turns} · ${tokenFormat.format(prev.totalTokensInput)} tokens in`);
  if (marker.handoff?.fellBackToFresh) {
    lines.push(`${marker.toAdapterName}'s earlier session was too full to catch up, so a new one started.`);
  }
  return lines;
}

export function ProviderSwitchMarker({ marker }: { marker: Marker_ }) {
  const adapters = useAdapters();
  const modelLabel =
    marker.toModel == null
      ? null
      : (adapters.find((a) => a.id === marker.toAdapterId)?.models.find((m) => m.id === marker.toModel)?.label ??
        marker.toModel);
  const hint = providerSwitchHint(marker, modelLabel);
  return (
    <Hint
      side="top"
      label={
        <span className="flex flex-col gap-0.5">
          {hint.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
    >
      <Marker
        variant="separator"
        data-testid={`chat-provider-switch-marker-${marker.segmentId}`}
        className="mf-tr-divider select-none"
      >
        <MarkerIcon className="size-3">
          <Repeat data-testid={`chat-provider-switch-logo-${marker.segmentId}`} className="size-3" strokeWidth={1.5} />
        </MarkerIcon>
        <MarkerContent>{providerSwitchLabel(marker)}</MarkerContent>
      </Marker>
    </Hint>
  );
}
