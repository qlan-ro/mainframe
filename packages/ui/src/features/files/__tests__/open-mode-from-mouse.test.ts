import { describe, expect, it } from 'vitest';
import { openModeForMouseEvent } from '../open-mode-from-mouse';

describe('openModeForMouseEvent', () => {
  it.each([
    ['mac, ⌘ held', { metaKey: true, ctrlKey: false }, true, 'permanent'],
    ['mac, ⌘ not held', { metaKey: false, ctrlKey: false }, true, 'preview'],
    ['mac, Ctrl held (not the accelerator on mac)', { metaKey: false, ctrlKey: true }, true, 'preview'],
    ['non-mac, Ctrl held', { metaKey: false, ctrlKey: true }, false, 'permanent'],
    ['non-mac, Ctrl not held', { metaKey: false, ctrlKey: false }, false, 'preview'],
    ['non-mac, ⌘ held (not the accelerator off mac)', { metaKey: true, ctrlKey: false }, false, 'preview'],
  ] as const)('%s → %s', (_label, flags, isMac, expected) => {
    expect(openModeForMouseEvent(flags, isMac)).toBe(expected);
  });
});
