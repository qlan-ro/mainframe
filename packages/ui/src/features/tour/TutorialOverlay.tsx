/**
 * TutorialOverlay — first-run spotlight coachmark tour.
 *
 * Portals to <body> as a fixed full-viewport layer (z-11500).
 * Measures [data-tut] anchors via getBoundingClientRect so it works
 * correctly under any CSS transform (ZoomStage, etc.).
 *
 * Only renders when useTutorialStore().completed === false.
 * Navigation is purely button-driven (Next/Back/Skip/Done).
 */
import { useEffect, useState, useCallback, CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import { useTutorialStore } from '@/store/tutorial';
import { WsTourLabel } from './WsTourLabel';

interface TourStep {
  target: string;
  side: 'right' | 'above' | 'below';
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    target: 'sessions',
    side: 'right',
    title: 'Start a session',
    body: 'Spin up a fresh agent session for any project. Every task gets its own conversation and worktree.',
  },
  {
    target: 'composer',
    side: 'above',
    title: 'Hand work to your agent',
    body: 'Describe a task in plain language and press ⏎. Mainframe plans, edits across your repo, and runs commands for you.',
  },
  {
    target: 'model',
    side: 'above',
    title: 'Pick your model',
    body: 'Claude, Codex, or Gemini — choose per session. The provider locks once the conversation starts.',
  },
  {
    target: 'run',
    side: 'below',
    title: 'Run & preview',
    body: 'Launch a dev server and preview your app live, right beside the chat. Capture the screen straight back into context.',
  },
];

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const LW = 268;
const GAP = 18;

function computeLabelStyle(rect: TargetRect, side: TourStep['side']): CSSProperties {
  const h = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    w: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
  if (side === 'right') {
    return { top: Math.max(8, h.top), left: h.left + h.w + GAP };
  }
  if (side === 'above') {
    return {
      top: h.top - GAP,
      left: Math.max(8, h.left + h.w / 2 - LW / 2),
      transform: 'translateY(-100%)',
    };
  }
  // below
  return {
    top: h.top + h.height + GAP,
    left: Math.max(8, h.left + h.w / 2 - LW / 2),
  };
}

function WsTourCore() {
  const { step, next, back, skip, complete } = useTutorialStore();
  const [rect, setRect] = useState<TargetRect | null>(null);
  const currentStep = STEPS[step];

  const remeasure = useCallback(() => {
    if (!currentStep) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tut="${currentStep.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [currentStep]);

  useEffect(() => {
    remeasure();
    window.addEventListener('resize', remeasure);
    const id = setTimeout(remeasure, 30);
    return () => {
      window.removeEventListener('resize', remeasure);
      clearTimeout(id);
    };
  }, [remeasure]);

  if (!currentStep) return null;

  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      complete();
    } else {
      next();
    }
  };

  const labelStyle = rect ? computeLabelStyle(rect, currentStep.side) : { opacity: 0 };

  return (
    <>
      {/* Click-catcher: blocks the dimmed app behind */}
      <div className="absolute inset-0 z-[1] pointer-events-auto" style={{ cursor: 'default' }} />

      {/* Spotlight cut-out with accent ring + halo */}
      {rect && (
        <div
          data-testid="tour-spotlight"
          className="absolute z-[2] pointer-events-none rounded-[8px]"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(28,28,30,0.50)',
            outline: '2px solid var(--primary)',
            outlineOffset: 2,
            transition:
              'top 0.28s cubic-bezier(0.22,1,0.36,1), left 0.28s cubic-bezier(0.22,1,0.36,1), width 0.28s, height 0.28s',
          }}
        >
          {/* Inner halo — twPulse keyframe defined in globals.css */}
          <div
            className="absolute inset-[-2px] rounded-[8px] animate-[twPulse_1.8s_ease-in-out_infinite]"
            style={{ boxShadow: '0 0 0 4px color-mix(in srgb, var(--primary) 18%, transparent)' }}
          />
        </div>
      )}

      {/* Label card */}
      <WsTourLabel
        step={currentStep}
        idx={step}
        total={STEPS.length}
        onBack={back}
        onNext={handleNext}
        onSkip={skip}
        style={labelStyle}
      />

      {/* Skip button */}
      <button
        data-testid="tour-skip-btn"
        onClick={skip}
        className="absolute bottom-[16px] right-[18px] z-[3] pointer-events-auto rounded-[8px] border-[0.5px] border-border py-[6px] px-[12px] text-muted-foreground text-label font-medium"
        style={{
          background: 'rgba(255,255,255,0.9)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.10)',
        }}
      >
        Skip tour
      </button>
    </>
  );
}

export function TutorialOverlay() {
  const completed = useTutorialStore((s) => s.completed);

  if (completed) return null;

  return ReactDOM.createPortal(
    <div data-testid="tour-overlay" className="fixed inset-0 z-[11500] pointer-events-none">
      <div className="absolute inset-0 pointer-events-auto">
        <WsTourCore />
      </div>
    </div>,
    document.body,
  );
}
