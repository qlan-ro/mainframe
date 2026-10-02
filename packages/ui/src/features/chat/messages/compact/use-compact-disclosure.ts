import { useSyncExternalStore } from 'react';
import { disclosureStore } from './disclosure-store';

export function useCompactDisclosure(memberKeys: readonly string[]) {
  const open = useSyncExternalStore(
    disclosureStore.subscribe,
    () => disclosureStore.isOpen(memberKeys),
    () => false,
  );
  return { open, setOpen: (next: boolean) => disclosureStore.set(memberKeys, next) };
}
