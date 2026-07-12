/**
 * BlankState — the two creation paths shown when the library is empty (spec
 * §10): "Describe it" (natural language → drafted blocks, Phase 5, gated
 * behind `DESCRIBE_ENABLED`) and "Build it" (straight to the editor).
 *
 * Deviates from the ts153 prototype's violet accent for "Build it": that hue
 * lived on the v1 `--mf-wf-violet` token slated for deletion in UI Phase 7
 * (plan §"Deletion inventory"), and introducing a new global token is out of
 * this phase's scope. "Build it" uses a neutral/foreground treatment instead
 * of a second brand hue.
 */
import React from 'react';
import { ChevronRight, SlidersHorizontal, Wand2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreationCardProps {
  testId: string;
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  accent: 'primary' | 'neutral';
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
}

function CreationCard({
  testId,
  icon: Icon,
  accent,
  title,
  body,
  cta,
  onClick,
  disabled,
}: CreationCardProps): React.ReactElement {
  const tint = accent === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground';
  const ctaColor = accent === 'primary' ? 'text-primary' : 'text-foreground';
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-1 flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left shadow-[var(--mf-shadow-card)]',
        'transition-colors hover:border-primary/40 hover:shadow-[var(--mf-shadow-card-hover)]',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border disabled:hover:shadow-[var(--mf-shadow-card)]',
      )}
    >
      <span className={cn('inline-flex size-[42px] items-center justify-center rounded-lg', tint)}>
        <Icon size={20} aria-hidden />
      </span>
      <span className="text-heading font-bold tracking-tight text-foreground">{title}</span>
      <span className="flex-1 text-label leading-normal text-muted-foreground">{body}</span>
      <span className={cn('inline-flex items-center gap-1.5 text-label font-semibold', ctaColor)}>
        {cta}
        <ChevronRight size={13} aria-hidden />
      </span>
    </button>
  );
}

interface BlankStateProps {
  onDescribe: () => void;
  onBuild: () => void;
  describeEnabled: boolean;
}

export function BlankState({ onDescribe, onBuild, describeEnabled }: BlankStateProps): React.ReactElement {
  return (
    <div data-testid="automations-blank-state" className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <div className="mx-auto mb-3 inline-flex size-[52px] items-center justify-center rounded-xl bg-primary/10">
          <Zap size={26} className="text-primary" aria-hidden />
        </div>
        <div className="text-title font-bold tracking-tight text-foreground">Create a workflow</div>
        <div className="mt-1 text-body text-muted-foreground">Automate the repetitive parts of your day.</div>
      </div>
      <div className="flex w-full max-w-[620px] gap-4">
        <CreationCard
          testId="automations-blank-describe"
          icon={Wand2}
          accent="primary"
          title="Describe it"
          body="Say what you want in plain English. I'll draft the When and Do steps — you tweak from there."
          cta="Describe"
          onClick={onDescribe}
          disabled={!describeEnabled}
        />
        <CreationCard
          testId="automations-blank-build"
          icon={SlidersHorizontal}
          accent="neutral"
          title="Build it"
          body="Start from a trigger and add steps yourself from the menu and action catalog."
          cta="Build"
          onClick={onBuild}
        />
      </div>
    </div>
  );
}
