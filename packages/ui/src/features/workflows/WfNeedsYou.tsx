/**
 * WfNeedsYou — inbox showing all pending workflow interactions.
 *
 * Empty state: centered "You're all caught up" with a green Check disc.
 * Non-empty: header with count + list of WfInteractionCard (first expanded).
 */
import React from 'react';
import { Check } from 'lucide-react';
import { useWorkflowsStore } from './use-workflows-store';
import { WfInteractionCard } from './WfInteractionCard';

// ── Component ─────────────────────────────────────────────────────────────────

export function WfNeedsYou({ port }: { port: number }): React.ReactElement {
  const interactions = useWorkflowsStore((s) => s.interactions);

  if (interactions.length === 0) {
    return (
      <div
        data-testid="workflows-needsyou-empty"
        className="flex h-full flex-col items-center justify-center gap-3 bg-mf-content2"
      >
        <span className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-full bg-mf-success/12">
          <Check size={26} className="text-mf-success" strokeWidth={2.2} aria-hidden />
        </span>
        <p className="text-heading font-semibold text-foreground">You're all caught up</p>
        <p className="text-label text-muted-foreground">No runs are waiting on you right now.</p>
      </div>
    );
  }

  const count = interactions.length;
  const headline = `${count} ${count === 1 ? 'run is' : 'runs are'} waiting for your answer`;

  return (
    <div data-testid="workflows-needsyou" className="h-full overflow-y-auto bg-mf-content2 px-[18px] pb-6 pt-4">
      {/* Header */}
      <p className="mb-3 text-caption text-muted-foreground">
        <span className="font-bold text-foreground">{count}</span> {count === 1 ? 'run is' : 'runs are'} waiting for
        your answer
      </p>

      {/* Interaction list */}
      <div className="flex max-w-[760px] flex-col gap-3" aria-label={headline}>
        {interactions.map((interaction, i) => (
          <WfInteractionCard key={interaction.id} port={port} interaction={interaction} defaultExpanded={i === 0} />
        ))}
      </div>
    </div>
  );
}
