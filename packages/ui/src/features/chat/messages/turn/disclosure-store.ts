/** The rows the viewer opened or closed; a row without a choice keeps its default. Outlives virtualization. */
const choices = new Map<string, boolean>();
const automatic = new Set<string>();
const listeners = new Set<() => void>();

export const disclosureStore = {
  autoOpened: (key: string): boolean => automatic.has(key),
  rememberAutomatic(key: string, workKeys: readonly string[]): void {
    if (choices.has(key) || workKeys.some((row) => automatic.has(row))) return;
    automatic.add(key);
    for (const listener of listeners) listener();
  },
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
