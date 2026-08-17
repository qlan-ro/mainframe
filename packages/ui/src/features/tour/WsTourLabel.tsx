/**
 * WsTourLabel — the light label card rendered beside the spotlight cut-out.
 *
 * Rendered as absolute-positioned child inside the portal root; caller
 * supplies the style object with {top, left, transform?}.
 */
import type { CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import type { TourStep } from './steps';

interface WsTourLabelProps {
  step: TourStep;
  idx: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  style: CSSProperties;
}

export function WsTourLabel({ step, idx, total, onBack, onNext, style }: WsTourLabelProps) {
  const isLast = idx === total - 1;

  return (
    <div className="absolute w-[268px] z-[3] pointer-events-auto" style={style} data-testid="tour-label-card">
      <div
        className="bg-card border-[0.5px] border-border rounded-[13px]"
        style={{
          padding: '14px 15px 13px',
          boxShadow: 'var(--mf-shadow-pop)',
        }}
      >
        {/* Header row */}
        <div className="flex items-center gap-[7px] mb-[8px]">
          <span className="inline-flex w-[20px] h-[20px] rounded-[6px] bg-primary/12 text-primary items-center justify-center">
            <Sparkles size={12} />
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            Step {idx + 1} of {total}
          </span>
        </div>

        {/* Title */}
        <div className="text-base font-semibold text-foreground" style={{ letterSpacing: '-0.15px' }}>
          {step.title}
        </div>

        {/* Body */}
        <div className="text-xs text-muted-foreground mt-[5px] leading-normal">{step.body}</div>

        {/* Footer */}
        <div className="flex items-center gap-[8px] mt-[13px]">
          {/* Step dot rail */}
          <div className="flex gap-[5px] flex-1">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                data-testid={`tour-step-dot-${i}`}
                className={`inline-block h-1.5 rounded-[4px] transition-all duration-200 ${
                  i === idx ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/50'
                }`}
              />
            ))}
          </div>

          {/* Back button — only when not at first step */}
          {idx > 0 && (
            <button
              data-testid="tour-back-btn"
              onClick={onBack}
              className="h-[28px] px-[12px] rounded-[8px] border-[0.5px] border-border bg-card text-muted-foreground text-xs font-medium"
            >
              Back
            </button>
          )}

          {/* Next / Done button */}
          <button
            data-testid="tour-next-btn"
            onClick={onNext}
            className="h-[28px] px-[14px] rounded-[8px] bg-primary text-primary-foreground text-xs font-semibold"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
