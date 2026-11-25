/** The viewer's own choice per turn; a turn without one folds by itself when it ends. */
export type TurnChoice = 'open' | 'closed';
const choices = new Map<string, TurnChoice>();
const listeners = new Set<() => void>();
let revision = 0;

export const turnDisclosureStore = {
  get: (key: string): TurnChoice | undefined => choices.get(key),
  snapshot: (): number => revision,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(key: string, choice: TurnChoice): void {
    if (choices.get(key) === choice) return;
    choices.set(key, choice);
    revision++;
    for (const listener of listeners) listener();
  },
};
