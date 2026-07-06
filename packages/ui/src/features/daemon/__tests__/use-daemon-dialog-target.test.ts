/**
 * useDaemonDialogTarget — TDD tests.
 *
 * This store is the bridge between DaemonFooterStatus (the trigger + Popover,
 * which stays inside the daemon-scoped keyed subtree) and DaemonDialogHost (the
 * dialog renderer, hoisted ABOVE the key). Behaviors covered:
 *  1. Starts closed (dialog === null).
 *  2. openAdd() sets { kind: 'add' }.
 *  3. openRepair(target) sets { kind: 'repair', target }.
 *  4. openRename(target) sets { kind: 'rename', target }.
 *  5. openRemove(target) sets { kind: 'remove', target }.
 *  6. close() resets to null from any open state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { useDaemonDialogTarget } from '../use-daemon-dialog-target';

const REMOTE: DaemonMeta = {
  id: 'studio-1',
  kind: 'remote',
  label: 'Studio Mac',
  host: 'studio.example.com:443',
};

beforeEach(() => {
  useDaemonDialogTarget.getState().close();
});

describe('useDaemonDialogTarget — initial state', () => {
  it('starts with dialog === null', () => {
    expect(useDaemonDialogTarget.getState().dialog).toBeNull();
  });
});

describe('useDaemonDialogTarget — openAdd', () => {
  it('sets dialog to { kind: "add" }', () => {
    useDaemonDialogTarget.getState().openAdd();
    expect(useDaemonDialogTarget.getState().dialog).toEqual({ kind: 'add' });
  });
});

describe('useDaemonDialogTarget — openRepair', () => {
  it('sets dialog to { kind: "repair", target }', () => {
    useDaemonDialogTarget.getState().openRepair(REMOTE);
    expect(useDaemonDialogTarget.getState().dialog).toEqual({ kind: 'repair', target: REMOTE });
  });
});

describe('useDaemonDialogTarget — openRename', () => {
  it('sets dialog to { kind: "rename", target }', () => {
    useDaemonDialogTarget.getState().openRename(REMOTE);
    expect(useDaemonDialogTarget.getState().dialog).toEqual({ kind: 'rename', target: REMOTE });
  });
});

describe('useDaemonDialogTarget — openRemove', () => {
  it('sets dialog to { kind: "remove", target }', () => {
    useDaemonDialogTarget.getState().openRemove(REMOTE);
    expect(useDaemonDialogTarget.getState().dialog).toEqual({ kind: 'remove', target: REMOTE });
  });
});

describe('useDaemonDialogTarget — close', () => {
  it('resets dialog to null from an open state', () => {
    useDaemonDialogTarget.getState().openAdd();
    expect(useDaemonDialogTarget.getState().dialog).not.toBeNull();

    useDaemonDialogTarget.getState().close();
    expect(useDaemonDialogTarget.getState().dialog).toBeNull();
  });
});
