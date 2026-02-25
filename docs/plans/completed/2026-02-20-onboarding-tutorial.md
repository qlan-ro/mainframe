# Onboarding Tutorial Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 3-step first-run spotlight overlay tutorial that guides users to add a project, start a session, and send a message.

**Architecture:** A `useTutorialStore` Zustand persisted store tracks completion state. A `TutorialOverlay` component renders a full-screen dark overlay with a spotlight hole around each target element, a label card, and an SVG arrow. Target elements are identified via `data-tutorial="step-N"` attributes. The overlay auto-advances by watching relevant Zustand stores for state changes (project added, chat created, message sent).

**Tech Stack:** React, Zustand (with persist middleware), Vitest, CSS box-shadow for spotlight cutout, inline SVG for arrows.

---

### Task 1: Create `useTutorialStore`

**Files:**
- Create: `packages/desktop/src/renderer/store/tutorial.ts`
- Create: `packages/desktop/src/renderer/store/tutorial.test.ts`

**Step 1: Write the failing test**

Create `packages/desktop/src/renderer/store/tutorial.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useTutorialStore } from './tutorial';

describe('useTutorialStore', () => {
  beforeEach(() => {
    useTutorialStore.setState({ completed: false, step: 1 });
  });

  it('starts with step 1 and not completed', () => {
    const state = useTutorialStore.getState();
    expect(state.step).toBe(1);
    expect(state.completed).toBe(false);
  });

  it('nextStep increments step', () => {
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().step).toBe(2);
  });

  it('nextStep on last step calls complete', () => {
    useTutorialStore.setState({ step: 3 });
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().completed).toBe(true);
  });

  it('skip sets completed to true', () => {
    useTutorialStore.getState().skip();
    expect(useTutorialStore.getState().completed).toBe(true);
  });

  it('complete sets completed to true', () => {
    useTutorialStore.getState().complete();
    expect(useTutorialStore.getState().completed).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @mainframe/desktop test -- tutorial.test
```
Expected: FAIL — `Cannot find module './tutorial'`

**Step 3: Create the store**

Create `packages/desktop/src/renderer/store/tutorial.ts`:

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const TOTAL_STEPS = 3;

interface TutorialState {
  completed: boolean;
  step: number; // 1-indexed
  nextStep: () => void;
  complete: () => void;
  skip: () => void;
}

export const useTutorialStore = create<TutorialState>()(
  persist(
    (set, get) => ({
      completed: false,
      step: 1,
      nextStep: () => {
        const { step } = get();
        if (step >= TOTAL_STEPS) {
          set({ completed: true });
        } else {
          set({ step: step + 1 });
        }
      },
      complete: () => set({ completed: true }),
      skip: () => set({ completed: true }),
    }),
    { name: 'mf:tutorial' }
  )
);
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @mainframe/desktop test -- tutorial.test
```
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/store/tutorial.ts packages/desktop/src/renderer/store/tutorial.test.ts
git commit -m "feat(desktop): add useTutorialStore for onboarding tutorial"
```

---

### Task 2: Add `data-tutorial` attributes to target elements

**Files:**
- Modify: `packages/desktop/src/renderer/components/ProjectRail.tsx:132`
- Modify: `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx:79`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx:186`

No tests needed — these are DOM attribute additions.

**Step 1: ProjectRail — add `data-tutorial="step-1"` to the "+" button**

File: `packages/desktop/src/renderer/components/ProjectRail.tsx`, lines 132–139.

Find this button (the Add Project button with `Plus` icon inside the project list):
```tsx
        <button
          onClick={handleAddProject}
          className="w-8 h-8 flex items-center justify-center shrink-0 rounded-mf-card text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg transition-colors"
          title="Add Project"
          aria-label="Add project"
        >
```

Add `data-tutorial="step-1"` to it:
```tsx
        <button
          data-tutorial="step-1"
          onClick={handleAddProject}
          className="w-8 h-8 flex items-center justify-center shrink-0 rounded-mf-card text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg transition-colors"
          title="Add Project"
          aria-label="Add project"
        >
```

**Step 2: ChatsPanel — add `data-tutorial="step-2"` to the New Session button**

File: `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx`, lines 79–87.

Find:
```tsx
        <button
          onClick={() => createChat('claude')}
          disabled={!activeProjectId}
          className="w-7 h-7 rounded-mf-input flex items-center justify-center text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="New Session"
          aria-label="New session"
        >
```

Add `data-tutorial="step-2"`:
```tsx
        <button
          data-tutorial="step-2"
          onClick={() => createChat('claude')}
          disabled={!activeProjectId}
          className="w-7 h-7 rounded-mf-input flex items-center justify-center text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="New Session"
          aria-label="New session"
        >
```

**Step 3: ComposerCard — add `data-tutorial="step-3"` to the input wrapper div**

File: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx`, line 186.

Find:
```tsx
      <div className="relative">
        <ComposerHighlight />
        <ComposerPrimitive.Input
```

Add `data-tutorial="step-3"` to the wrapper div:
```tsx
      <div className="relative" data-tutorial="step-3">
        <ComposerHighlight />
        <ComposerPrimitive.Input
```

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/ProjectRail.tsx \
        packages/desktop/src/renderer/components/panels/ChatsPanel.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx
git commit -m "feat(desktop): add data-tutorial attributes for onboarding overlay anchors"
```

---

### Task 3: Create `TutorialOverlay` component

**Files:**
- Create: `packages/desktop/src/renderer/components/TutorialOverlay.tsx`

This component reads `useTutorialStore`, finds the target element by `data-tutorial` attribute, renders the overlay with spotlight hole, label card, and SVG arrow. Auto-advancement is added in Task 4.

**Step 1: Create the component**

Create `packages/desktop/src/renderer/components/TutorialOverlay.tsx`:

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { useTutorialStore } from '../store/tutorial';

interface StepConfig {
  target: string;
  title: string;
  description: string;
  labelSide: 'right' | 'above';
}

const STEPS: StepConfig[] = [
  {
    target: 'step-1',
    title: 'Add a project',
    description: 'Point Mainframe to a codebase by adding your first project',
    labelSide: 'right',
  },
  {
    target: 'step-2',
    title: 'Start a session',
    description: 'Open a new conversation with your AI agent',
    labelSide: 'right',
  },
  {
    target: 'step-3',
    title: 'Send a message',
    description: 'Type a task and press Enter to begin',
    labelSide: 'above',
  },
];

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;

export function TutorialOverlay() {
  const { completed, step, nextStep, skip } = useTutorialStore();
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const stepConfig = STEPS[step - 1];

  const measureTarget = useCallback(() => {
    if (!stepConfig) return;
    const el = document.querySelector(`[data-tutorial="${stepConfig.target}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [stepConfig]);

  useEffect(() => {
    measureTarget();
    window.addEventListener('resize', measureTarget);
    return () => window.removeEventListener('resize', measureTarget);
  }, [measureTarget]);

  if (completed || !stepConfig || !rect) return null;

  const holeTop = rect.top - PAD;
  const holeLeft = rect.left - PAD;
  const holeWidth = rect.width + PAD * 2;
  const holeHeight = rect.height + PAD * 2;
  const holeCenterX = holeLeft + holeWidth / 2;
  const holeCenterY = holeTop + holeHeight / 2;

  // Label card position
  const labelWidth = 220;
  const labelHeight = 90;
  let labelTop: number;
  let labelLeft: number;
  let arrowPath: string;

  if (stepConfig.labelSide === 'right') {
    labelLeft = holeLeft + holeWidth + 48;
    labelTop = holeCenterY - labelHeight / 2;
    // Arrow: from label left edge to spotlight right edge
    const ax1 = labelLeft;
    const ay1 = labelTop + labelHeight / 2;
    const ax2 = holeLeft + holeWidth;
    const ay2 = holeCenterY;
    arrowPath = `M ${ax1} ${ay1} C ${ax1 - 30} ${ay1}, ${ax2 + 30} ${ay2}, ${ax2} ${ay2}`;
  } else {
    // 'above'
    labelLeft = holeCenterX - labelWidth / 2;
    labelTop = holeTop - labelHeight - 56;
    // Arrow: from label bottom center to spotlight top center
    const ax1 = labelLeft + labelWidth / 2;
    const ay1 = labelTop + labelHeight;
    const ax2 = holeCenterX;
    const ay2 = holeTop;
    arrowPath = `M ${ax1} ${ay1} C ${ax1} ${ay1 + 20}, ${ax2} ${ay2 - 20}, ${ax2} ${ay2}`;
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}
    >
      {/* Dark overlay with spotlight hole via box-shadow */}
      <div
        style={{
          position: 'fixed',
          top: holeTop,
          left: holeLeft,
          width: holeWidth,
          height: holeHeight,
          borderRadius: 6,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
          outline: '2px solid rgba(249,115,22,0.6)',
          outlineOffset: 2,
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
          <div style={{ color: '#f97316', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Step {step} of {STEPS.length}
          </div>
          <div style={{ color: '#fafafa', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            {stepConfig.title}
          </div>
          <div style={{ color: '#a1a1aa', fontSize: 12, lineHeight: 1.5 }}>
            {stepConfig.description}
          </div>
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
```

**Step 2: Commit**

```bash
git add packages/desktop/src/renderer/components/TutorialOverlay.tsx
git commit -m "feat(desktop): add TutorialOverlay component with spotlight cutout"
```

---

### Task 4: Wire `TutorialOverlay` into `App.tsx`

**Files:**
- Modify: `packages/desktop/src/renderer/App.tsx`

**Step 1: Add import and render**

At the top of `App.tsx`, add the import after existing imports:
```tsx
import { TutorialOverlay } from './components/TutorialOverlay';
```

Inside the `return` in `App.tsx`, add `<TutorialOverlay />` after `<SettingsModal />`:
```tsx
  return (
    <ErrorBoundary>
      <Layout
        leftPanel={<LeftPanel />}
        centerPanel={<CenterPanel />}
        rightPanel={<RightPanel />}
      />
      <SearchPalette />
      <SettingsModal />
      <TutorialOverlay />
    </ErrorBoundary>
  );
```

**Step 2: Smoke test — verify tutorial appears on fresh state**

In the browser console, reset the tutorial store so it shows again:
```javascript
localStorage.removeItem('mf:tutorial');
location.reload();
```
Expected: Spotlight overlay appears over the "Add Project" button in ProjectRail with label card and orange arrow. "Skip tutorial" appears bottom-right.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): render TutorialOverlay in App"
```

---

### Task 5: Add auto-advancement logic

The overlay currently only advances via "Next →". This task adds automatic advancement when the user completes each step's action.

**Files:**
- Modify: `packages/desktop/src/renderer/components/TutorialOverlay.tsx`

**Step 1: Add auto-advance watchers**

Add these imports at the top of `TutorialOverlay.tsx`:
```tsx
import { useProjectsStore } from '../store';
import { useChatsStore } from '../store/chats';
```

Inside the `TutorialOverlay` function, after the existing state declarations, add:

```tsx
  const projects = useProjectsStore((s) => s.projects);
  const chats = useChatsStore((s) => s.chats);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  // Step 1 → 2: a project was added
  useEffect(() => {
    if (step === 1 && projects.length > 0) {
      nextStep();
    }
  }, [step, projects.length, nextStep]);

  // Step 2 → 3: a chat was created for the active project
  useEffect(() => {
    if (step === 2 && activeProjectId) {
      const projectChats = chats.filter((c) => c.projectId === activeProjectId);
      if (projectChats.length > 0) {
        nextStep();
      }
    }
  }, [step, chats, activeProjectId, nextStep]);
```

For Step 3 (message sent), the advancement is triggered by the user pressing Enter in the composer. The simplest approach: listen for the `composersubmit` event emitted by `ComposerPrimitive`. Since the tutorial completes on first message, subscribe to chats messages count instead.

Add to the store imports:
```tsx
import { useMessagesStore } from '../store/messages';
```

If a `useMessagesStore` exists, add:
```tsx
  const messageCount = useMessagesStore((s) => {
    const activeChatId = useTabsStore.getState().activePrimaryTabId;
    if (!activeChatId) return 0;
    return s.messages.get(activeChatId)?.length ?? 0;
  });

  // Step 3 → complete: first message sent
  useEffect(() => {
    if (step === 3 && messageCount > 0) {
      complete();
    }
  }, [step, messageCount, complete]);
```

> **Note:** Check the actual store file names in `packages/desktop/src/renderer/store/` before adding imports. The messages store may be named differently (e.g. `chats.ts` or `messages.ts`). Adapt the import path accordingly. If there's no direct messages store, skip the step-3 auto-advance — the "Done" button fallback is sufficient.

**Step 2: Re-measure on step change**

The `measureTarget` already runs when `stepConfig` changes (via `useCallback` dependency). This is sufficient — the effect re-runs when step changes, picking up the new `data-tutorial` target.

**Step 3: Smoke test the full flow**

```javascript
// Reset in console
localStorage.removeItem('mf:tutorial');
location.reload();
```

Walk through:
1. Step 1 overlay appears on ProjectRail "+" → click it → dialog/action opens → project is added → overlay auto-advances to step 2
2. Step 2 overlay appears on ChatsPanel "New Session" → click it → chat created → auto-advances to step 3
3. Step 3 overlay appears on Composer → type something and press Enter → tutorial completes, overlay disappears

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/TutorialOverlay.tsx
git commit -m "feat(desktop): add auto-advancement logic to TutorialOverlay"
```

---

### Task 6: Typecheck and final cleanup

**Step 1: Run TypeScript compiler**

```bash
pnpm --filter @mainframe/desktop build
```
Expected: No TypeScript errors.

If you see errors about missing store imports (step 5), adjust the import path to match the actual file.

**Step 2: Run tests**

```bash
pnpm --filter @mainframe/desktop test -- tutorial
```
Expected: All tutorial store tests pass.

**Step 3: Commit if any fixes needed**

```bash
git add -p
git commit -m "fix(desktop): resolve tutorial overlay type errors"
```
