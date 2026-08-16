/**
 * TutorialOverlay — first-run spotlight coachmark tour.
 *
 * Portals to <body> as a fixed full-viewport layer (z-11500).
 * Measures [data-tut] anchors via getBoundingClientRect so it works
 * correctly under any CSS transform (ZoomStage, etc.).
 *
 * The step list is not fixed: `resolveTourPlan` fits it to the anchors actually
 * on screen when the tour opens (see steps.ts). The plan is resolved ONCE and
 * frozen, because the overlay's click-catcher blocks the app underneath — no
 * anchor can appear or vanish while the user walks the tour.
 *
 * Only renders when useTutorialStore().completed === false.
 * Navigation is purely button-driven (Next/Back/Skip/Done).
 */
import { useEffect, useState, useCallback, useRef, CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import { useTutorialStore } from '@/store/tutorial';
import { resolveTourPlan, type TourStep } from './steps';
import { WsTourLabel } from './WsTourLabel';

/** One retry, for a tour resumed from a persisted step before the app paints. */
const RESOLVE_RETRY_MS = 120;

const domHasAnchor = (target: string) => document.querySelector(`[data-tut="${target}"]`) != null;

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const LW = 268;
const GAP = 18;

// Clamps the label card's left edge between the viewport's left and right
// edges (falls back to the left clamp alone if the viewport is narrower than
// the card, so the card never reports a left more restrictive than 8px).
export function clampLabelLeft(left: number, viewportWidth: number): number {
  const maxLeft = Math.max(8, viewportWidth - LW - 8);
  return Math.min(Math.max(8, left), maxLeft);
}

export function computeLabelStyle(rect: TargetRect, side: TourStep['side']): CSSProperties {
  const h = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    w: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
  const viewportWidth = window.innerWidth;
  if (side === 'right') {
    return { top: Math.max(8, h.top), left: clampLabelLeft(h.left + h.w + GAP, viewportWidth) };
  }
  // Left, for anchors pinned to the window's right edge (the session rail):
  // 'right' would clamp the card back on top of the very thing it describes.
  if (side === 'left') {
    return { top: Math.max(8, h.top), left: clampLabelLeft(h.left - GAP - LW, viewportWidth) };
  }
  if (side === 'above') {
    return {
      top: h.top - GAP,
      left: clampLabelLeft(h.left + h.w / 2 - LW / 2, viewportWidth),
      transform: 'translateY(-100%)',
    };
  }
  // below
  return {
    top: h.top + h.height + GAP,
    left: clampLabelLeft(h.left + h.w / 2 - LW / 2, viewportWidth),
  };
}

/**
 * The accent ring + pulsing halo drawn over one anchor. `scrim` adds the
 * full-viewport dim, so exactly one ring per step may carry it — the dim is
 * this element's own outward box-shadow, and a second would cover the first.
 */
function SpotlightRing({ rect, testId, scrim }: { rect: TargetRect; testId: string; scrim?: boolean }) {
  return (
    <div
      data-testid={testId}
      className="absolute z-[2] pointer-events-none rounded-[8px]"
      style={{
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
        boxShadow: scrim === true ? '0 0 0 9999px var(--mf-scrim)' : undefined,
        outline: '2px solid var(--primary)',
        outlineOffset: 2,
        transition:
          'top 0.28s cubic-bezier(0.22,1,0.36,1), left 0.28s cubic-bezier(0.22,1,0.36,1), width 0.28s, height 0.28s',
      }}
    >
      {/* Inner halo — twPulse keyframe defined in domain-tokens.css */}
      <div
        className="absolute inset-[-2px] rounded-[8px] animate-[twPulse_1.8s_ease-in-out_infinite]"
        style={{ boxShadow: '0 0 0 4px color-mix(in srgb, var(--primary) 18%, transparent)' }}
      />
    </div>
  );
}

function measureAnchor(target: string): TargetRect | null {
  const el = document.querySelector<HTMLElement>(`[data-tut="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function WsTourCore({ plan }: { plan: TourStep[] }) {
  const { step, next, back, skip, complete } = useTutorialStore();
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [ghosts, setGhosts] = useState<TargetRect[]>([]);
  // A step persisted from an earlier run can outlive the plan it was recorded
  // against — a shorter plan today must not index off its end.
  const idx = Math.min(step, plan.length - 1);
  const currentStep = plan[idx];
  // Tracks which way the user was navigating, so an un-anchorable step gets
  // auto-skipped in that same direction rather than always forward.
  const directionRef = useRef<'forward' | 'backward'>('forward');

  const remeasure = useCallback(() => {
    setRect(currentStep ? measureAnchor(currentStep.target) : null);
    setGhosts(
      (currentStep?.also ?? []).map((target) => measureAnchor(target)).filter((r): r is TargetRect => r != null),
    );
  }, [currentStep]);

  useEffect(() => {
    remeasure();
    window.addEventListener('resize', remeasure);
    const id = setTimeout(() => {
      remeasure();
      // Safety net, no longer the normal path: the plan only holds steps that
      // were anchorable when the tour opened, so this fires only if an anchor
      // disappears mid-tour (a resize collapsing the sidebar, say). Rather than
      // leave the label card floating with no spotlight, skip the step in the
      // direction of travel.
      if (currentStep && !domHasAnchor(currentStep.target)) {
        if (directionRef.current === 'backward') back();
        else next();
      }
    }, 30);
    return () => {
      window.removeEventListener('resize', remeasure);
      clearTimeout(id);
    };
  }, [remeasure, currentStep, back, next]);

  if (!currentStep) return null;

  const isLast = idx === plan.length - 1;

  const handleNext = () => {
    directionRef.current = 'forward';
    if (isLast) {
      complete();
    } else {
      next();
    }
  };

  const handleBack = () => {
    directionRef.current = 'backward';
    back();
  };

  const labelStyle = rect ? computeLabelStyle(rect, currentStep.side) : { opacity: 0 };

  return (
    <>
      {/* Click-catcher: blocks the dimmed app behind */}
      <div className="absolute inset-0 z-[1] pointer-events-auto" style={{ cursor: 'default' }} />

      {/* Spotlight cut-out with accent ring + halo */}
      {rect && <SpotlightRing rect={rect} testId="tour-spotlight" scrim />}

      {/* Secondary locations for the same affordance: ring only. A second scrim
          would paint its own 9999px shadow straight over the primary cut-out. */}
      {ghosts.map((ghost, i) => (
        <SpotlightRing key={`${ghost.top}-${ghost.left}`} rect={ghost} testId={`tour-spotlight-also-${i}`} />
      ))}

      {/* Label card */}
      <WsTourLabel
        step={currentStep}
        idx={idx}
        total={plan.length}
        onBack={handleBack}
        onNext={handleNext}
        style={labelStyle}
      />

      {/* Skip button */}
      <button
        data-testid="tour-skip-btn"
        onClick={skip}
        className="absolute bottom-[16px] right-[18px] z-[3] pointer-events-auto rounded-[8px] border-[0.5px] border-border py-[6px] px-[12px] text-muted-foreground text-xs font-medium"
        style={{
          background: 'var(--popover)',
          boxShadow: 'var(--mf-shadow-pop)',
        }}
      >
        Skip tour
      </button>
    </>
  );
}

/**
 * Resolves the step plan once, against the anchors on screen. Returns null
 * until a non-empty plan exists — the caller must render nothing meanwhile,
 * since the overlay's click-catcher would otherwise block the whole app behind
 * an invisible layer.
 */
function useTourPlan(enabled: boolean): TourStep[] | null {
  const [plan, setPlan] = useState<TourStep[] | null>(null);

  useEffect(() => {
    if (!enabled || plan != null) return;
    const resolve = () => {
      const resolved = resolveTourPlan(domHasAnchor);
      if (resolved.length > 0) setPlan(resolved);
    };
    resolve();
    const id = setTimeout(resolve, RESOLVE_RETRY_MS);
    return () => clearTimeout(id);
  }, [enabled, plan]);

  return plan;
}

export function TutorialOverlay() {
  const completed = useTutorialStore((s) => s.completed);
  // Nothing anchorable means nothing to point at. Show no tour rather than
  // completing it — a transient miss would otherwise burn a real first run.
  const plan = useTourPlan(!completed);

  if (completed || plan == null) return null;

  return ReactDOM.createPortal(
    <div data-testid="tour-overlay" className="fixed inset-0 z-[11500] pointer-events-none">
      <div className="absolute inset-0 pointer-events-auto">
        <WsTourCore plan={plan} />
      </div>
    </div>,
    document.body,
  );
}
