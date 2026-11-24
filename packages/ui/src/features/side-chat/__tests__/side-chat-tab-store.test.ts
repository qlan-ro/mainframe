// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { claimFirstOpen } from '../side-chat-tab-store';

beforeEach(() => localStorage.clear());

it('opens a side chat by itself once per session', () => {
  expect(claimFirstOpen('s1', 'side', 'parent')).toBe(true);
  expect(claimFirstOpen('s1', 'side', 'parent')).toBe(false);
  expect(claimFirstOpen('s2', 'side', 'parent')).toBe(true);
});

it('keeps one that was folded away closed in every session that shows it', () => {
  localStorage.setItem('mf:side-chat-collapsed:parent', 'true');
  expect(claimFirstOpen('s1', 'side', 'parent')).toBe(false);
  expect(claimFirstOpen('parent', 'side', 'parent')).toBe(false);
  expect(localStorage.getItem('mf:side-chat-collapsed:parent')).toBeNull();
});

it('does not hold an old fold against a later side chat of the same parent', () => {
  localStorage.setItem('mf:side-chat-collapsed:parent', 'true');
  claimFirstOpen('parent', 'side-1', 'parent');
  expect(claimFirstOpen('parent', 'side-2', 'parent')).toBe(true);
});

it('reads corrupt storage as nothing opened yet', () => {
  localStorage.setItem('mf:side-chat-tabs', '{');
  expect(claimFirstOpen('s1', 'side', 'parent')).toBe(true);
});
