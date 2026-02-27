import { useEffect, useState, useCallback } from 'react';
import { useTutorialStore } from '../store/tutorial';
import { useProjectsStore, useChatsStore } from '../store';
import { useTabsStore } from '../store/tabs';

interface StepConfig {
  target: string;
  title: string;
  description: string;
  labelSide: 'right' | 'above';
  requiresAction?: boolean;
}

const STEPS: StepConfig[] = [
  {
    target: 'step-1',
    title: 'Add a project',
    description: 'Click here to add your first project',
    labelSide: 'right',
    requiresAction: true,
  },
  {
    target: 'step-2',
    title: 'Start a session',
    description: 'Open a new conversation with your AI agent',
    labelSide: 'right',
    requiresAction: true,
  },
  {
    target: 'step-3',
    title: 'Chat with your agent',
    description: 'Type a task and press Enter to begin',
    labelSide: 'above',
  },
  {
    target: 'step-4',
    title: 'Select a provider',
    description: 'Choose your AI provider — Claude Code, Codex, or Gemini — then start chatting.',
    labelSide: 'above',
  },
];

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 2;

export function TutorialOverlay() {
  const { completed, step, nextStep, skip, complete } = useTutorialStore();
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const stepConfig = STEPS[step - 1];

  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const chats = useChatsStore((s) => s.chats);
  const messages = useChatsStore((s) => s.messages);
  const activePrimaryTabId = useTabsStore((s) => s.activePrimaryTabId);
  const tabs = useTabsStore((s) => s.tabs);

  // Step 1 → 2: a project was added
  useEffect(() => {
    if (step === 1 && projects.length > 0) nextStep();
  }, [step, projects.length, nextStep]);

  // Step 2 → 3: a chat was created for the active project
  useEffect(() => {
    if (step === 2 && activeProjectId) {
      if (chats.some((c) => c.projectId === activeProjectId)) nextStep();
    }
  }, [step, chats, activeProjectId, nextStep]);

  // Step 3 → 4: no auto-advance (Next → button only; composer is already visible after step 2)

  // Step 4 → complete: first message sent in the active chat
  useEffect(() => {
    if (step === 4 && activePrimaryTabId) {
      const activeTab = tabs.find((t) => t.id === activePrimaryTabId);
      if (activeTab && (messages.get(activeTab.chatId) ?? []).length > 0) complete();
    }
  }, [step, activePrimaryTabId, tabs, messages, complete]);

  const [modalOpen, setModalOpen] = useState(false);

  const measureTarget = useCallback(() => {
    if (!stepConfig) {
      setRect(null);
      return;
    }
    // Hide tutorial when a modal overlay is visible
    const hasModal = document.querySelector('[data-testid="dir-picker-modal"], [data-testid="settings-modal"]');
    setModalOpen(!!hasModal);

    const el = document.querySelector(`[data-tutorial="${stepConfig.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [stepConfig]);

  useEffect(() => {
    measureTarget();
    window.addEventListener('resize', measureTarget);
    // Re-measure when DOM changes (modals opening/closing)
    const observer = new MutationObserver(measureTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener('resize', measureTarget);
      observer.disconnect();
    };
  }, [measureTarget]);

  if (completed || !stepConfig || !rect || modalOpen) return null;

  const holeTop = rect.top - PAD;
  const holeLeft = rect.left - PAD;
  const holeWidth = rect.width + PAD * 2;
  const holeHeight = rect.height + PAD * 2;
  const holeCenterX = holeLeft + holeWidth / 2;
  const holeCenterY = holeTop + holeHeight / 2;

  const labelWidth = 220;
  const labelHeight = 90;
  let labelTop: number;
  let labelLeft: number;
  let arrowPath: string;

  const EDGE_PAD = 12;
  if (stepConfig.labelSide === 'right') {
    labelLeft = holeLeft + holeWidth + 48;
    labelTop = Math.max(EDGE_PAD, holeCenterY - labelHeight / 2);
    const ax1 = labelLeft;
    const ay1 = labelTop + labelHeight / 2;
    const ax2 = holeLeft + holeWidth;
    const ay2 = holeCenterY;
    arrowPath = `M ${ax1} ${ay1} C ${ax1 - 30} ${ay1}, ${ax2 + 30} ${ay2}, ${ax2} ${ay2}`;
  } else {
    labelLeft = holeCenterX - labelWidth / 2;
    labelTop = Math.max(EDGE_PAD, holeTop - labelHeight - 56);
    const ax1 = labelLeft + labelWidth / 2;
    const ay1 = labelTop + labelHeight;
    const ax2 = holeCenterX;
    const ay2 = holeTop;
    arrowPath = `M ${ax1} ${ay1} C ${ax1} ${ay1 + 20}, ${ax2} ${ay2 - 20}, ${ax2} ${ay2}`;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
      {/* Outline ring around target element */}
      <div
        style={{
          position: 'fixed',
          top: holeTop,
          left: holeLeft,
          width: holeWidth,
          height: holeHeight,
          borderRadius: 6,
          outline: '2px solid rgba(249,115,22,0.6)',
          outlineOffset: 0,
          transition: 'top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease',
          zIndex: 9998,
          pointerEvents: 'none',
        }}
      />

      {/* SVG curved arrow */}
      <svg
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10000 }}
        overflow="visible"
      >
        <path
          d={arrowPath}
          fill="none"
          stroke="#f97316"
          strokeWidth="2"
          strokeLinecap="round"
          markerEnd="url(#arrowhead)"
        />
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#f97316" />
          </marker>
        </defs>
      </svg>

      {/* Label card */}
      <div
        style={{
          position: 'fixed',
          top: labelTop,
          left: labelLeft,
          width: labelWidth,
          zIndex: 10001,
          pointerEvents: 'all',
        }}
      >
        <div
          style={{
            background: 'rgba(24,24,27,0.95)',
            border: '1px solid rgba(249,115,22,0.4)',
            borderRadius: 8,
            padding: '12px 14px',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              color: '#f97316',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}
          >
            Step {step} of {STEPS.length}
          </div>
          <div style={{ color: '#fafafa', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{stepConfig.title}</div>
          <div style={{ color: '#a1a1aa', fontSize: 12, lineHeight: 1.5 }}>{stepConfig.description}</div>
          {!stepConfig.requiresAction && (
            <button
              onClick={nextStep}
              style={{
                marginTop: 10,
                background: '#f97316',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {step < STEPS.length ? 'Next →' : 'Done'}
            </button>
          )}
        </div>
      </div>

      {/* Skip link */}
      <button
        onClick={skip}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          background: 'transparent',
          border: 'none',
          color: '#71717a',
          fontSize: 12,
          cursor: 'pointer',
          textDecoration: 'underline',
          zIndex: 10001,
          pointerEvents: 'all',
        }}
      >
        Skip tutorial
      </button>
    </div>
  );
}
