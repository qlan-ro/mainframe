/** The rows the viewer opened or closed; a row without a choice keeps its default. Outlives virtualization. */
const choices = new Map<string, boolean>();
export const AUTOMATIC_LIMIT = 512;
const automatic = new Map<string, { rootThreadId: string; chatId?: string }>();
const listeners = new Set<() => void>();

export const disclosureStore = {
  autoOpened: (key: string): boolean => automatic.has(key),
  automaticDefault(key: string, workKeys: readonly string[]): boolean {
    return automatic.has(key) || !workKeys.some((row) => automatic.has(row));
  },
  clearAutomaticChat(chatId: string): void {
    let changed = false;
    for (const [key, owner] of automatic) {
      if (owner.rootThreadId === chatId || owner.chatId === chatId) {
        automatic.delete(key);
        changed = true;
      }
    }
    if (changed) for (const listener of listeners) listener();
  },
  rememberAutomatic(key: string, workKeys: readonly string[], owner: { rootThreadId: string; chatId?: string }): void {
    if (choices.has(key) || workKeys.some((row) => automatic.has(row))) return;
    automatic.set(key, owner);
    if (automatic.size > AUTOMATIC_LIMIT) {
      const oldest = automatic.keys().next();
      if (!oldest.done) automatic.delete(oldest.value);
    }
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
