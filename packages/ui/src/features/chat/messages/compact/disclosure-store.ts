const choices = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function disclosureKey(root: string, ancestors: readonly string[], message: string, call: string): string {
  return JSON.stringify([root, ancestors, message, call]);
}

export const disclosureStore = {
  isOpen: (keys: readonly string[]) => keys.some((key) => choices.get(key) === true),
  set(keys: readonly string[], open: boolean) {
    for (const key of keys) choices.set(key, open);
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
