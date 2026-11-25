import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { gate, show, option, showRest, enter, scrollTo, layout, reply, WRAPPED } from './read-lock-fixture';

describe('the keyboard and screen readers', () => {
  it('a locked answer keeps its name and its place in the tab order, and says why', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    expect(option('allow-once')).toHaveAccessibleName('Allow once');
    expect(option('allow-once')).toHaveAccessibleDescription(
      'Not available until you have seen the end of the command.',
    );
    expect(option('allow-once')).not.toBeDisabled();
    expect(option('reject-once')).not.toHaveAccessibleDescription();
    option('allow-once').focus();
    expect(option('allow-once')).toHaveFocus();
  });

  it('the keyboard alone shows the rest, keeps its place, and answers', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    enter(showRest()!);

    // The button is gone; focus is on what it showed, before the answers.
    const shownPart = screen.getByTestId('chat-permission-command').closest('[data-allowed-part]');
    expect(shownPart).toHaveFocus();
    fireEvent.keyUp(shownPart!, { key: 'Enter' });
    enter(option('allow-once'));
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('a scroll that takes the button away hands its focus on', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));
    showRest()!.focus();

    scrollTo(450);

    expect(showRest()).toBeNull();
    expect(screen.getByTestId('chat-permission-command').closest('[data-allowed-part]')).toHaveFocus();
  });

  it('a scroll takes no focus from anything else', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));
    option('reject-once').focus();

    scrollTo(450);

    expect(option('reject-once')).toHaveFocus();
  });
});
