/**
 * useNewSessionPickerTarget — behavior tests.
 *
 * The store is the lifted open-state for the "All view" NEW SESSION IN…
 * popover (see SessionsNewButton), so both the "+" button click and the
 * global ⌘N hotkey can drive the SAME anchored popover.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useNewSessionPickerTarget } from '../use-new-session-picker-target';

beforeEach(() => {
  useNewSessionPickerTarget.setState({ open: false });
});

describe('useNewSessionPickerTarget — initial state', () => {
  it('starts closed', () => {
    expect(useNewSessionPickerTarget.getState().open).toBe(false);
  });
});

describe('useNewSessionPickerTarget — setOpen', () => {
  it('opens the picker', () => {
    useNewSessionPickerTarget.getState().setOpen(true);
    expect(useNewSessionPickerTarget.getState().open).toBe(true);
  });

  it('closes the picker', () => {
    useNewSessionPickerTarget.getState().setOpen(true);
    useNewSessionPickerTarget.getState().setOpen(false);
    expect(useNewSessionPickerTarget.getState().open).toBe(false);
  });
});
