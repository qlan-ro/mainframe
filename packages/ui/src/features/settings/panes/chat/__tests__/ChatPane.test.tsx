// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HISTORY_TURNS_DEFAULT, useUiPrefs } from '@/store/ui-prefs';
import { ChatPane } from '../ChatPane';

beforeEach(() => {
  localStorage.clear();
  useUiPrefs.setState({ enterWhileRunning: 'queue' });
});

describe('ChatPane — Enter while running (C9)', () => {
  it('offers Queue and Steer, with Queue on by default', () => {
    render(<ChatPane />);

    expect(screen.getByTestId('settings-chat-enter-running-queue')).toHaveAttribute('data-state', 'on');
    expect(screen.getByTestId('settings-chat-enter-running-steer')).toHaveAttribute('data-state', 'off');
  });

  it('explains what Enter does under Queue', () => {
    render(<ChatPane />);

    expect(
      screen.getByText('Enter sends when the agent finishes. ⌥↵ adds the message to the running turn instead.'),
    ).toBeInTheDocument();
  });

  it('choosing Steer saves the preference and the help text follows it', () => {
    render(<ChatPane />);

    fireEvent.click(screen.getByTestId('settings-chat-enter-running-steer'));

    expect(useUiPrefs.getState().enterWhileRunning).toBe('steer');
    expect(screen.getByTestId('settings-chat-enter-running-steer')).toHaveAttribute('data-state', 'on');
    expect(
      screen.getByText(
        'Enter adds the message to the running turn without stopping it. ⌥↵ sends it when the agent finishes instead.',
      ),
    ).toBeInTheDocument();
  });

  it('choosing Queue again switches back', () => {
    useUiPrefs.setState({ enterWhileRunning: 'steer' });
    render(<ChatPane />);

    fireEvent.click(screen.getByTestId('settings-chat-enter-running-queue'));

    expect(useUiPrefs.getState().enterWhileRunning).toBe('queue');
  });
});

describe('ChatPane — mentions and commands as chips', () => {
  beforeEach(() => useUiPrefs.setState({ chipComposer: false }));

  it('is off by default', () => {
    render(<ChatPane />);

    expect(screen.getByTestId('settings-chat-chip-composer')).toHaveAttribute('aria-checked', 'false');
  });

  it('turning it on saves the preference', () => {
    render(<ChatPane />);

    fireEvent.click(screen.getByTestId('settings-chat-chip-composer'));

    expect(useUiPrefs.getState().chipComposer).toBe(true);
    expect(screen.getByTestId('settings-chat-chip-composer')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('ChatPane — turns to load at a time', () => {
  beforeEach(() => useUiPrefs.setState({ historyTurns: HISTORY_TURNS_DEFAULT }));

  it('shows the default of 10', () => {
    render(<ChatPane />);

    expect(screen.getByLabelText('Turns to load at a time')).toHaveValue(10);
  });

  it('saves a new count when the field is committed', () => {
    render(<ChatPane />);
    const field = screen.getByTestId('settings-chat-history-turns');

    fireEvent.change(field, { target: { value: '20' } });
    fireEvent.blur(field);

    expect(useUiPrefs.getState().historyTurns).toBe(20);
  });

  it('clamps a count outside 2 to 50 and shows the clamped value', () => {
    render(<ChatPane />);
    const field = screen.getByTestId('settings-chat-history-turns');

    fireEvent.change(field, { target: { value: '500' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(useUiPrefs.getState().historyTurns).toBe(50);
    expect(field).toHaveValue(50);

    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.blur(field);
    expect(useUiPrefs.getState().historyTurns).toBe(2);
    expect(field).toHaveValue(2);
  });

  it('keeps the old count when the field is cleared', () => {
    render(<ChatPane />);
    const field = screen.getByTestId('settings-chat-history-turns');

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);

    expect(useUiPrefs.getState().historyTurns).toBe(10);
    expect(field).toHaveValue(10);
  });
});
