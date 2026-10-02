import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { useTheme } from '@/store/theme';
import { AppearanceControls } from '../AppearanceControls';

beforeEach(() => {
  localStorage.clear();
  useUiPrefs.setState(useUiPrefs.getInitialState(), true);
  useTheme.setState({ mode: 'light', resolvedMode: 'light', uiScale: 'normal' });
});

it('exposes the default selection in a named Transcript group', () => {
  render(<AppearanceControls />);
  const group = screen.getByRole('radiogroup', { name: 'Transcript' });
  expect(within(group).getByRole('radio', { name: 'Verbose' })).toHaveAttribute('aria-checked', 'true');
  expect(within(group).getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'false');
});

it('immediately persists a selection without changing appearance or layout preferences', () => {
  useUiPrefs.setState({ sidebarWidth: 320, dontWarnOnTuningChange: true });
  render(<AppearanceControls />);
  fireEvent.click(screen.getByTestId('settings-appearance-transcript-compact'));
  expect(useUiPrefs.getState()).toMatchObject({
    transcriptMode: 'compact',
    sidebarWidth: 320,
    dontWarnOnTuningChange: true,
  });
  expect(useTheme.getState()).toMatchObject({ mode: 'light', uiScale: 'normal' });
  expect(JSON.parse(localStorage.getItem('mf:ui-prefs')!).state.transcriptMode).toBe('compact');
  expect(screen.getByTestId('settings-appearance-transcript-compact')).toHaveAttribute('aria-checked', 'true');
});

it('ignores empty selection when clicking the selected option', () => {
  useUiPrefs.getState().setTranscriptMode('compact');
  render(<AppearanceControls />);
  fireEvent.click(screen.getByTestId('settings-appearance-transcript-compact'));
  expect(useUiPrefs.getState().transcriptMode).toBe('compact');
  expect(screen.getByTestId('settings-appearance-transcript-compact')).toHaveAttribute('aria-checked', 'true');
});

it('supports arrow-key focus and Space or Enter selection', async () => {
  const user = userEvent.setup();
  render(<AppearanceControls />);
  const verbose = screen.getByTestId('settings-appearance-transcript-verbose');
  const compact = screen.getByTestId('settings-appearance-transcript-compact');
  act(() => verbose.focus());
  await user.keyboard('{ArrowRight}');
  expect(compact).toHaveFocus();
  await user.keyboard(' ');
  expect(useUiPrefs.getState().transcriptMode).toBe('compact');
  expect(compact).toHaveAttribute('aria-checked', 'true');
  await user.keyboard('{ArrowLeft}{Enter}');
  expect(verbose).toHaveFocus();
  expect(useUiPrefs.getState().transcriptMode).toBe('verbose');
  expect(verbose).toHaveAttribute('aria-checked', 'true');
});

it('updates the displayed choice when the shared preference changes', () => {
  render(<AppearanceControls />);
  act(() => useUiPrefs.getState().setTranscriptMode('compact'));
  expect(screen.getByTestId('settings-appearance-transcript-compact')).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId('settings-appearance-transcript-verbose')).toHaveAttribute('aria-checked', 'false');
});
