/** The rows the viewer opened or closed; a row without a choice keeps its default. Outlives virtualization. */
const choices = new Map<string, boolean>();
const listeners = new Set<() => void>();

export const disclosureStore = {
  get: (key: string): boolean | undefined => choices.get(key),
  isOpen: (keys: readonly string[]): boolean => keys.some((key) => choices.get(key) === true),
  set(key: string, open: boolean): void {
    if (choices.get(key) === open) return;
    choices.set(key, open);
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
