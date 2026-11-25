import { useSyncExternalStore } from 'react';
import { disclosureStore } from './disclosure-store';

/** A row's open state: the viewer's choice, else the row's default. */
export function useRowOpen(key: string, defaultOpen = false): { open: boolean; setOpen: (open: boolean) => void } {
  const choice = useSyncExternalStore(
    disclosureStore.subscribe,
    () => disclosureStore.get(key),
    () => undefined,
  );
  return { open: choice ?? defaultOpen, setOpen: (next) => disclosureStore.set(key, next) };
}
