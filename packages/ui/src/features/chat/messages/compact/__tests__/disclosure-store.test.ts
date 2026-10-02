import { expect, it } from 'vitest';
import { disclosureKey, disclosureStore } from '../disclosure-store';

it('keeps any-open state when calls merge and writes every member on toggle', () => {
  const first = disclosureKey('main', [], 'message', 'first');
  const second = disclosureKey('main', [], 'message', 'second');
  disclosureStore.set([first], true);
  expect(disclosureStore.isOpen([first, second])).toBe(true);
  disclosureStore.set([first, second], false);
  expect(disclosureStore.isOpen([first])).toBe(false);
  expect(disclosureStore.isOpen([second])).toBe(false);
  disclosureStore.set([first, second], true);
  expect(disclosureStore.isOpen([second])).toBe(true);
});
it('isolates root, ancestry, message and ambiguous delimiter identities', () => {
  const keys = [
    disclosureKey('root', [], 'msg', 'call'),
    disclosureKey('side', [], 'msg', 'call'),
    disclosureKey('root', ['agent'], 'msg', 'call'),
    disclosureKey('root', [], 'other', 'call'),
    disclosureKey('root', ['a', 'b'], 'msg', 'call'),
    disclosureKey('root', ['a,b'], 'msg', 'call'),
  ];
  expect(new Set(keys).size).toBe(keys.length);
  disclosureStore.set([keys[0]!], true);
  expect(disclosureStore.isOpen(keys.slice(1))).toBe(false);
});
