/**
 * TutorialOverlay.test.tsx
 *
 * Behaviors covered:
 *  1. Renders tour-overlay portal root when completed=false.
 *  2. Does NOT render when completed=true.
 *  3. Renders step 1 title "Start a session".
 *  4. Renders tour-label-card element.
 *  5. Step title tracks the store's step value, against the RESOLVED plan.
 *  6. At the last step, the Next/Done button label is "Done"; clicking it completes.
 *  7. Back button is absent at step 1.
 *  8. Step dots and the "Step N of M" count come from the resolved plan, not a
 *     fixed four — the bug this file pins is a label that counted steps the tour
 *     then skipped ("Step 1 of 4" jumping straight to "Step 4 of 4").
 *  9. tour-spotlight renders when a [data-tut] target exists in DOM.
 * 10. Nothing renders at all when no anchor is on screen (the overlay's
 *     click-catcher would otherwise block the app behind an invisible layer).
 * 11. An anchor that vanishes MID-tour still auto-skips in the direction of travel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock the tutorial store BEFORE importing the component
// ---------------------------------------------------------------------------

let mockCompleted = false;
let mockStep = 0; // 0-indexed internally exposed to the component

const mockNext = vi.fn();
const mockBack = vi.fn();
const mockSkip = vi.fn();
const mockComplete = vi.fn();

vi.mock('@/store/tutorial', () => ({
  useTutorialStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      completed: mockCompleted,
      step: mockStep,
      next: mockNext,
      back: mockBack,
      skip: mockSkip,
      complete: mockComplete,
    };
    return selector ? selector(state) : state;
  }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { TutorialOverlay } from '../TutorialOverlay';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inserted: HTMLElement[] = [];

/** Inserts a fake [data-tut] anchor that getBoundingClientRect can "find". */
function insertAnchor(target: string) {
  const el = document.createElement('div');
  el.setAttribute('data-tut', target);
  // Give it a non-zero rect so the spotlight renders
  el.getBoundingClientRect = () => ({
    top: 100,
    left: 50,
    width: 120,
    height: 30,
    right: 170,
    bottom: 130,
    x: 50,
    y: 100,
    toJSON: () => ({}),
  });
  document.body.appendChild(el);
  inserted.push(el);
  return el;
}

function removeAnchor(el: HTMLElement) {
  el.parentNode?.removeChild(el);
}

/** The full empty-workspace anchor set — every step resolves to a variant. */
function insertWelcomeAnchors() {
  return {
    sessions: insertAnchor('sessions'),
    project: insertAnchor('project'),
    composer: insertAnchor('composer'),
    workspace: insertAnchor('workspace'),
  };
}

/** Lets the plan resolve and the 30ms measure settle run. */
async function settle(ms = 50) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockCompleted = false;
  mockStep = 0;
  while (inserted.length > 0) removeAnchor(inserted.pop() as HTMLElement);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TutorialOverlay', () => {
  it('does NOT render when completed=true', () => {
    mockCompleted = true;
    insertAnchor('sessions');
    render(<TutorialOverlay />);
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('renders tour-overlay and tour-label-card when completed=false', async () => {
    insertAnchor('sessions');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByTestId('tour-overlay')).toBeTruthy();
    expect(screen.getByTestId('tour-label-card')).toBeTruthy();
  });

  it('renders step 1 title "Start a session"', async () => {
    insertAnchor('sessions');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Start a session')).toBeTruthy();
  });

  it('does NOT render Back button at step 0', async () => {
    insertAnchor('sessions');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.queryByTestId('tour-back-btn')).toBeNull();
  });

  it('shows the project step after step advances', async () => {
    mockStep = 1;
    insertWelcomeAnchors();
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Choose the project')).toBeTruthy();
  });

  it('substitutes the add-project variant when the first-run hero is on screen', async () => {
    mockStep = 1;
    insertAnchor('sessions');
    insertAnchor('add-project');
    insertAnchor('prompt');
    insertAnchor('workspace');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Add your first project')).toBeTruthy();
  });

  it('falls back to the prompt anchor for the composer step when no composer is mounted', async () => {
    mockStep = 2;
    insertAnchor('sessions');
    insertAnchor('project');
    insertAnchor('prompt');
    insertAnchor('workspace');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Hand work to your agent')).toBeTruthy();
    expect(screen.getByTestId('tour-spotlight')).toBeTruthy();
    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
  });

  it('last step shows "Done" button label and clicking it calls store.complete', async () => {
    mockStep = 3;
    const user = userEvent.setup();
    insertWelcomeAnchors();
    render(<TutorialOverlay />);
    await settle();
    const btn = screen.getByTestId('tour-next-btn');
    expect(btn.textContent).toBe('Done');
    await user.click(btn);
    expect(mockComplete).toHaveBeenCalledOnce();
  });

  it('renders one dot per resolved step and counts to that total', async () => {
    insertWelcomeAnchors();
    render(<TutorialOverlay />);
    await settle();
    for (let i = 0; i < 4; i++) {
      expect(screen.getByTestId(`tour-step-dot-${i}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('tour-step-dot-4')).toBeNull();
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
  });

  // The regression this whole change exists for: with only two anchorable steps
  // the label used to say "of 4" and hop 1 → 4. It must now say "of 2".
  it('counts only the steps it can actually show', async () => {
    insertAnchor('sessions');
    insertAnchor('workspace');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.queryByTestId('tour-step-dot-2')).toBeNull();
  });

  it('clamps a persisted step that overruns a shorter plan', async () => {
    mockStep = 3;
    insertAnchor('sessions');
    insertAnchor('workspace');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(screen.getByText('Open the workspace')).toBeTruthy();
  });

  it('renders spotlight when a [data-tut] target exists', async () => {
    insertAnchor('sessions');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByTestId('tour-spotlight')).toBeTruthy();
  });

  // With no anchors the overlay must render NOTHING — its click-catcher is
  // pointer-events-auto and would silently swallow every click in the app.
  it('renders no overlay at all when nothing is anchorable', async () => {
    render(<TutorialOverlay />);
    await settle(200); // past the one resolve retry
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Mid-tour anchor loss — the plan is frozen at open, so a step can only lose
  // its anchor afterwards (a resize collapsing the sidebar, say). The overlay
  // skips it in the direction of travel rather than stranding an unpositioned
  // label card.
  // ---------------------------------------------------------------------------

  it('auto-skips FORWARD past a step whose anchor disappears after the plan is resolved', async () => {
    const { sessions } = insertWelcomeAnchors();
    render(<TutorialOverlay />);
    // The plan resolved during render; drop the anchor before the 30ms settle.
    removeAnchor(sessions);
    await settle(80);
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('does NOT auto-skip a step whose anchor is present', async () => {
    mockStep = 1;
    insertWelcomeAnchors();
    render(<TutorialOverlay />);
    await settle(80);
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('auto-skips BACKWARD past a lost anchor when the user was navigating Back', async () => {
    // Start on the last step and click Back — this sets the travel direction
    // before the store (mocked here) transitions to the now-anchorless step.
    mockStep = 3;
    const user = userEvent.setup();
    const { composer } = insertWelcomeAnchors();
    const { rerender } = render(<TutorialOverlay />);
    await settle();
    await user.click(screen.getByTestId('tour-back-btn'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    removeAnchor(composer);

    // Simulate the store having moved back onto the composer step.
    mockStep = 2;
    rerender(<TutorialOverlay />);
    await settle(80);

    // The user's own click plus the auto-skip's call: two back(), zero next().
    expect(mockBack).toHaveBeenCalledTimes(2);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
