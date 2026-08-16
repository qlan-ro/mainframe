/**
 * TutorialOverlay.test.tsx
 *
 * Behaviors covered:
 *  1. Renders / does not render against the store's `completed`.
 *  2. Step content tracks the store's step against the RESOLVED plan.
 *  3. Back is absent at the first step; the last step's button reads "Done"
 *     and completes — the store no longer knows the total, so the overlay
 *     owning the last step is what ends a 9-step tour at nine.
 *  4. Step dots and "Step N of M" come from the resolved plan, never a fixed
 *     count. This is the defect the file pins: a label that counted steps the
 *     tour then skipped ("Step 1 of 4" jumping straight to "Step 4 of 4").
 *  5. Secondary locations get a ring; only the primary carries the scrim.
 *  6. Nothing renders when no anchor is on screen (the click-catcher would
 *     otherwise block the app behind an invisible layer).
 *  7. An anchor lost MID-tour auto-skips in the direction of travel.
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

/** Every anchor the armed workspace carries — the full 9-step tour. */
function insertArmedAnchors(): Record<string, HTMLElement> {
  const targets = [
    'add-project',
    'new-session',
    'new-session-row',
    'new-session-tab',
    'sessions-list',
    'session-tabs',
    'session-rail',
    'workspace',
    'search',
    'kanban',
    'automations',
    'settings',
  ];
  return Object.fromEntries(targets.map((t) => [t, insertAnchor(t)]));
}

const LAST_STEP = 8; // 9 steps, 0-indexed

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
    insertArmedAnchors();
    render(<TutorialOverlay />);
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('renders the overlay and label card when completed=false', async () => {
    insertArmedAnchors();
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByTestId('tour-overlay')).toBeTruthy();
    expect(screen.getByTestId('tour-label-card')).toBeTruthy();
  });

  it('opens on "Add a project", with no Back button', async () => {
    insertArmedAnchors();
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Add a project')).toBeTruthy();
    expect(screen.queryByTestId('tour-back-btn')).toBeNull();
  });

  it('tracks the store step through the plan', async () => {
    mockStep = 3;
    insertArmedAnchors();
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('The session rail')).toBeTruthy();
    expect(screen.getByText('Step 4 of 9')).toBeTruthy();
  });

  it('ends at step 9 — the store has no total, so the overlay owns completion', async () => {
    mockStep = LAST_STEP;
    const user = userEvent.setup();
    insertArmedAnchors();
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Step 9 of 9')).toBeTruthy();
    const btn = screen.getByTestId('tour-next-btn');
    expect(btn.textContent).toBe('Done');
    await user.click(btn);
    expect(mockComplete).toHaveBeenCalledOnce();
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('renders one dot per resolved step and no more', async () => {
    insertArmedAnchors();
    render(<TutorialOverlay />);
    await settle();
    for (let i = 0; i <= LAST_STEP; i++) {
      expect(screen.getByTestId(`tour-step-dot-${i}`)).toBeTruthy();
    }
    expect(screen.queryByTestId(`tour-step-dot-${LAST_STEP + 1}`)).toBeNull();
    expect(screen.getByText('Step 1 of 9')).toBeTruthy();
  });

  // The regression the whole change exists for: the label must never count a
  // step the tour cannot point at.
  it('counts only the steps it can actually show', async () => {
    insertAnchor('add-project');
    insertAnchor('settings');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.queryByTestId('tour-step-dot-2')).toBeNull();
  });

  it('clamps a persisted step that overruns a shorter plan', async () => {
    mockStep = LAST_STEP;
    insertAnchor('add-project');
    insertAnchor('settings');
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(screen.getByText('Reach this machine remotely')).toBeTruthy();
  });

  // "Three ways to start a session" needs three rings but exactly one scrim —
  // the scrim IS the primary ring's outward box-shadow, so a second would paint
  // over the first cut-out.
  it('rings every secondary location, and cuts the scrim only once', async () => {
    mockStep = 1; // "Start a session" — also: new-session-row, new-session-tab
    insertArmedAnchors();
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByTestId('tour-spotlight')).toBeTruthy();
    expect(screen.getByTestId('tour-spotlight-also-0')).toBeTruthy();
    expect(screen.getByTestId('tour-spotlight-also-1')).toBeTruthy();
    expect(screen.getByTestId('tour-spotlight').style.boxShadow).toContain('9999px');
    expect(screen.getByTestId('tour-spotlight-also-0').style.boxShadow).toBe('');
  });

  it('renders no secondary rings for a single-location step', async () => {
    mockStep = 6; // Kanban
    insertArmedAnchors();
    render(<TutorialOverlay />);
    await settle();
    expect(screen.getByText('The Kanban board')).toBeTruthy();
    expect(screen.queryByTestId('tour-spotlight-also-0')).toBeNull();
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
    const anchors = insertArmedAnchors();
    render(<TutorialOverlay />);
    // The plan resolved during render; drop the anchor before the 30ms settle.
    removeAnchor(anchors['add-project'] as HTMLElement);
    await settle(80);
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('does NOT auto-skip a step whose anchor is present', async () => {
    mockStep = 1;
    insertArmedAnchors();
    render(<TutorialOverlay />);
    await settle(80);
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('auto-skips BACKWARD past a lost anchor when the user was navigating Back', async () => {
    // Start on a later step and click Back — this sets the travel direction
    // before the store (mocked here) transitions to the now-anchorless step.
    mockStep = 2;
    const user = userEvent.setup();
    const anchors = insertArmedAnchors();
    const { rerender } = render(<TutorialOverlay />);
    await settle();
    await user.click(screen.getByTestId('tour-back-btn'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    removeAnchor(anchors['new-session'] as HTMLElement);

    // Simulate the store having moved back onto the new-session step.
    mockStep = 1;
    rerender(<TutorialOverlay />);
    await settle(80);

    // The user's own click plus the auto-skip's call: two back(), zero next().
    expect(mockBack).toHaveBeenCalledTimes(2);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
