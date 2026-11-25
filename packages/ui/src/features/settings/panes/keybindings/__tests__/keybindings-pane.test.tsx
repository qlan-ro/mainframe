import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useKeybindingsStore, type Overrides } from '@/features/shortcuts/keybindings-store';
import { isMacPlatform } from '@/features/shortcuts/platform';
import { KeybindingsPane } from '../KeybindingsPane';

const targetId = 'chat.focus-composer';
const chord = { code: 'KeyF', mod: true };

afterEach(() => {
  cleanup();
  useKeybindingsStore.getState().resetAll();
  localStorage.removeItem('mf:keybindings');
});

it('asks again when another window moves the chord before confirmation', () => {
  render(<KeybindingsPane />);
  fireEvent.click(screen.getByTestId(`settings-keybinding-record-${targetId}`));
  fireEvent.keyDown(window, { code: chord.code, metaKey: isMacPlatform(), ctrlKey: !isMacPlatform() });

  const prompt = () => screen.getByTestId(`settings-keybinding-conflict-${targetId}`);
  const confirm = () => fireEvent.click(screen.getByTestId(`settings-keybinding-steal-${targetId}`));
  expect(prompt()).toHaveTextContent('Already Find in chat');

  const overrides: Overrides = { 'chat.find': null, 'chat.stop': chord };
  localStorage.setItem('mf:keybindings', JSON.stringify({ version: 0, state: { overrides } }));
  expect(prompt()).toHaveTextContent('Already Find in chat');

  confirm();
  expect(useKeybindingsStore.getState().overrides).toEqual(overrides);
  expect(prompt()).toHaveTextContent('Already Stop the turn and all sub-agents');

  confirm();
  expect(useKeybindingsStore.getState().overrides).toEqual({
    'chat.find': null,
    'chat.stop': null,
    [targetId]: chord,
  });
  expect(screen.queryByTestId(`settings-keybinding-conflict-${targetId}`)).toBeNull();
});
