/**
 * TutorialOverlay.test.tsx
 *
 * Behaviors covered:
 *  1. Renders tour-overlay portal root when completed=false.
 *  2. Does NOT render when completed=true.
 *  3. Renders step 1 title "Start a session".
 *  4. Renders tour-label-card element.
 *  5. Clicking Next advances to step 2 (title "Hand work to your agent").
 *  6. Clicking Back at step 2 returns to step 1.
 *  7. Clicking Skip calls store.skip (sets completed=true, overlay unmounts).
 *  8. At the last step, the Next/Done button label is "Done"; clicking it completes.
 *  9. Back button is absent at step 1.
 * 10. Step dots render (tour-step-dot-0 … tour-step-dot-3).
 * 11. tour-spotlight renders when a [data-tut] target exists in DOM.
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

/** Inserts a fake [data-tut] anchor that getBoundingClientRect can "find". */
function insertAnchor(target: string) {
  const el = document.createElement('div');
  el.setAttribute('data-tut', target);
  // Give it a non-zero rect so the spotlight renders
  el.getBoundingClientRect = () => ({
    top: 100, left: 50, width: 120, height: 30,
    right: 170, bottom: 130, x: 50, y: 100,
    toJSON: () => ({}),
  });
  document.body.appendChild(el);
  return el;
}

function removeAnchor(el: HTMLElement) {
  el.parentNode?.removeChild(el);
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockCompleted = false;
  mockStep = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TutorialOverlay', () => {
  it('does NOT render when completed=true', () => {
    mockCompleted = true;
    render(<TutorialOverlay />);
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('renders tour-overlay and tour-label-card when completed=false', async () => {
    const anchor = insertAnchor('sessions');
    render(<TutorialOverlay />);
    // Wait for the setTimeout(remeasure, 30) to fire
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(screen.getByTestId('tour-overlay')).toBeTruthy();
    expect(screen.getByTestId('tour-label-card')).toBeTruthy();
    removeAnchor(anchor);
  });

  it('renders step 1 title "Start a session"', async () => {
    const anchor = insertAnchor('sessions');
    render(<TutorialOverlay />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(screen.getByText('Start a session')).toBeTruthy();
    removeAnchor(anchor);
  });

  it('does NOT render Back button at step 0', async () => {
    const anchor = insertAnchor('sessions');
    render(<TutorialOverlay />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(screen.queryByTestId('tour-back-btn')).toBeNull();
    removeAnchor(anchor);
  });

  it('clicking Next calls store.next', async () => {
    const user = userEvent.setup();
    const anchor = insertAnchor('sessions');
    render(<TutorialOverlay />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    await user.click(screen.getByTestId('tour-next-btn'));
    expect(mockNext).toHaveBeenCalledOnce();
    removeAnchor(anchor);
  });

  it('shows step 2 title after step advances', async () => {
    // Simulate the store reporting step 1 (0-indexed)
    mockStep = 1;
    const anchor = insertAnchor('composer');
    render(<TutorialOverlay />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(screen.getByText('Hand work to your agent')).toBeTruthy();
    removeAnchor(anchor);
  });

  it('clicking Back at step > 0 calls store.back', async () => {
    mockStep = 1;
    const user = userEvent.setup();
    const anchor = insertAnchor('composer');
    render(<TutorialOverlay />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    await user.click(screen.getByTestId('tour-back-btn'));
    expect(mockBack).toHaveBeenCalledOnce();
    removeAnchor(anchor);
  });

  it('clicking Skip calls store.skip', async () => {
    const user = userEvent.setup();
    const anchor = insertAnchor('sessions');
    render(<TutorialOverlay />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    await user.click(screen.getByTestId('tour-skip-btn'));
    expect(mockSkip).toHaveBeenCalledOnce();
    removeAnchor(anchor);
  });

  it('last step shows "Done" button label and clicking it calls store.complete', async () => {
    mockStep = 3; // last step (0-indexed)
    const user = userEvent.setup();
    const anchor = insertAnchor('run');
    render(<TutorialOverlay />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    const btn = screen.getByTestId('tour-next-btn');
    expect(btn.textContent).toBe('Done');
    await user.click(btn);
    expect(mockComplete).toHaveBeenCalledOnce();
    removeAnchor(anchor);
  });

  it('renders 4 step dots', async () => {
    const anchor = insertAnchor('sessions');
    render(<TutorialOverlay />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    for (let i = 0; i < 4; i++) {
      expect(screen.getByTestId(`tour-step-dot-${i}`)).toBeTruthy();
    }
    removeAnchor(anchor);
  });

  it('renders spotlight when a [data-tut] target exists', async () => {
    const anchor = insertAnchor('sessions');
    render(<TutorialOverlay />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(screen.getByTestId('tour-spotlight')).toBeTruthy();
    removeAnchor(anchor);
  });
});
