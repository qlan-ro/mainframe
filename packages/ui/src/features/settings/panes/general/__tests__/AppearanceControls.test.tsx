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

it('exposes the default selection in a named group', () => {
  render(<AppearanceControls />);
  const group = screen.getByRole('radiogroup', { name: 'Finished work' });
  expect(within(group).getByRole('radio', { name: 'Fold' })).toHaveAttribute('aria-checked', 'true');
  expect(within(group).getByRole('radio', { name: 'Keep open' })).toHaveAttribute('aria-checked', 'false');
});

it('immediately persists a selection without changing appearance or layout preferences', () => {
  useUiPrefs.setState({ sidebarWidth: 320, dontWarnOnTuningChange: true });
  render(<AppearanceControls />);
  fireEvent.click(screen.getByTestId('settings-appearance-finished-work-open'));
  expect(useUiPrefs.getState()).toMatchObject({
    finishedWork: 'open',
    sidebarWidth: 320,
    dontWarnOnTuningChange: true,
  });
  expect(useTheme.getState()).toMatchObject({ mode: 'light', uiScale: 'normal' });
  expect(JSON.parse(localStorage.getItem('mf:ui-prefs')!).state.finishedWork).toBe('open');
  expect(screen.getByTestId('settings-appearance-finished-work-open')).toHaveAttribute('aria-checked', 'true');
});

it('ignores empty selection when clicking the selected option', () => {
  useUiPrefs.getState().setFinishedWork('open');
  render(<AppearanceControls />);
  fireEvent.click(screen.getByTestId('settings-appearance-finished-work-open'));
  expect(useUiPrefs.getState().finishedWork).toBe('open');
  expect(screen.getByTestId('settings-appearance-finished-work-open')).toHaveAttribute('aria-checked', 'true');
});

it('supports arrow-key focus and Space or Enter selection', async () => {
  const user = userEvent.setup();
  render(<AppearanceControls />);
  const fold = screen.getByTestId('settings-appearance-finished-work-fold');
  const open = screen.getByTestId('settings-appearance-finished-work-open');
  act(() => fold.focus());
  await user.keyboard('{ArrowRight}');
  expect(open).toHaveFocus();
  await user.keyboard(' ');
  expect(useUiPrefs.getState().finishedWork).toBe('open');
  expect(open).toHaveAttribute('aria-checked', 'true');
  await user.keyboard('{ArrowLeft}{Enter}');
  expect(fold).toHaveFocus();
  expect(useUiPrefs.getState().finishedWork).toBe('fold');
  expect(fold).toHaveAttribute('aria-checked', 'true');
});

it('updates the displayed choice when the shared preference changes', () => {
  render(<AppearanceControls />);
  act(() => useUiPrefs.getState().setFinishedWork('open'));
  expect(screen.getByTestId('settings-appearance-finished-work-open')).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId('settings-appearance-finished-work-fold')).toHaveAttribute('aria-checked', 'false');
});
