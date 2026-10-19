// @vitest-environment jsdom
import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { TranscriptWidthHandle } from '../TranscriptWidthHandle';

/** A 680px column centred at x=500 in a 1200px viewport. */
function Harness() {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef} data-testid="root">
      <div data-testid="viewport">
        <div data-testid="column">
          <TranscriptWidthHandle side="left" rootRef={rootRef} />
          <TranscriptWidthHandle side="right" rootRef={rootRef} />
        </div>
      </div>
    </div>
  );
}

function renderHarness() {
  render(<Harness />);
  vi.spyOn(screen.getByTestId('column'), 'getBoundingClientRect').mockReturnValue({
    left: 160,
    width: 680,
  } as DOMRect);
  Object.defineProperty(screen.getByTestId('viewport'), 'clientWidth', { value: 1200 });
}

beforeEach(() => {
  localStorage.clear();
  useUiPrefs.setState({ transcriptWidth: 680 });
});

it('paints the dragged width live and commits it to ui-prefs on release', () => {
  renderHarness();
  fireEvent.pointerDown(screen.getByTestId('transcript-width-handle-right'), { button: 0, clientX: 840 });
  fireEvent.pointerMove(window, { clientX: 950 });
  expect(screen.getByTestId('root').style.getPropertyValue('--mf-transcript-width')).toBe('900px');
  expect(useUiPrefs.getState().transcriptWidth).toBe(680);
  fireEvent.pointerUp(window);
  expect(useUiPrefs.getState().transcriptWidth).toBe(900);
});

it('the left grip mirrors the right: dragging it outward widens the column', () => {
  renderHarness();
  fireEvent.pointerDown(screen.getByTestId('transcript-width-handle-left'), { button: 0, clientX: 160 });
  fireEvent.pointerMove(window, { clientX: 100 });
  fireEvent.pointerUp(window);
  expect(useUiPrefs.getState().transcriptWidth).toBe(800);
});

it('stops at the viewport width and at the 480px floor', () => {
  renderHarness();
  const handle = screen.getByTestId('transcript-width-handle-right');
  fireEvent.pointerDown(handle, { button: 0, clientX: 840 });
  fireEvent.pointerMove(window, { clientX: 1400 });
  fireEvent.pointerUp(window);
  expect(useUiPrefs.getState().transcriptWidth).toBe(1200);
  fireEvent.pointerDown(handle, { button: 0, clientX: 840 });
  fireEvent.pointerMove(window, { clientX: 520 });
  fireEvent.pointerUp(window);
  expect(useUiPrefs.getState().transcriptWidth).toBe(480);
});

it('a click without a drag leaves a wider stored width alone', () => {
  useUiPrefs.setState({ transcriptWidth: 1400 });
  renderHarness();
  fireEvent.pointerDown(screen.getByTestId('transcript-width-handle-right'), { button: 0, clientX: 840 });
  fireEvent.pointerUp(window);
  expect(useUiPrefs.getState().transcriptWidth).toBe(1400);
});

it('double-click restores the 680px default', () => {
  useUiPrefs.setState({ transcriptWidth: 1100 });
  renderHarness();
  fireEvent.doubleClick(screen.getByTestId('transcript-width-handle-left'));
  expect(useUiPrefs.getState().transcriptWidth).toBe(680);
});
