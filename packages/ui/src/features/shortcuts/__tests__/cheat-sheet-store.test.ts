// @vitest-environment jsdom
/**
 * The cheat sheet's open state. `toggleCheatSheet` implements a three-way
 * rule: open → close; closed with another modal already in the document
 * (facts 8/9) → stay closed; closed with nothing else open → open. The
 * dialog reads this store, never the other way round (Task 11 note).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCheatSheetStore, toggleCheatSheet } from '../cheat-sheet-store';

function mountModal(slot: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-slot', slot);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  useCheatSheetStore.setState({ open: false });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('toggleCheatSheet', () => {
  it('closes when already open', () => {
    useCheatSheetStore.setState({ open: true });

    toggleCheatSheet();

    expect(useCheatSheetStore.getState().open).toBe(false);
  });

  it('stays closed when a dialog is already open in the document', () => {
    mountModal('dialog-content');

    toggleCheatSheet();

    expect(useCheatSheetStore.getState().open).toBe(false);
  });

  it('stays closed when an alert dialog is already open in the document', () => {
    mountModal('alert-dialog-content');

    toggleCheatSheet();

    expect(useCheatSheetStore.getState().open).toBe(false);
  });

  it('opens when closed and nothing else is open', () => {
    toggleCheatSheet();

    expect(useCheatSheetStore.getState().open).toBe(true);
  });
});

describe('setOpen', () => {
  it('sets the open flag directly, bypassing the modal guard', () => {
    useCheatSheetStore.getState().setOpen(true);
    expect(useCheatSheetStore.getState().open).toBe(true);

    useCheatSheetStore.getState().setOpen(false);
    expect(useCheatSheetStore.getState().open).toBe(false);
  });
});
