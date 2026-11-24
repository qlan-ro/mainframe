import { describe, it, expect } from 'vitest';
import { PERMISSION_MODES, cyclePermission, permissionLabel } from '../permission-modes';

describe('cyclePermission (C12)', () => {
  it('moves Interactive to Auto-Edits', () => {
    expect(cyclePermission('default')).toBe('acceptEdits');
  });

  it('moves Auto-Edits back to Interactive', () => {
    expect(cyclePermission('acceptEdits')).toBe('default');
  });

  it('steps Auto down to Interactive', () => {
    expect(cyclePermission('auto')).toBe('default');
  });

  it('steps Unattended down to Interactive', () => {
    expect(cyclePermission('yolo')).toBe('default');
  });
});

describe('permissionLabel', () => {
  it.each([
    ['default', 'Interactive'],
    ['acceptEdits', 'Auto-Edits'],
    ['auto', 'Auto'],
    ['yolo', 'Unattended'],
  ] as const)('spells %s as %s', (mode, label) => {
    expect(permissionLabel(mode)).toBe(label);
  });

  it('never shows a raw wire string it does not know as anything but itself', () => {
    expect(permissionLabel('plan' as never)).toBe('plan');
  });
});

describe('PERMISSION_MODES', () => {
  it('lists the modes least to most permissive', () => {
    expect(PERMISSION_MODES.map((m) => m.id)).toEqual(['default', 'acceptEdits', 'auto', 'yolo']);
  });

  it('marks Auto as a caution and Unattended as a warning', () => {
    expect(PERMISSION_MODES.map((m) => m.tone)).toEqual([undefined, undefined, 'caution', 'warning']);
  });
});
