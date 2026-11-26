import { expect, it } from 'vitest';
import { AUTOMATIC_LIMIT, disclosureStore } from '../disclosure-store';

it('evicts the oldest automatic opening and falls back to the default', () => {
  const owner = { rootThreadId: 'overflow' };
  for (let i = 0; i <= AUTOMATIC_LIMIT; i++) {
    disclosureStore.rememberAutomatic(`row-${i}`, [], owner);
  }
  expect(disclosureStore.autoOpened('row-0')).toBe(false);
  expect(disclosureStore.automaticDefault('row-0', ['row-0'])).toBe(true);
  expect(disclosureStore.autoOpened('row-1')).toBe(true);
  expect(disclosureStore.autoOpened(`row-${AUTOMATIC_LIMIT}`)).toBe(true);
  disclosureStore.clearAutomaticChat(owner.rootThreadId);
});

it('clears both root and delegated chat openings while preserving manual choices', () => {
  disclosureStore.rememberAutomatic('root', [], { rootThreadId: 'parent' });
  disclosureStore.rememberAutomatic('nested', [], { rootThreadId: 'parent', chatId: 'child' });
  disclosureStore.set('nested', false);
  disclosureStore.clearAutomaticChat('child');
  expect(disclosureStore.autoOpened('nested')).toBe(false);
  expect(disclosureStore.get('nested')).toBe(false);
  expect(disclosureStore.autoOpened('root')).toBe(true);
  disclosureStore.clearAutomaticChat('parent');
  expect(disclosureStore.autoOpened('root')).toBe(false);
});
