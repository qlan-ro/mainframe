// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useUiPrefs } from '@/store/ui-prefs';
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
